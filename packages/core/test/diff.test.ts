/**
 * Reading what a revision changes.
 *
 * A real repository, because what is under test is the shape of git's own
 * output: renames, binaries, quoted paths, a file with no newline. A stub
 * could only be wrong about those in ways git is right about.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  commitsBetween,
  commitsBetweenAsync,
  diffBetween,
  diffBetweenAsync,
  parseRawNumstat,
  parseUnifiedDiff,
  unquote,
} from "../src/git/diff.ts";
import { git } from "../src/git/exec.ts";

interface Repo {
  dir: string;
  write(path: string, content: string | Buffer): void;
  remove(path: string): void;
  commit(message: string): string;
}

function inRepo(use: (repo: Repo) => void | Promise<void>): void | Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "navbook-diff-"));
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true });
  git(["init", "--quiet", "-b", "main"], { cwd: dir });
  git(["config", "user.name", "Committer"], { cwd: dir });
  git(["config", "user.email", "committer@test.invalid"], { cwd: dir });
  git(["config", "commit.gpgsign", "false"], { cwd: dir });
  const repo: Repo = {
    dir,
    write(path, content) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    },
    remove(path) {
      rmSync(join(dir, path));
    },
    commit(message) {
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", message], {
        cwd: dir,
        env: {
          GIT_AUTHOR_NAME: "Alice",
          GIT_AUTHOR_EMAIL: "alice@example.com",
          GIT_AUTHOR_DATE: "2026-08-01T10:00:00Z",
          GIT_COMMITTER_DATE: "2026-08-01T10:00:00Z",
        },
      });
      return git(["rev-parse", "HEAD"], { cwd: dir }).trim();
    },
  };
  let result: void | Promise<void>;
  try {
    result = use(repo);
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result instanceof Promise) return result.finally(cleanup);
  cleanup();
  return result;
}

/** A base commit with a few files, and a head commit that changes them every way there is. */
function story(repo: Repo): { base: string; head: string } {
  repo.write("src/a.ts", "one\ntwo\nthree\n");
  repo.write("src/gone.ts", "bye\n");
  repo.write(
    "src/moved.ts",
    "export const value = 1;\nexport const other = 2;\nexport const more = 3;\n",
  );
  repo.write("pic.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
  repo.write("no-newline.txt", "last");
  const base = repo.commit("base");

  repo.write("src/a.ts", "one\n2\nthree\nfour\n");
  repo.remove("src/gone.ts");
  repo.remove("src/moved.ts");
  repo.write(
    "src/lib/moved.ts",
    "export const value = 1;\nexport const other = 2;\nexport const more = 3;\n",
  );
  repo.write("src/new.ts", "hello\n");
  repo.write("pic.bin", Buffer.from([9, 9, 9, 0, 0, 0]));
  repo.write("no-newline.txt", "last line");
  repo.commit("middle");
  repo.write('odd "name".txt', "x\n");
  repo.write("café.txt", "é\n");
  const head = repo.commit("head");
  return { base, head };
}

describe("diffBetween", () => {
  it("reports one record per file, with its status and counts", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const diff = diffBetween(repo.dir, base, head);
      const summary = diff.files.map((f) => [
        f.path,
        f.oldPath,
        f.status,
        f.additions,
        f.deletions,
        f.binary,
      ]);
      assert.deepEqual(summary, [
        ["café.txt", null, "added", 1, 0, false],
        ["no-newline.txt", null, "modified", 1, 1, false],
        ['odd "name".txt', null, "added", 1, 0, false],
        ["pic.bin", null, "modified", 0, 0, true],
        ["src/a.ts", null, "modified", 2, 1, false],
        ["src/gone.ts", null, "deleted", 0, 1, false],
        ["src/lib/moved.ts", "src/moved.ts", "renamed", 0, 0, false],
        ["src/new.ts", null, "added", 1, 0, false],
      ]);
      assert.equal(diff.additions, 6);
      assert.equal(diff.deletions, 3);
      assert.equal(diff.base, base);
      assert.equal(diff.head, head);
    }));

  it("keeps the hunks and only the hunks", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const diff = diffBetween(repo.dir, base, head);
      const a = diff.files.find((f) => f.path === "src/a.ts");
      assert.ok(a);
      assert.equal(a.patch, "@@ -1,3 +1,4 @@\n one\n-two\n+2\n three\n+four\n");
      assert.equal(a.lines, 6);
      const rename = diff.files.find((f) => f.status === "renamed");
      assert.equal(rename?.patch, "");
      assert.equal(rename?.lines, 0);
      const binary = diff.files.find((f) => f.binary);
      assert.equal(binary?.patch, "");
      const noNewline = diff.files.find((f) => f.path === "no-newline.txt");
      assert.match(noNewline?.patch ?? "", /\\ No newline at end of file/);
    }));

  it("answers the same listing without patches from the raw output", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const full = diffBetween(repo.dir, base, head);
      const listing = diffBetween(repo.dir, base, head, { patches: false });
      const strip = (files: typeof full.files) =>
        files.map(({ patch: _patch, lines: _lines, ...rest }) => rest);
      assert.deepEqual(strip(listing.files), strip(full.files));
      assert.equal(
        listing.files.every((f) => f.patch === ""),
        true,
      );
      // Without the hunks, the line count is what the counts add up to.
      assert.deepEqual(
        listing.files.map((f) => f.lines),
        full.files.map((f) => f.additions + f.deletions),
      );
      assert.equal(listing.additions, full.additions);
    }));

  it("narrows to the paths asked for, read literally", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const diff = diffBetween(repo.dir, base, head, { paths: ["src/new.ts", "src/gone.ts"] });
      assert.deepEqual(
        diff.files.map((f) => f.path),
        ["src/gone.ts", "src/new.ts"],
      );
      // A name that would be pathspec magic if it were read as a pattern.
      repo.write(":colon.txt", "x\n");
      repo.write("star*.txt", "y\n");
      const odd = repo.commit("odd names");
      assert.deepEqual(
        diffBetween(repo.dir, head, odd, { paths: [":colon.txt", "star*.txt"] }).files.map(
          (f) => f.path,
        ),
        [":colon.txt", "star*.txt"],
      );
    }));

  it("is the same answer awaited", () =>
    inRepo(async (repo) => {
      const { base, head } = story(repo);
      assert.deepEqual(
        await diffBetweenAsync(repo.dir, base, head),
        diffBetween(repo.dir, base, head),
      );
    }));

  it("refuses a commit the clone does not have", () =>
    inRepo(async (repo) => {
      const { head } = story(repo);
      await assert.rejects(
        diffBetweenAsync(repo.dir, "0123456789012345678901234567890123456789", head),
        /failed/,
      );
    }));

  it("is empty between a commit and itself", () =>
    inRepo((repo) => {
      const { head } = story(repo);
      assert.deepEqual(diffBetween(repo.dir, head, head), {
        base: head,
        head,
        files: [],
        additions: 0,
        deletions: 0,
      });
    }));
});

