/**
 * The non-blocking runner, held to the blocking one's contract.
 *
 * What it must match is everything a caller can observe — exit code, output,
 * input, the buffer limit — because the two runners back the same operations
 * and a difference between them would be a bug that only shows in the server.
 * What it adds, the timeout, is proved on a git that genuinely hangs.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  GitError,
  GitStoppedError,
  GitTimeoutError,
  git,
  gitAsync,
  gitMaybeAsync,
  gitRun,
  gitRunAsync,
} from "../src/git/exec.ts";
import {
  canFastForward,
  canFastForwardAsync,
  commitMergeAsync,
  conflictedPathsAsync,
  isAlreadyMerged,
  isAlreadyMergedAsync,
  mergeNoCommitAsync,
} from "../src/git/merge.ts";
import { currentBranch, currentBranchAsync, resolveSha, resolveShaAsync } from "../src/git/repo.ts";
import { ORPHANS_OUTLIVE_STOP, PID_OF_LAST, POLITE_STOP } from "./helpers/platform.ts";

async function inRepo(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "navbook-async-"));
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    git(["config", "user.name", "Nav Test"], { cwd: dir });
    git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "--quiet", "-m", "first"], { cwd: dir });
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("gitRunAsync", () => {
  it("reports what gitRun reports, succeeding or not", async () => {
    await inRepo(async (cwd) => {
      const head = ["rev-parse", "HEAD"];
      assert.deepEqual(await gitRunAsync(head, { cwd }), gitRun(head, { cwd }));

      const missing = ["rev-parse", "--verify", "--quiet", "no-such-ref"];
      const blocking = gitRun(missing, { cwd });
      const awaited = await gitRunAsync(missing, { cwd });
      assert.notEqual(awaited.code, 0);
      assert.equal(awaited.code, blocking.code);
    });
  });

  it("feeds the command its input", async () => {
    await inRepo(async (cwd) => {
      const args = ["hash-object", "--stdin"];
      const input = "hello\n";
      assert.equal(
        (await gitRunAsync(args, { cwd, input })).stdout,
        gitRun(args, { cwd, input }).stdout,
      );
    });
  });

  it("throws and nulls as the blocking forms do", async () => {
    await inRepo(async (cwd) => {
      assert.equal(
        (await gitAsync(["rev-parse", "HEAD"], { cwd })).trim(),
        resolveSha(cwd, "HEAD"),
      );
      await assert.rejects(gitAsync(["rev-parse", "--verify", "nope"], { cwd }), GitError);
      assert.equal(
        await gitMaybeAsync(["rev-parse", "--verify", "--quiet", "nope"], { cwd }),
        null,
      );
      assert.equal(await gitMaybeAsync(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }), "main");
    });
  });

  it("refuses output beyond the buffer it was given", async () => {
    await inRepo(async (cwd) => {
      await assert.rejects(
        gitRunAsync(["help", "-a"], { cwd, maxBuffer: 64 }),
        /more than 64 bytes/,
      );
    });
  });

  it("stops a command that outlives its timeout, without waiting for what it started", async () => {
    // `git credential fill` runs its helper and waits for it. This helper is a
    // nap, so git hangs the way a push to a remote that never answers would —
    // and the helper is a child that keeps git's pipes open after git itself
    // is gone, which is the wait a stopped command must not inherit.
    const args = ["-c", "credential.helper=!f() { sleep 5; }; f", "credential", "fill"];
    const started = Date.now();
    await assert.rejects(
      gitRunAsync(args, {
        cwd: tmpdir(),
        input: "url=https://example.invalid\n\n",
        env: { GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: 200,
      }),
      (error: unknown) => {
        assert.ok(error instanceof GitTimeoutError);
        assert.equal(error.timeoutMs, 200);
        assert.deepEqual(error.args, args);
        assert.match(error.message, /did not finish within 200 ms/);
        return true;
      },
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `a 200 ms timeout took ${elapsed} ms to fire`);
  });

  it("does not stop a command that finishes in time", async () => {
    await inRepo(async (cwd) => {
      const result = await gitRunAsync(["rev-parse", "HEAD"], { cwd, timeoutMs: 10_000 });
      assert.equal(result.code, 0);
    });
  });
});

/**
 * A git that hangs on something it started: `credential fill` waits for its
 * helper, and the helper waits for a `sleep` whose pid it writes down — the
 * shape of `maintenance` waiting on `repack` waiting on `pack-objects`.
 * `ignoreTerm` makes the helper and its `sleep` deaf to SIGTERM.
 */
