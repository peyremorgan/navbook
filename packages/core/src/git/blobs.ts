/**
 * Reading many blobs through `git cat-file`, in as few processes as their
 * sizes allow.
 *
 * One reader for every caller that reads blobs in bulk: the scan of other
 * branches, which asks by `<ref>:<path>` or by SHA, and the staged tree the
 * pre-commit hook judges, which asks by SHA.
 */

import { spawnSync } from "node:child_process";
import { exitedEarly, GitError, gitRun, spawnFailure, splitLines } from "./exec.ts";

/** A blob to read, with its size in bytes, as `ls-tree -l` or {@link blobSizes} gives it. */
export interface SizedBlob {
  sha: string;
  size: number;
}

/** How many bytes of blob content one batch of {@link readBlobsBySha} asks for, by default. */
export const BLOB_BATCH_BYTES = 64 * 1024 * 1024;

/**
 * The size of each blob, from one `cat-file --batch-check`.
 *
 * For a caller that knows the names but not the sizes, such as the index.
 * Anything other than a blob coming back throws: the names came from git, so
 * a gap is an object store that let it down.
 */
export function blobSizes(cwd: string, shas: readonly string[]): Map<string, number> {
  const sizes = new Map<string, number>();
  if (shas.length === 0) return sizes;
  const args = ["cat-file", "--batch-check"];
  const result = gitRun(args, { cwd, input: `${shas.join("\n")}\n` });
  if (result.code !== 0) throw new GitError(args, result);
  const lines = splitLines(result.stdout);
  for (const [index, sha] of shas.entries()) {
    // `<sha> blob <size>` for each name asked, in order.
    const [name, type, size] = (lines[index] ?? "").split(" ");
    if (name !== sha || type !== "blob" || !/^\d+$/.test(size ?? "")) {
      throw new Error(`git cat-file --batch-check could not size blob ${sha}`);
    }
    sizes.set(sha, Number(size));
  }
  return sizes;
}

/**
 * Read blobs named by SHA, in as many `cat-file --batch` processes as their
 * sizes need, each SHA once however often it is listed, and throw if any of
 * them does not come back.
 *
 * For a reader that listed the blobs itself, so every one of them is in a tree
 * or index git has just shown: an object missing now is a broken or partial
 * object store, not an absent file, and reading it as absent would drop
 * whatever it belonged to. Each batch's buffer is sized to what it asks for,
 * so a single blob larger than `batchBytes` is read alone rather than refused.
 */
export function readBlobsBySha(
  cwd: string,
  blobs: readonly SizedBlob[],
  batchBytes = BLOB_BATCH_BYTES,
): Map<string, string> {
  const out = new Map<string, string>();
  let batch: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    const maxBuffer = bytes + batch.length * 128 + 1024;
    for (const [sha, text] of catObjects(cwd, batch, maxBuffer)) out.set(sha, text);
    batch = [];
    bytes = 0;
  };
  for (const { sha, size } of new Map(blobs.map((blob) => [blob.sha, blob])).values()) {
    if (batch.length > 0 && bytes + size > batchBytes) flush();
    batch.push(sha);
    bytes += size;
  }
  if (batch.length > 0) flush();

  const missing = [...new Set(blobs.map((blob) => blob.sha))].filter((sha) => !out.has(sha));
  if (missing.length > 0) {
    throw new Error(
      `git cannot read ${missing.length === 1 ? "blob" : "blobs"} ${missing.join(", ")}, ` +
        "listed in a tree or index it has; the object store is incomplete",
    );
  }
  return out;
}

/**
 * `cat-file --batch` over `specs` — SHAs or `<rev>:<path>` — keyed by spec.
 *
 * A spec that names nothing, or names something other than a blob, is absent
 * from the result; what that absence means is the caller's to say. Anything
 * else that goes wrong throws, since a batch that could not be read is not a
 * batch of missing objects (#u0a6u6ev).
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
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error && !exitedEarly(result)) {
    throw spawnFailure(result.error as NodeJS.ErrnoException, args, maxBuffer);
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString("utf8");
    throw new GitError(args, { code: result.status ?? 1, stdout: "", stderr });
  }

  const stdout = result.stdout;
  let offset = 0;
  for (const spec of specs) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = stdout.subarray(offset, newline).toString("utf8");
    offset = newline + 1;

    // `<sha> <type> <size>`, then that many bytes and a newline; a spec that
    // names nothing answers `<spec> missing` and consumes no body.
    const [, type, size] = header.split(" ");
    const bytes = Number(size);
    if (size === undefined || Number.isNaN(bytes)) continue;
    if (type === "blob") out.set(spec, stdout.subarray(offset, offset + bytes).toString("utf8"));
    offset += bytes + 1;
  }
  return out;
}