describe("commitsBetween", () => {
  it("lists the range oldest first, and says how many there are", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const range = commitsBetween(repo.dir, base, head);
      assert.equal(range.total, 2);
      assert.deepEqual(
        range.commits.map((c) => [c.subject, c.author]),
        [
          ["middle", "Alice <alice@example.com>"],
          ["head", "Alice <alice@example.com>"],
        ],
      );
      assert.equal(range.commits[1]?.sha, head);
      assert.equal(range.commits[0]?.date.toISOString(), "2026-08-01T10:00:00.000Z");
    }));

  it("keeps the oldest when limited", () =>
    inRepo((repo) => {
      const { base, head } = story(repo);
      const range = commitsBetween(repo.dir, base, head, 1);
      assert.equal(range.total, 2);
      assert.deepEqual(
        range.commits.map((c) => c.subject),
        ["middle"],
      );
    }));

  it("refuses a range git cannot walk, rather than calling it empty", () =>
    inRepo(async (repo) => {
      const { head } = story(repo);
      assert.throws(() => commitsBetween(repo.dir, "nope", head), /failed/);
      await assert.rejects(commitsBetweenAsync(repo.dir, "nope", head), /failed/);
    }));

  it("is the same answer awaited", () =>
    inRepo(async (repo) => {
      const { base, head } = story(repo);
      assert.deepEqual(
        await commitsBetweenAsync(repo.dir, base, head, 1),
        commitsBetween(repo.dir, base, head, 1),
      );
    }));
});

describe("parseUnifiedDiff", () => {
  it("reads a mode-only change and a pure rename, which have no +++ line", () => {
    const text = [
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/old name.txt b/new name.txt",
      "similarity index 100%",
      "rename from old name.txt",
      "rename to new name.txt",
      "",
    ].join("\n");
    assert.deepEqual(
      parseUnifiedDiff(text).map((f) => [f.path, f.oldPath, f.status, f.lines]),
      [
        ["run.sh", null, "modified", 0],
        ["new name.txt", "old name.txt", "renamed", 0],
      ],
    );
  });

  it("reads a copy, and a hunk whose lines begin with the header words", () => {
    const text = [
      "diff --git a/a.txt b/b.txt",
      "similarity index 90%",
      "copy from a.txt",
      "copy to b.txt",
      "index 1..2 100644",
      "--- a/a.txt",
      "+++ b/b.txt",
      "@@ -1 +1,2 @@",
      " x",
      "+--- not a header",
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(text);
    assert.equal(file?.status, "copied");
    assert.equal(file?.oldPath, "a.txt");
    assert.equal(file?.path, "b.txt");
    assert.equal(file?.additions, 1);
    assert.equal(file?.patch, "@@ -1 +1,2 @@\n x\n+--- not a header\n");
  });

  it("reads nothing from nothing", () => {
    assert.deepEqual(parseUnifiedDiff(""), []);
    assert.deepEqual(parseRawNumstat(""), []);
  });
});

describe("unquote", () => {
  it("reads git's C-style quoting", () => {
    assert.equal(unquote('"a\\"b"'), 'a"b');
    assert.equal(unquote('"tab\\there"'), "tab\there");
    assert.equal(unquote('"caf\\303\\251"'), "café");
    assert.equal(unquote("plain"), "plain");
  });
});

describe("parseUnifiedDiff, quoted headers", () => {
  it("reads a binary file whose name git had to quote", () => {
    const text = [
      'diff --git "a/we\\"ird.bin" "b/we\\"ird.bin"',
      "index 1..2 100644",
      'Binary files "a/we\\"ird.bin" and "b/we\\"ird.bin" differ',
      "",
    ].join("\n");
    const [file] = parseUnifiedDiff(text);
    assert.equal(file?.path, 'we"ird.bin');
    assert.equal(file?.binary, true);
  });

  it("drops the tab git puts after a path with a space in it", () => {
    const text = [
      "diff --git a/has space.txt b/has space.txt",
      "index 1..2 100644",
      "--- a/has space.txt\t",
      "+++ b/has space.txt\t",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");
    assert.equal(parseUnifiedDiff(text)[0]?.path, "has space.txt");
  });
});
