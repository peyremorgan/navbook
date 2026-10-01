/**
 * The index read as a tree, which is what `doctor --staged` — and so the
 * pre-commit hook — judges.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { git } from "../src/git/exec.ts";
import { stagedTree } from "../src/git/index-ops.ts";
import { recordInIndex } from "./helpers/platform.ts";

function inRepo(use: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-staged-"));
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    git(["config", "user.name", "Nav Test"], { cwd: dir });
    git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
    mkdirSync(join(dir, "nav"));
    use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Stage files under `nav/` without writing them to disk: what is under test
 * reads the index, and a name with a newline in it cannot be written to a
 * Windows disk.
 */
function stage(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    recordInIndex(dir, `nav/${name}`, content);
  }
}

/** The git commands `use` ran, from a `GIT_TRACE` log. */
function traced(dir: string, use: () => void): string[] {
  const log = join(dirname(dir), `${basename(dir)}.trace`);
  process.env.GIT_TRACE = log;
  try {
    use();
  } finally {
    delete process.env.GIT_TRACE;
  }
  const lines = readFileSync(log, "utf8").match(/built-in: git .*/g) ?? [];
  rmSync(log, { force: true });
  return lines.map((line) => line.replace(/^built-in: /, ""));
}

describe("stagedTree", () => {
  it("answers with the staged content, keyed below the directory", () => {
    inRepo((dir) => {
      stage(dir, { "a.md": "staged\n" });
      writeFileSync(join(dir, "nav", "a.md"), "on disk only\n");
      writeFileSync(join(dir, "outside.md"), "not under nav/\n");
      git(["add", "outside.md"], { cwd: dir });

      const tree = stagedTree(dir, "nav");
      assert.deepEqual([...tree.keys()], ["a.md"]);
      assert.equal(tree.get("a.md"), "staged\n");
      assert.equal(tree.get("b.md"), undefined);
    });
  });

  it("leaves out a staged deletion, whatever its name", () => {
    inRepo((dir) => {
      stage(dir, { "kept.md": "kept\n", "gone blob 5": "12345", "line\nbreak.md": "odd\n" });
      git(["commit", "--quiet", "-m", "fixture"], { cwd: dir });
      git(["rm", "--quiet", "--cached", "--", "nav/gone blob 5"], { cwd: dir });

      const tree = stagedTree(dir, "nav");
      assert.deepEqual([...tree.keys()].sort(), ["kept.md", "line\nbreak.md"]);
      assert.equal(tree.get("line\nbreak.md"), "odd\n");
    });
  });

  it("reads small blobs in batches of bounded size, and a large one only when asked", () => {
    inRepo((dir) => {
      const ten = (c: string) => c.repeat(10);
      stage(dir, {
        "a.md": ten("a"),
        "b.md": ten("b"),
        "c.md": ten("c"),
        "big.md": ten("z") + ten("z"),
      });

      const limits = { prefetch: 15, batch: 25 };
      let tree = stagedTree(dir, "nav", limits);
      const loading = traced(dir, () => {
        tree = stagedTree(dir, "nav", limits);
      });
      assert.equal(loading.filter((c) => c.startsWith("git cat-file --batch-check")).length, 1);
      assert.equal(
        loading.filter((c) => c === "git cat-file --batch").length,
        2,
        "30 bytes, 25 a batch",
      );
      assert.equal(loading.filter((c) => c.startsWith("git cat-file blob")).length, 0);

      const reading = traced(dir, () => {
        assert.equal(tree.get("a.md"), ten("a"));
        assert.equal(tree.get("c.md"), ten("c"));
        assert.equal(tree.get("big.md"), ten("z") + ten("z"));
        assert.equal(tree.get("big.md"), ten("z") + ten("z"));
      });
      assert.equal(reading.length, 1, `read once, on demand: ${reading.join("; ")}`);
      assert.match(reading[0] as string, /^git cat-file blob /);
    });
  });

  it("throws when git cannot read the index, rather than answering an empty tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-staged-"));
    try {
      assert.throws(() => stagedTree(dir, "nav"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
