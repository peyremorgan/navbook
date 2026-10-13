/**
 * The worktrees a front end makes for a write of its own — spec 02 §2.10.
 *
 * What matters is what is on disk afterwards, and what a commit made there
 * records: only the Navbook directory and the files at the root are written
 * out, and nothing left out of the checkout is left out of a commit.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { git } from "../src/git/exec.ts";
import {
  addSparseWorktree,
  conePatterns,
  isConeDir,
  SPARSE_CHECKOUT_ARGS,
} from "../src/git/repo.ts";
import { makeWsCtx } from "../src/workspace/ctx.ts";
import { addWriteWorktree } from "../src/workspace/worktree.ts";
import { NO_GIT_SHIM } from "./helpers/platform.ts";

/** A repository with a Navbook directory at `navDir`, code beside it, and a branch `feat`. */
function inRepo(navDir: string, use: (dir: string, scratch: string) => void): void {
  const scratch = mkdtempSync(join(tmpdir(), "navbook-worktree-"));
  const dir = join(scratch, "repo");
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    git(["config", "user.name", "Nav Test"], { cwd: dir });
    git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
    const write = (path: string, text: string): void => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    write(`${navDir}/navbook.json`, '{\n  "version": 1\n}\n');
    write(`${navDir}/prs/open/.gitkeep`, "");
    write("README.md", "readme\n");
    write("src/deep/code.ts", "export {};\n");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "--quiet", "-m", "first"], { cwd: dir });
    git(["branch", "feat"], { cwd: dir });
    use(dir, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every path git tracks at `rev`. */
function tracked(dir: string, rev: string): string[] {
  return git(["ls-tree", "-r", "--name-only", rev], { cwd: dir }).trim().split("\n");
}

describe("conePatterns", () => {
  it("names the directory, and keeps the files above it", () => {
    assert.deepEqual(conePatterns([".navbook"]), ["/*", "!/*/", "/.navbook/"]);
    assert.deepEqual(conePatterns([".github/navbook"]), [
      "/*",
      "!/*/",
      "/.github/",
      "!/.github/*/",
      "/.github/navbook/",
    ]);
  });
});

describe("conePatterns, for several directories", () => {
  it("shares the parents they have in common, and drops one inside another", () => {
    assert.deepEqual(conePatterns([".github/navbook", ".github/hooks", ".github/navbook/x"]), [
      "/*",
      "!/*/",
      "/.github/",
      "!/.github/*/",
      "/.github/hooks/",
      "/.github/navbook/",
    ]);
  });

  it("names no parent that is itself checked out in full", () => {
    assert.deepEqual(conePatterns([".navbook", ".husky/_", ".husky"]), [
      "/*",
      "!/*/",
      "/.husky/",
      "/.navbook/",
    ]);
  });
});

describe("isConeDir", () => {
  it("takes a plain directory at any depth", () => {
    for (const dir of [".navbook", ".github/navbook", "docs/my tracker"]) {
      assert.equal(isConeDir(dir), true, dir);
    }
  });

  it("refuses the root, and a name a pattern would read as something else", () => {
    for (const dir of ["", ".", "a//b", "../x", "t*k", "t?k", "[t]", "a\\b", "line\nbreak", "x "]) {
      assert.equal(isConeDir(dir), false, JSON.stringify(dir));
    }
  });
});

describe("addSparseWorktree", () => {
  it("writes out the Navbook directory and the files at the root, and nothing else", () => {
    inRepo(".navbook", (dir, scratch) => {
      const at = join(scratch, "wt");
      addSparseWorktree(dir, at, "feat", [".navbook"]);
      assert.ok(existsSync(join(at, ".navbook", "navbook.json")));
      assert.ok(existsSync(join(at, "README.md")));
      assert.equal(existsSync(join(at, "src")), false);
      assert.equal(git(["status", "--porcelain"], { cwd: at }), "");
    });
  });

  it("brings the files of each directory above a nested Navbook directory", () => {
    inRepo(".github/navbook", (dir, scratch) => {
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "* @x\n");
      mkdirSync(join(dir, ".github", "workflows"));
      writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "on: push\n");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", "github"], { cwd: dir });
      git(["branch", "-f", "feat"], { cwd: dir });

      const at = join(scratch, "wt");
      addSparseWorktree(dir, at, "feat", [".github/navbook"]);
      assert.ok(existsSync(join(at, ".github", "navbook", "navbook.json")));
      assert.ok(existsSync(join(at, ".github", "CODEOWNERS")));
      assert.equal(existsSync(join(at, ".github", "workflows")), false);
      assert.equal(existsSync(join(at, "src")), false);
    });
  });

  it("commits what was written, and keeps every path it never wrote out", () => {
    inRepo(".navbook", (dir, scratch) => {
      const at = join(scratch, "wt");
      addSparseWorktree(dir, at, "feat", [".navbook"]);
      writeFileSync(join(at, ".navbook", "prs", "open", "note.md"), "note\n");
      git(["add", "--", ".navbook/prs/open/note.md"], { cwd: at });
      // As a person would commit there by hand: with none of the settings.
      git(["commit", "--quiet", "-m", "note"], { cwd: at });
      assert.deepEqual(tracked(dir, "feat"), [
        ".navbook/navbook.json",
        ".navbook/prs/open/.gitkeep",
        ".navbook/prs/open/note.md",
        "README.md",
        "src/deep/code.ts",
      ]);
    });
  });

  it("keeps a merge there to the cone, given the settings", () => {
    inRepo(".navbook", (dir, scratch) => {
      git(["checkout", "--quiet", "-b", "upstream", "feat"], { cwd: dir });
      writeFileSync(join(dir, "src", "new.ts"), "export {};\n");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", "upstream"], { cwd: dir });
      git(["checkout", "--quiet", "main"], { cwd: dir });

      const at = join(scratch, "wt");
      addSparseWorktree(dir, at, "feat", [".navbook"]);
      git([...SPARSE_CHECKOUT_ARGS, "merge", "--quiet", "--no-ff", "--no-edit", "upstream"], {
        cwd: at,
      });
      assert.equal(existsSync(join(at, "src")), false);
      assert.ok(tracked(dir, "feat").includes("src/new.ts"));
    });
  });

  it("leaves the clone's own config alone", () => {
    inRepo(".navbook", (dir, scratch) => {
      const before = git(["config", "--list", "--local"], { cwd: dir });
      addSparseWorktree(dir, join(scratch, "wt"), "feat", [".navbook"]);
      assert.equal(git(["config", "--list", "--local"], { cwd: dir }), before);
    });
  });

  it("takes the patterns away with the worktree", () => {
    inRepo(".navbook", (dir, scratch) => {
      const at = join(scratch, "wt");
      addSparseWorktree(dir, at, "feat", [".navbook"]);
      const file = git(
        ["rev-parse", "--path-format=absolute", "--git-path", "info/sparse-checkout"],
        { cwd: at },
      ).trim();
      assert.ok(existsSync(file));
      git(["worktree", "remove", "--force", at], { cwd: dir });
      assert.equal(existsSync(file), false);
    });
  });

  it("removes the worktree again when it cannot be filled", { skip: NO_GIT_SHIM }, () => {
    inRepo(".navbook", (dir, scratch) => {
      // A git that refuses `read-tree`, and is otherwise the one after it on PATH.
      const bin = join(scratch, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "git"),
        [
          "#!/bin/sh",
          'for a in "$@"; do [ "$a" = read-tree ] && { echo refused >&2; exit 1; }; done',
          // Drop the shim's own directory, first on PATH, and run the real git.
          `PATH="$\{PATH#*:}" exec git "$@"`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const path = process.env.PATH;
      process.env.PATH = `${bin}:${path}`;
      const at = join(scratch, "wt");
      try {
        assert.throws(() => addSparseWorktree(dir, at, "feat", [".navbook"]), /refused/);
      } finally {
        process.env.PATH = path;
      }
      assert.equal(existsSync(at), false);
      const listed = git(["worktree", "list", "--porcelain"], { cwd: dir })
        .split("\n")
        .filter((line) => line.startsWith("worktree "));
      assert.equal(listed.length, 1);
    });
  });
  it("unregisters the worktree even when git will not remove it", { skip: NO_GIT_SHIM }, () => {
    inRepo(".navbook", (dir, scratch) => {
      const bin = join(scratch, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "git"),
        [
          "#!/bin/sh",
          'for a in "$@"; do case "$a" in read-tree|remove) echo refused >&2; exit 1;; esac; done',
          `PATH="$\{PATH#*:}" exec git "$@"`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const path = process.env.PATH;
      process.env.PATH = `${bin}:${path}`;
      const at = join(scratch, "wt");
      try {
        assert.throws(() => addSparseWorktree(dir, at, "feat", [".navbook"]), /refused/);
      } finally {
        process.env.PATH = path;
      }
      assert.equal(existsSync(at), false);
      // Nothing holds the branch: it can be checked out again at once.
      git(["worktree", "add", "--quiet", join(scratch, "again"), "feat"], { cwd: dir });
    });
  });
});

describe("addWriteWorktree", () => {
  it("checks out a hooks directory inside the tree, so the hooks still run", () => {
    inRepo(".navbook", (dir, scratch) => {
      // As husky arranges it: hooks in the tree, found by a relative path.
      mkdirSync(join(dir, ".githooks"));
      const log = join(scratch, "hook.log");
      writeFileSync(join(dir, ".githooks", "pre-commit"), `#!/bin/sh\necho ran >> '${log}'\n`, {
        mode: 0o755,
      });
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "--no-verify", "-m", "hooks"], { cwd: dir });
      git(["branch", "-f", "feat"], { cwd: dir });
      git(["config", "core.hooksPath", ".githooks/"], { cwd: dir });

      const at = join(scratch, "wt");
      assert.deepEqual(addWriteWorktree(makeWsCtx({ cwd: dir }), at, "feat"), { sparse: true });
      assert.ok(existsSync(join(at, ".githooks", "pre-commit")));
      assert.equal(existsSync(join(at, "src")), false);
      writeFileSync(join(at, ".navbook", "note.md"), "note\n");
      git(["add", "--", ".navbook/note.md"], { cwd: at });
      git(["commit", "--quiet", "-m", "note"], { cwd: at });
      assert.ok(existsSync(log), "the pre-commit hook ran");
    });
  });

  it("checks out nothing more for a hooks directory outside the tree", () => {
    inRepo(".navbook", (dir, scratch) => {
      git(["config", "core.hooksPath", join(scratch, "hooks")], { cwd: dir });
      const at = join(scratch, "wt");
      assert.deepEqual(addWriteWorktree(makeWsCtx({ cwd: dir }), at, "feat"), { sparse: true });
      assert.deepEqual(
        git(["ls-files", "-t"], { cwd: at })
          .trim()
          .split("\n")
          .filter((line) => line.startsWith("S ")),
        ["S src/deep/code.ts"],
      );
    });
  });

  it("is sparse by default", () => {
    inRepo(".navbook", (dir, scratch) => {
      const at = join(scratch, "wt");
      const made = addWriteWorktree(makeWsCtx({ cwd: dir }), at, "feat");
      assert.deepEqual(made, { sparse: true });
      assert.equal(existsSync(join(at, "src")), false);
    });
  });

  it("checks out everything when the marker says so", () => {
    inRepo(".navbook", (dir, scratch) => {
      writeFileSync(
        join(dir, ".navbook", "navbook.json"),
        '{ "version": 1, "worktrees": { "sparse": false } }\n',
      );
      const at = join(scratch, "wt");
      const made = addWriteWorktree(makeWsCtx({ cwd: dir }), at, "feat");
      assert.deepEqual(made, { sparse: false });
      assert.ok(existsSync(join(at, "src", "deep", "code.ts")));
    });
  });

  it("reports a policy it cannot read, and stays sparse", () => {
    inRepo(".navbook", (dir, scratch) => {
      writeFileSync(
        join(dir, ".navbook", "navbook.json"),
        '{ "version": 1, "worktrees": { "sparse": "no" } }\n',
      );
      const problems: string[] = [];
      const made = addWriteWorktree(makeWsCtx({ cwd: dir }), join(scratch, "wt"), "feat", (p) =>
        problems.push(p),
      );
      assert.deepEqual(made, { sparse: true });
      assert.deepEqual(problems, ["'worktrees.sparse' must be true or false"]);
    });
  });

  it("checks out everything for a Navbook directory no pattern can name", () => {
    inRepo("t*k", (dir, scratch) => {
      const at = join(scratch, "wt");
      const made = addWriteWorktree(makeWsCtx({ cwd: dir }), at, "feat");
      assert.deepEqual(made, { sparse: false });
      assert.ok(existsSync(join(at, "src", "deep", "code.ts")));
      assert.ok(existsSync(join(at, "t*k", "navbook.json")));
    });
  });
});
