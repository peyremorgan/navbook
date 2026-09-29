/**
 * Creating and deleting local branches, and asking git whether a name is one.
 *
 * The server writes a pull request on its source branch through a local copy
 * of that branch; these are the three calls that make and tidy the copy.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitError, git } from "../src/git/exec.ts";
import { createBranch, deleteBranch, isValidBranchName, resolveSha } from "../src/git/repo.ts";

function inRepo(use: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-branches-"));
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    git(["config", "user.name", "Nav Test"], { cwd: dir });
    git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "--quiet", "-m", "first"], { cwd: dir });
    use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("createBranch", () => {
  it("makes a branch at the start point, without checking it out", () => {
    inRepo((dir) => {
      createBranch(dir, "feat/x", "main");
      assert.equal(resolveSha(dir, "refs/heads/feat/x"), resolveSha(dir, "main"));
      assert.equal(git(["branch", "--show-current"], { cwd: dir }).trim(), "main");
    });
  });

  it("refuses a branch that already exists rather than moving it", () => {
    inRepo((dir) => {
      createBranch(dir, "feat/x", "main");
      writeFileSync(join(dir, "b.txt"), "b\n");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", "second"], { cwd: dir });
      const before = resolveSha(dir, "refs/heads/feat/x");
      assert.throws(() => createBranch(dir, "feat/x", "main"), GitError);
      assert.equal(resolveSha(dir, "refs/heads/feat/x"), before);
    });
  });
});

describe("deleteBranch", () => {
  it("deletes a branch still at the expected commit", () => {
    inRepo((dir) => {
      createBranch(dir, "gone", "main");
      deleteBranch(dir, "gone", resolveSha(dir, "main") as string);
      assert.equal(resolveSha(dir, "refs/heads/gone"), null);
    });
  });

  it("leaves a branch that moved since, and says so", () => {
    inRepo((dir) => {
      const first = resolveSha(dir, "main") as string;
      createBranch(dir, "moved", "main");
      git(["checkout", "--quiet", "moved"], { cwd: dir });
      writeFileSync(join(dir, "c.txt"), "c\n");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", "on moved"], { cwd: dir });
      git(["checkout", "--quiet", "main"], { cwd: dir });
      assert.throws(() => deleteBranch(dir, "moved", first), GitError);
      assert.notEqual(resolveSha(dir, "refs/heads/moved"), null);
    });
  });
});

describe("isValidBranchName", () => {
  it("accepts what git accepts and nothing else", () => {
    inRepo((dir) => {
      for (const name of ["main", "feat/x", "fix/abcd1234-thing", "origin/feat"]) {
        assert.equal(isValidBranchName(dir, name), true, name);
      }
      for (const name of ["", "-x", "a..b", "a b", "x.lock", "a~1", "a:b", "@", "@{-1}", "HEAD"]) {
        assert.equal(isValidBranchName(dir, name), false, JSON.stringify(name));
      }
    });
  });
});
