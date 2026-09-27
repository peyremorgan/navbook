import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { GitError, git, gitRun } from "../src/git/exec.ts";
import { lsTreeEntries, readBlobsBySha } from "../src/git/refscan.ts";

const dir = mkdtempSync(join(tmpdir(), "navbook-refscan-"));
after(() => rmSync(dir, { recursive: true, force: true }));
git(["init", "--quiet", "-b", "main"], { cwd: dir });
git(["config", "user.name", "Nav Test"], { cwd: dir });
git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
git(["config", "commit.gpgsign", "false"], { cwd: dir });
const texts = ["one\n", "two, longer\n", "three, the longest of them\n"];
for (const [index, text] of texts.entries()) writeFileSync(join(dir, `f${index}.txt`), text);
git(["add", "-A"], { cwd: dir });
git(["commit", "--quiet", "-m", "files"], { cwd: dir });
const tree = git(["rev-parse", "HEAD^{tree}"], { cwd: dir }).trim();

describe("lsTreeEntries", () => {
  it("lists each blob with its SHA and size", () => {
    const entries = lsTreeEntries(dir, tree);
    assert.deepEqual(
      entries.map(({ type, size, path }) => [type, size, path]),
      texts.map((text, index) => ["blob", Buffer.byteLength(text), `f${index}.txt`]),
    );
  });

  it("throws on a tree git cannot list, rather than answering nothing", () => {
    assert.throws(() => lsTreeEntries(dir, "0".repeat(40)));
  });
});

describe("readBlobsBySha", () => {
  const blobs = lsTreeEntries(dir, tree);

  /** How many `cat-file --batch` processes `use` started, from git's trace. */
  const batches = (use: () => void): number => {
    const trace = join(dir, ".git", "trace.log");
    rmSync(trace, { force: true });
    process.env.GIT_TRACE = trace;
    try {
      use();
    } finally {
      delete process.env.GIT_TRACE;
    }
    const lines = existsSync(trace) ? readFileSync(trace, "utf8").split("\n") : [];
    return lines.filter((line) => /built-in: git cat-file --batch$/.test(line)).length;
  };

  it("reads every blob, each once, however often it is asked for", () => {
    let read = new Map<string, string>();
    const count = batches(() => {
      read = readBlobsBySha(dir, [...blobs, ...blobs]);
    });
    assert.deepEqual(
      blobs.map((blob) => read.get(blob.sha)),
      texts,
    );
    assert.equal(count, 1);
  });

  it("splits the reads by size, so no batch outgrows its buffer", () => {
    // A budget smaller than any one blob: one batch each.
    let read = new Map<string, string>();
    const count = batches(() => {
      read = readBlobsBySha(dir, blobs, 1);
    });
    assert.equal(read.size, 3);
    assert.equal(count, 3);
  });

  it("throws on an object the store does not have", () => {
    assert.throws(
      () => readBlobsBySha(dir, [{ sha: "1".repeat(40), size: 1 }]),
      /object store is incomplete/,
    );
  });
});

describe("a git that exits before reading its input", () => {
  it("is reported by what git said, not by the broken pipe", () => {
    const bin = mkdtempSync(join(tmpdir(), "navbook-shim-"));
    writeFileSync(join(bin, "git"), '#!/bin/sh\necho "fatal: not today" >&2\nexit 128\n', {
      mode: 0o755,
    });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      // Far more than a pipe holds, so the write is still going when git exits.
      const many = Array.from({ length: 5000 }, (_, index) => ({
        sha: index.toString(16).padStart(40, "0"),
        size: 1,
      }));
      assert.throws(
        () => readBlobsBySha(dir, many),
        (error: unknown) => error instanceof GitError && /fatal: not today/.test(error.message),
      );
      const run = gitRun(["cat-file", "--batch-check"], { cwd: dir, input: "x\n".repeat(100_000) });
      assert.equal(run.code, 128);
      assert.match(run.stderr, /fatal: not today/);
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

describe("gitRun", () => {
  it("names the command and the limit when git says more than the buffer holds", () => {
    assert.throws(
      () => gitRun(["cat-file", "-p", tree], { cwd: dir, maxBuffer: 8 }),
      /^Error: git cat-file -p [0-9a-f]+ produced more than 8 bytes of output$/,
    );
  });
});
