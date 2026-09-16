/**
 * The non-blocking runner, held to the blocking one's contract.
 *
 * What it must match is everything a caller can observe — exit code, output,
 * input, the buffer limit — because the two runners back the same operations
 * and a difference between them would be a bug that only shows in the server.
 * What it adds, the timeout, is proved on a git that genuinely hangs.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  GitError,
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