function hanging(pidFile: string, ignoreTerm = false): string[] {
  const deaf = ignoreTerm ? "trap '' TERM; " : "";
  const body = `${deaf}sleep 30 & ${PID_OF_LAST} > '${pidFile}'; wait`;
  return ["-c", `credential.helper=!f() { ${body}; }; f`, "credential", "fill"];
}

const HANGING_INPUT = {
  input: "url=https://example.invalid\n\n",
  env: { GIT_TERMINAL_PROMPT: "0" },
};

/** Whether a process is still there; signal 0 asks without sending. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * That a group stop reached the helper's `sleep`, wherever a stop can reach it.
 *
 * Where it cannot (see {@link ORPHANS_OUTLIVE_STOP}), what the test still
 * proves is that the call answered in time, git and all; the orphan is ended
 * here so it does not outlive the suite.
 */
function assertReached(pid: number, message: string): void {
  if (ORPHANS_OUTLIVE_STOP) {
    if (alive(pid)) process.kill(pid);
    return;
  }
  assert.equal(alive(pid), false, message);
}

/** The pid the hanging helper wrote, once it has. */
async function grandchild(pidFile: string): Promise<number> {
  for (let tries = 0; tries < 500; tries++) {
    const text = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "";
    if (text !== "") return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the helper never started");
}

async function inScratch(use: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "navbook-stop-"));
  try {
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stopping a command on request, and everything it started", () => {
  it("stops a command when its caller aborts, and says it was stopped", async () => {
    await inScratch(async (dir) => {
      const pidFile = join(dir, "pid");
      const args = hanging(pidFile);
      const stop = new AbortController();
      const running = gitRunAsync(args, { cwd: dir, ...HANGING_INPUT, signal: stop.signal });
      const pid = await grandchild(pidFile);
      const started = Date.now();
      stop.abort();
      await assert.rejects(running, (error: unknown) => {
        assert.ok(error instanceof GitStoppedError);
        assert.deepEqual(error.args, args);
        assert.match(error.message, /was stopped before it finished/);
        return true;
      });
      assert.ok(Date.now() - started < 1500, "an abort should not wait for the kill");
      // Only git was told: without a group, its helper is left to finish.
      assert.ok(alive(pid), "without a group, what git started is not signalled");
      process.kill(pid, "SIGKILL");
    });
  });

  it("starts nothing when the signal has already aborted", async () => {
    await inScratch(async (dir) => {
      const target = join(dir, "repo");
      await assert.rejects(
        gitRunAsync(["init", "--quiet", target], { signal: AbortSignal.abort() }),
        GitStoppedError,
      );
      assert.equal(existsSync(target), false);
    });
  });

  it("stops what git started too, when it runs in a group of its own", async () => {
    await inScratch(async (dir) => {
      const pidFile = join(dir, "pid");
      const running = gitRunAsync(hanging(pidFile), {
        cwd: dir,
        ...HANGING_INPUT,
        processGroup: true,
        timeoutMs: 300,
      });
      const pid = await grandchild(pidFile);
      await assert.rejects(running, GitTimeoutError);
      assertReached(pid, "the group's sleep outlived the stop");
    });
  });

  it("kills a group that will not stop when asked, and only then answers", async () => {
    await inScratch(async (dir) => {
      const pidFile = join(dir, "pid");
      const stop = new AbortController();
      const running = gitRunAsync(hanging(pidFile, true), {
        cwd: dir,
        ...HANGING_INPUT,
        processGroup: true,
        signal: stop.signal,
      });
      const pid = await grandchild(pidFile);
      const started = Date.now();
      stop.abort();
      await assert.rejects(running, GitStoppedError);
      const elapsed = Date.now() - started;
      // Asked first, then killed after the grace; where a stop cannot ask, at once.
      if (POLITE_STOP) {
        assert.ok(elapsed >= 1900, `answered after ${elapsed} ms, before the kill was due`);
      }
      assert.ok(elapsed < 5000, `answered after ${elapsed} ms`);
      assertReached(pid, "a sleep deaf to SIGTERM survived the kill");
    });
  });

  it("answers as usual when a grouped command finishes on its own", async () => {
    await inRepo(async (cwd) => {
      const stop = new AbortController();
      const grouped = await gitRunAsync(["rev-parse", "HEAD"], {
        cwd,
        processGroup: true,
        signal: stop.signal,
      });
      assert.deepEqual(grouped, gitRun(["rev-parse", "HEAD"], { cwd }));
      // Aborting once it is over changes nothing, and throws nothing.
      stop.abort();
    });
  });
});

