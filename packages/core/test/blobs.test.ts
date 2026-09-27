import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { blobSizes, catObjects, MAX_READ_BYTES, readBlobsBySha } from "../src/git/blobs.ts";
import { GitError, git, gitRun } from "../src/git/exec.ts";
import { lsTreeEntries } from "../src/git/refscan.ts";

const dir = mkdtempSync(join(tmpdir(), "navbook-blobs-"));
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

describe("blobSizes", () => {
  it("sizes each blob in one batch", () => {
    const blobs = lsTreeEntries(dir, tree);
    const sizes = blobSizes(
      dir,
      blobs.map((blob) => blob.sha),
    );
    assert.deepEqual(
      sizes,
      blobs.map((blob, index) => ({ sha: blob.sha, size: Buffer.byteLength(texts[index] ?? "") })),
    );
  });

  it("throws on a name that is not a blob in the store", () => {
    assert.throws(() => blobSizes(dir, [tree]), /could not size blob/);
    assert.throws(() => blobSizes(dir, ["2".repeat(40)]), /could not size blob/);
    // Said in the caller's words, so a failing hook says where to look.
    assert.throws(() => blobSizes(dir, [tree], { what: "staged" }), /could not size staged blob/);
  });
});

describe("catObjects", () => {
  it("reads blobs by path or name, and leaves out what is missing or not a blob", () => {
    const [first] = lsTreeEntries(dir, tree);
    const read = catObjects(dir, ["HEAD:f1.txt", tree, "HEAD:nope", first?.sha ?? ""], 1 << 20);
    assert.deepEqual(
      [...read],
      [
        ["HEAD:f1.txt", texts[1]],
        [first?.sha, texts[0]],
      ],
    );
  });
});

describe("catObjects framing", () => {
  it("reads past a missing path whose name looks like a header", () => {
    // Git echoes a missing spec back verbatim: `HEAD:a blob 12 z missing`
    // must not be read as a 12-byte blob, eating the next answer.
    const read = catObjects(dir, ["HEAD:a blob 12 z", "HEAD:f1.txt", "HEAD:f2.txt"], 1 << 20);
    assert.deepEqual(
      [...read],
      [
        ["HEAD:f1.txt", texts[1]],
        ["HEAD:f2.txt", texts[2]],
      ],
    );
  });

  it("throws on an answer that does not frame as asked, rather than misfiling it", () => {
    const bin = mkdtempSync(join(tmpdir(), "navbook-shim-"));
    // Answers every request with the first file's header and body, whatever
    // was asked: a reply that belongs to another name.
    const [first, second] = lsTreeEntries(dir, tree);
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\ncat >/dev/null\nprintf '${first?.sha} blob 4\\none\\n\\n'\n`,
      { mode: 0o755 },
    );
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      assert.throws(
        () => catObjects(dir, [second?.sha ?? ""], 1 << 20),
        /answered '[0-9a-f]+' with an unexpected header/,
      );
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
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
      read = readBlobsBySha(dir, blobs, { batchBytes: 1 });
    });
    assert.equal(read.size, 3);
    assert.equal(count, 3);
  });

  it("refuses a blob larger than it will hold, before reading anything", () => {
    const [first] = blobs;
    let thrown: unknown;
    const count = batches(() => {
      try {
        readBlobsBySha(dir, [{ sha: first?.sha ?? "", size: MAX_READ_BYTES + 1 }], {
          what: "branch",
        });
      } catch (error) {
        thrown = error;
      }
    });
    assert.match(
      String(thrown),
      /branch blob [0-9a-f]+ is \d+ bytes, more than the \d+ Navbook reads/,
    );
    assert.equal(count, 0);
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
