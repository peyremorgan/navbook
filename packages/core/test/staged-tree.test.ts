/**
 * The index read as a tree, which is what `doctor --staged` — and so the
 * pre-commit hook — judges.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { git } from "../src/git/exec.ts";
import { stagedTree } from "../src/git/index-ops.ts";

function inRepo(use: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-staged-"));
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stagedTree", () => {
  it("answers with the staged content, keyed below the prefix", () => {
    inRepo((dir) => {
      writeFileSync(join(dir, "a.md"), "staged\n");
      git(["add", "a.md"], { cwd: dir });
      writeFileSync(join(dir, "a.md"), "on disk only\n");

      const tree = stagedTree(dir, ["a.md"], "");
      assert.deepEqual([...tree.keys()], ["a.md"]);
      assert.equal(tree.get("a.md"), "staged\n");
      assert.equal(tree.get("b.md"), undefined);
    });
  });

  it("leaves out a path the index holds no blob for", () => {
    inRepo((dir) => {
      writeFileSync(join(dir, "kept.md"), "kept\n");
      git(["add", "kept.md"], { cwd: dir });

      const tree = stagedTree(dir, ["kept.md", "deleted.md"], "");
      assert.deepEqual([...tree.keys()], ["kept.md"]);
    });
  });

  it("throws when git cannot read the index, rather than answering an empty tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-staged-"));
    try {
      // git either refuses the batch or exits before reading it (EPIPE);
      // either way the answer must not be an empty tree.
      assert.throws(() => stagedTree(dir, ["a.md"], ""));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