describe("the async twins", () => {
  it("answer what their blocking forms answer", async () => {
    await inRepo(async (cwd) => {
      const first = resolveSha(cwd, "HEAD") as string;
      git(["checkout", "--quiet", "-b", "topic"], { cwd });
      writeFileSync(join(cwd, "b.txt"), "b\n");
      git(["add", "-A"], { cwd });
      git(["commit", "--quiet", "-m", "second"], { cwd });
      git(["checkout", "--quiet", "main"], { cwd });

      assert.equal(await currentBranchAsync(cwd), currentBranch(cwd));
      assert.equal(await resolveShaAsync(cwd, "topic"), resolveSha(cwd, "topic"));
      assert.equal(await resolveShaAsync(cwd, "nope"), null);
      assert.equal(await canFastForwardAsync(cwd, "topic"), canFastForward(cwd, "topic"));
      assert.equal(await isAlreadyMergedAsync(cwd, "topic"), isAlreadyMerged(cwd, "topic"));
      assert.equal(await canFastForwardAsync(cwd, "topic"), true);
      assert.equal(await isAlreadyMergedAsync(cwd, "topic"), false);
      assert.equal(await resolveShaAsync(cwd, "HEAD"), first);
    });
  });

  it("stage, commit and read conflicts of a merge", async () => {
    await inRepo(async (cwd) => {
      git(["checkout", "--quiet", "-b", "topic"], { cwd });
      writeFileSync(join(cwd, "a.txt"), "theirs\n");
      git(["commit", "--quiet", "-am", "theirs"], { cwd });
      git(["checkout", "--quiet", "main"], { cwd });
      writeFileSync(join(cwd, "b.txt"), "b\n");
      git(["add", "-A"], { cwd });
      git(["commit", "--quiet", "-m", "ours"], { cwd });

      assert.equal(await mergeNoCommitAsync(cwd, "topic"), "staged");
      assert.deepEqual(await conflictedPathsAsync(cwd), []);
      const merged = await commitMergeAsync(cwd, "Merge topic");
      assert.equal(merged, resolveSha(cwd, "HEAD"));
      assert.equal(await isAlreadyMergedAsync(cwd, "topic"), true);

      // And a real conflict is read back as the paths git could not merge.
      git(["checkout", "--quiet", "-b", "clash", "topic"], { cwd });
      writeFileSync(join(cwd, "a.txt"), "clashing\n");
      git(["commit", "--quiet", "-am", "clashing"], { cwd });
      git(["checkout", "--quiet", "main"], { cwd });
      writeFileSync(join(cwd, "a.txt"), "ours too\n");
      git(["commit", "--quiet", "-am", "ours too"], { cwd });
      assert.equal(await mergeNoCommitAsync(cwd, "clash"), "conflict");
      assert.deepEqual(await conflictedPathsAsync(cwd), ["a.txt"]);
    });
  });
});
