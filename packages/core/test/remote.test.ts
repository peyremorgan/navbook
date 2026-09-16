/**
 * The remote half of the git layer, against a real bare repository.
 *
 * A push rejection is the case worth proving: the API server's whole sync loop
 * turns on telling "somebody pushed first" apart from "git failed".
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitError, GitTimeoutError, git } from "../src/git/exec.ts";
import {
  fetchRemote,
  fetchRemoteAsync,
  hasRemote,
  listRemotes,
  pushBranch,
  pushBranchAsync,
} from "../src/git/remote.ts";

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

  it("waits as long as git does when given no timeout", async () => {
    await inRemotesAsync(async ({ origin, clone, commit }) => {
      stallPushes(origin, 1);
      commit(clone, "patient");
      assert.equal(await pushBranchAsync(clone, "origin", "main"), "ok");
    });
  });
});
