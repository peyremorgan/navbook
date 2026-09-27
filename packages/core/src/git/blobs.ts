/**
 * Reading many blobs through `git cat-file`, in as few processes as their
 * sizes allow.
 *
 * One reader for every caller that reads blobs in bulk: the scan of other
 * branches, which asks by `<ref>:<path>` or by SHA, and the staged tree the
 * pre-commit hook judges, which asks by SHA. Internal to the git layer; the
 * operations reach it through `refscan.ts` and `index-ops.ts`.
 */

import { spawnSync } from "node:child_process";
import { exitedEarly, GitError, gitEnv, gitRun, spawnFailure, splitLines } from "./exec.ts";

/** A blob to read, with its size in bytes, as `ls-tree -l` or {@link blobSizes} gives it. */
export interface SizedBlob {
  sha: string;
  size: number;
}

/** How many bytes of blob content one batch of {@link readBlobsBySha} asks for, by default. */
export const BLOB_BATCH_BYTES = 64 * 1024 * 1024;

/**
 * The most one read may bring back, for a batch or a single blob.
 *
 * A Markdown file this size is not one anybody wrote; it is also near where
 * V8 stops being able to hold the text as a string at all. Refusing it up
 * front names the file, where reading it would fail later and say nothing.
 */
export const MAX_READ_BYTES = 256 * 1024 * 1024;

/** Where the names being read came from, for messages: "staged", say. */
export interface ReadContext {
  /** An adjective for the blobs, e.g. "staged"; empty says nothing extra. */
  what?: string;
}

const described = (context: ReadContext, noun: string): string =>
  context.what ? `${context.what} ${noun}` : noun;

/**
 * The size of each blob, from one `cat-file --batch-check`.
 *
 * For a caller that knows the names but not the sizes, such as the index.
 * Anything other than a blob coming back throws: the names came from git, so
 * a gap is an object store that let it down.
 */
export function blobSizes(
  cwd: string,
  shas: readonly string[],
  context: ReadContext = {},
): SizedBlob[] {
  if (shas.length === 0) return [];
  const args = ["cat-file", "--batch-check"];
  const result = gitRun(args, { cwd, input: `${shas.join("\n")}\n` });
  if (result.code !== 0) throw new GitError(args, result);
  const lines = splitLines(result.stdout);
  return shas.map((sha, index) => {
    // `<sha> blob <size>` for each name asked, in order.
    const [name, type, size] = (lines[index] ?? "").split(" ");
    if (name !== sha || type !== "blob" || !/^\d+$/.test(size ?? "")) {
      throw new Error(
        `git cat-file --batch-check could not size ${described(context, "blob")} ${sha}`,
      );
    }
    return { sha, size: Number(size) };
  });
}

/**
 * Read blobs named by SHA, in as many `cat-file --batch` processes as their
 * sizes need, each SHA once however often it is listed, and throw if any of
 * them does not come back.
 *
 * For a reader that listed the blobs itself, so every one of them is in a tree
 * or index git has just shown: an object missing now is a broken or partial
 * object store, not an absent file, and reading it as absent would drop
 * whatever it belonged to. Each batch's buffer is sized to what it asks for;
 * a blob larger than `batchBytes` is read alone, and one larger than
 * {@link MAX_READ_BYTES} is refused before anything is read.
 */
export function readBlobsBySha(
  cwd: string,
  blobs: readonly SizedBlob[],
  opts: ReadContext & { batchBytes?: number } = {},
): Map<string, string> {
  const batchBytes = opts.batchBytes ?? BLOB_BATCH_BYTES;
  const unique = new Map(blobs.map((blob) => [blob.sha, blob.size]));
  for (const [sha, size] of unique) {
    if (size > MAX_READ_BYTES) {
      throw new Error(
        `${described(opts, "blob")} ${sha} is ${size} bytes, more than the ${MAX_READ_BYTES} Navbook reads`,
      );
    }
  }

  const out = new Map<string, string>();
  let batch: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    const maxBuffer = bytes + batch.length * 128 + 1024;
    for (const [sha, text] of catObjects(cwd, batch, maxBuffer)) out.set(sha, text);
    batch = [];
    bytes = 0;
  };
  for (const [sha, size] of unique) {
    if (batch.length > 0 && bytes + size > batchBytes) flush();
    batch.push(sha);
    bytes += size;
  }
  if (batch.length > 0) flush();

  const missing = [...unique.keys()].filter((sha) => !out.has(sha));
  if (missing.length > 0) {
    const noun = described(opts, missing.length === 1 ? "blob" : "blobs");
    throw new Error(
      `git cannot read ${noun} ${missing.join(", ")}, listed in a tree or index it has; ` +
        "the object store is incomplete",
    );
  }
  return out;
}

/** A full object name, SHA-1 or SHA-256. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * `cat-file --batch` over `specs` — SHAs or `<rev>:<path>` — keyed by spec.
 *
 * A spec that names nothing, or names something other than a blob, is absent
 * from the result; what that absence means is the caller's to say. Anything
 * else that goes wrong throws, since a batch that could not be read is not a
 * batch of missing objects (#u0a6u6ev) — and that includes an answer that
 * does not frame as asked, which would otherwise file one object's bytes
 * under the next one's name.
 */
export function catObjects(
  cwd: string,
  specs: readonly string[],
  maxBuffer: number,
): Map<string, string> {
  const out = new Map<string, string>();
  if (specs.length === 0) return out;

  const args = ["cat-file", "--batch"];
  // No `encoding` option: stdout must stay a Buffer, because the batch protocol
  // frames each object by byte length rather than by any text delimiter.
  const result = spawnSync("git", args, {
    cwd,
    input: `${specs.join("\n")}\n`,
    maxBuffer,
    env: gitEnv(undefined),
  });
  if (result.error && !exitedEarly(result)) {
    throw spawnFailure(result.error as NodeJS.ErrnoException, args, maxBuffer);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString("utf8");
    throw new GitError(args, { code: result.status ?? 1, stdout: "", stderr });
  }

  const stdout = result.stdout;
  const unframed = (spec: string, header: string): Error =>
    new Error(`git cat-file --batch answered '${spec}' with an unexpected header: '${header}'`);
  let offset = 0;
  for (const spec of specs) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline === -1) throw unframed(spec, "");
    const header = stdout.subarray(offset, newline).toString("utf8");
    offset = newline + 1;

    // A spec that names nothing is echoed back — spaces and all, when it is a
    // path — with one word after it, and no body.
    if (header === `${spec} missing` || header === `${spec} ambiguous`) continue;

    // Otherwise `<name> <type> <size>`, with no spaces in any of them, then
    // that many bytes and a newline. Asked by name, the name must be the one
    // asked for.
    const [name, type, size, ...rest] = header.split(" ");
    const bytes = Number(size);
    const nameMatches = !OBJECT_NAME.test(spec) || name === spec;
    if (
      rest.length > 0 ||
      !OBJECT_NAME.test(name ?? "") ||
      !/^\d+$/.test(size ?? "") ||
      !nameMatches
    ) {
      throw unframed(spec, header);
    }
    if (type === "blob") out.set(spec, stdout.subarray(offset, offset + bytes).toString("utf8"));
    offset += bytes + 1;
  }
  return out;
}
