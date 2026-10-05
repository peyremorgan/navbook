/**
 * The remote half of the git layer, against a real bare repository.
 *
 * A push rejection is the case worth proving: the API server's whole sync loop
 * turns on telling "somebody pushed first" apart from "git failed".
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitError, GitStoppedError, GitTimeoutError, git } from "../src/git/exec.ts";
import {
  fetchRemote,
  fetchRemoteAsync,
  hasRemote,
  listRemotes,
  pushBranch,
  pushBranchAsync,
} from "../src/git/remote.ts";
import { PID_OF_SELF } from "./helpers/platform.ts";

const IDENTITY = { name: "Nav Test", email: "nav@test.invalid" };

interface Fixture {
  /** A bare repository standing in for origin. */
  origin: string;
  /** A clone with `origin` configured and one commit pushed. */
  clone: string;
  /** A second clone of the same origin, for making somebody else's push. */
  peer: string;
  commit(dir: string, name: string): void;
}

function makeRemotes(): Fixture & { cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "navbook-remote-"));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  const peer = join(root, "peer");
  git(["init", "--quiet", "--bare", "-b", "main", origin]);

  const commit = (dir: string, name: string): void => {
    writeFileSync(join(dir, name), `${name}\n`, "utf8");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "--quiet", "-m", name], { cwd: dir });
  };

  const setUp = (dir: string): void => {
    git(["config", "user.name", IDENTITY.name], { cwd: dir });
    git(["config", "user.email", IDENTITY.email], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });
  };

  git(["clone", "--quiet", origin, clone]);
  setUp(clone);
  commit(clone, "first");
  assert.equal(pushBranch(clone, "origin", "main"), "ok");

  git(["clone", "--quiet", origin, peer]);
  setUp(peer);

  return {
    origin,
    clone,
    peer,
    commit,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function inRemotes(use: (fx: Fixture) => void): void {
  const fx = makeRemotes();
  try {
    use(fx);
  } finally {
    fx.cleanup();
  }
}

async function inRemotesAsync(use: (fx: Fixture) => Promise<void>): Promise<void> {
  const fx = makeRemotes();
  try {
    await use(fx);
  } finally {
    fx.cleanup();
  }
}

/** Make the origin sit on every push for `seconds`, as an unreachable one would. */
function stallPushes(origin: string, seconds: number): () => void {
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\nsleep ${seconds}\nexit 0\n`, "utf8");
  chmodSync(hook, 0o755);
  return () => rmSync(hook, { force: true });
}

describe("remotes", () => {
  it("lists the configured remotes", () => {
    inRemotes(({ clone }) => {
      assert.deepEqual(listRemotes(clone), ["origin"]);
      assert.equal(hasRemote(clone, "origin"), true);
      assert.equal(hasRemote(clone, "upstream"), false);
    });
  });

  it("reports no remotes in a repository that has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-bare-"));
    try {
      git(["init", "--quiet", "-b", "main", dir]);
      assert.deepEqual(listRemotes(dir), []);
      assert.equal(hasRemote(dir, "origin"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetches another clone's commits without merging them", () => {
    inRemotes(({ clone, peer, commit }) => {
      commit(peer, "second");
      assert.equal(pushBranch(peer, "origin", "main"), "ok");

      fetchRemote(clone, "origin");
      // Fetched, so the remote-tracking ref moved; HEAD did not.
      assert.notEqual(
        git(["rev-parse", "origin/main"], { cwd: clone }).trim(),
        git(["rev-parse", "HEAD"], { cwd: clone }).trim(),
      );
    });
  });

  it("throws when the remote does not exist", () => {
    inRemotes(({ clone }) => {
      assert.throws(() => fetchRemote(clone, "nowhere"), GitError);
    });
  });

  it("rejects rather than throws when the remote has moved on", () => {
    inRemotes(({ clone, peer, commit }) => {
      commit(peer, "theirs");
      assert.equal(pushBranch(peer, "origin", "main"), "ok");

      commit(clone, "ours");
      assert.equal(pushBranch(clone, "origin", "main"), "rejected");

      // Merging what they pushed is what makes the retry a fast-forward.
      fetchRemote(clone, "origin");
      git(["merge", "--no-edit", "--quiet", "origin/main"], { cwd: clone });
      assert.equal(pushBranch(clone, "origin", "main"), "ok");
    });
  });

  it("throws when the push fails for a reason a retry cannot mend", () => {
    inRemotes(({ clone }) => {
      assert.throws(() => pushBranch(clone, "nowhere", "main"), GitError);
      assert.throws(() => pushBranch(clone, "origin", "no-such-branch"), GitError);
    });
  });
});

/** Whether a process is still there; signal 0 asks without sending. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("remotes, without blocking", () => {
  it("fetches and pushes as the blocking forms do", async () => {
    await inRemotesAsync(async ({ clone, peer, commit }) => {
      commit(peer, "second");
      assert.equal(await pushBranchAsync(peer, "origin", "main"), "ok");

      await fetchRemoteAsync(clone, "origin");
      assert.notEqual(
        git(["rev-parse", "origin/main"], { cwd: clone }).trim(),
        git(["rev-parse", "HEAD"], { cwd: clone }).trim(),
      );

      commit(clone, "ours");
      assert.equal(await pushBranchAsync(clone, "origin", "main"), "rejected");
      await assert.rejects(fetchRemoteAsync(clone, "nowhere"), GitError);
      await assert.rejects(pushBranchAsync(clone, "nowhere", "main"), GitError);
    });
  });

  it("pushes a copy under another name, and only while the remote has what it expects", async () => {
    await inRemotesAsync(async ({ origin, clone, peer, commit }) => {
      const sha = (dir: string, rev: string): string =>
        git(["rev-parse", rev], { cwd: dir }).trim();
      git(["push", "--quiet", "origin", "main:feat"], { cwd: clone });
      const fetched = sha(clone, "main");
      git(["branch", "--quiet", "copy", "main"], { cwd: clone });
      git(["checkout", "--quiet", "copy"], { cwd: clone });
      commit(clone, "on the copy");

      // The remote's branch is where it was: the copy lands on it.
      assert.equal(
        await pushBranchAsync(clone, "origin", "copy", { to: "feat", expect: fetched }),
        "ok",
      );
      assert.equal(sha(origin, "feat"), sha(clone, "copy"));

      // Somebody moved it: refused, and theirs stays.
      git(["fetch", "--quiet", "origin"], { cwd: peer });
      git(["checkout", "--quiet", "-b", "feat", "origin/feat"], { cwd: peer });
      commit(peer, "theirs");
      git(["push", "--quiet", "origin", "feat"], { cwd: peer });
      commit(clone, "again");
      const stale = sha(clone, "copy~1");
      assert.equal(
        await pushBranchAsync(clone, "origin", "copy", { to: "feat", expect: stale }),
        "rejected",
      );
      assert.equal(sha(origin, "feat"), sha(peer, "feat"));

      // Somebody deleted it: refused, and not made again.
      git(["push", "--quiet", "origin", "--delete", "feat"], { cwd: peer });
      assert.equal(
        await pushBranchAsync(clone, "origin", "copy", { to: "feat", expect: stale }),
        "rejected",
      );
      assert.equal(git(["branch", "--list", "feat"], { cwd: origin }), "");
    });
  });

  it("stops a push the remote sits on, and can push again once it answers", async () => {
    await inRemotesAsync(async ({ origin, clone, commit }) => {
      const unstall = stallPushes(origin, 5);
      commit(clone, "slow");

      const started = Date.now();
      await assert.rejects(
        pushBranchAsync(clone, "origin", "main", { timeoutMs: 300 }),
        GitTimeoutError,
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 3000, `a 300 ms timeout took ${elapsed} ms`);

      // Stopped cleanly: nothing was left locked, and the commit is still ours to push.
      unstall();
      assert.equal(await pushBranchAsync(clone, "origin", "main", { timeoutMs: 10_000 }), "ok");
      assert.equal(
        git(["rev-parse", "main"], { cwd: origin }).trim(),
        git(["rev-parse", "HEAD"], { cwd: clone }).trim(),
      );
    });
  });

  it("stops a fetch on request, and what it started with it", async () => {
    await inRemotesAsync(async ({ origin, clone }) => {
      // An upload-pack that never answers, standing in for a slow remote, and
      // saying where it is so the test can tell whether it was left running.
      const pidFile = join(clone, "..", "upload-pack.pid");
      const script = join(clone, "..", "slow-upload-pack");
      writeFileSync(script, `#!/bin/sh\n${PID_OF_SELF} > '${pidFile}'\nexec sleep 30\n`, "utf8");
      chmodSync(script, 0o755);
      git(["remote", "add", "slow", origin], { cwd: clone });
      // Run by a shell, which reads a backslash as an escape: `/` on every platform.
      git(["config", "remote.slow.uploadpack", script.replaceAll("\\", "/")], { cwd: clone });

      const stop = new AbortController();
      const fetching = fetchRemoteAsync(clone, "slow", { signal: stop.signal });
      let pid = 0;
      for (let tries = 0; tries < 500 && pid === 0; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) || 0 : 0;
      }
      assert.ok(pid > 0, "the upload-pack never started");

      const started = Date.now();
      stop.abort();
      await assert.rejects(fetching, GitStoppedError);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 1500, `stopping took ${elapsed} ms`);
      assert.equal(alive(pid), false, "the fetch's upload-pack outlived it");
      // Stopped before it started: nothing runs at all.
      await assert.rejects(
        fetchRemoteAsync(clone, "origin", { signal: AbortSignal.abort() }),
        GitStoppedError,
      );
    });
  });

  it("waits as long as git does when given no timeout", async () => {
    await inRemotesAsync(async ({ origin, clone, commit }) => {
      stallPushes(origin, 1);
      commit(clone, "patient");
      assert.equal(await pushBranchAsync(clone, "origin", "main"), "ok");
    });
  });
});
