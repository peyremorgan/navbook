/**
 * Reading the Navbook directory out of branches that are not checked out.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so listing open PRs means enumerating refs, not walking the working
 * tree. Blobs are read through a single `git cat-file --batch` process so the
 * cost is one subprocess rather than one per file.
 */

import { spawnSync } from "node:child_process";
import {
  exitedEarly,
  GitError,
  git,
  gitMaybe,
  gitRun,
  spawnFailure,
  splitLines,
  splitNul,
} from "./exec.ts";

export interface Ref {
  /** Full ref name, e.g. `refs/heads/feat/auth`. */
  full: string;
  /** Short name, e.g. `feat/auth` or `origin/feat/auth`. */
  short: string;
  remote: boolean;
}

/** Local branches and fetched remote branches, excluding symbolic refs. */
export function listBranchRefs(cwd: string): Ref[] {
  const output = gitMaybe(
    [
      "for-each-ref",
      "--format=%(refname)%00%(refname:short)%00%(symref)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd },
  );
  if (output === null) return [];

  const refs: Ref[] = [];
  for (const line of splitLines(output)) {
    const [full, short, symref] = line.split("\0");
    if (!full || !short) continue;
    // Skip origin/HEAD and friends: they duplicate a branch already listed.
    if (symref !== undefined && symref !== "") continue;
    refs.push({ full, short, remote: full.startsWith("refs/remotes/") });
  }
  return refs;
}

/**
 * How much one `cat-file --batch` may send back. {@link readBlobsBySha} splits
 * its requests by their known sizes to stay under {@link BLOB_BATCH_BYTES}, so
 * only a single blob larger than this can reach it.
 */
const CAT_FILE_MAX_BUFFER = 256 * 1024 * 1024;

/** How many bytes of blob content one batch of {@link readBlobsBySha} asks for. */
const BLOB_BATCH_BYTES = 64 * 1024 * 1024;

export interface BlobRequest {
  ref: string;
  path: string;
}

/**
 * Read many blobs in one `git cat-file --batch` process.
 *
 * Results are keyed `<ref>:<path>`; missing objects are simply absent, which is
 * the normal case for a branch that has no Navbook directory at all.
 *
 * Anything else throws. A batch that could not be read is not a batch of
 * missing objects: answering with an empty map made a pull request whose
 * directory outgrew the buffer vanish from every listing without a word
 * (#u0a6u6ev).
 */
export function catBlobs(cwd: string, requests: readonly BlobRequest[]): Map<string, string> {
  return catObjects(
    cwd,
    requests.map((request) => `${request.ref}:${request.path}`),
  );
}

/**
 * Read blobs named by SHA, in as many `cat-file --batch` processes as their
 * sizes need, and throw if any of them is missing.
 *
 * For a reader that listed the blobs itself, so every one of them is in a tree
 * git has just shown: an object missing now is a broken or partial object
 * store, not an absent file, and reading it as absent would drop whatever it
 * belonged to. Each SHA is read once, however many trees share it.
 */
export function readBlobsBySha(
  cwd: string,
  blobs: readonly { sha: string; size: number }[],
  batchBytes = BLOB_BATCH_BYTES,
): Map<string, string> {
  const out = new Map<string, string>();
  let batch: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    for (const [sha, text] of catObjects(cwd, batch)) out.set(sha, text);
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
      `git cannot read ${missing.length === 1 ? "object" : "objects"} ${missing.join(", ")}, ` +
        "listed in a tree it has; the object store is incomplete",
    );
  }
  return out;
}

/** `cat-file --batch` over `specs`, keyed by spec; missing objects are absent. */
function catObjects(cwd: string, specs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (specs.length === 0) return out;

  const args = ["cat-file", "--batch"];
  // No `encoding` option: stdout must stay a Buffer, because the batch protocol
  // frames each blob by byte length rather than by any text delimiter.
  const result = spawnSync("git", args, {
    cwd,
    input: `${specs.join("\n")}\n`,
    maxBuffer: CAT_FILE_MAX_BUFFER,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error && !exitedEarly(result)) {
    throw spawnFailure(result.error as NodeJS.ErrnoException, args, CAT_FILE_MAX_BUFFER);
  }
  if (result.status !== 0) {
    throw new GitError(args, {
      code: result.status ?? 1,
      stdout: "",
      stderr: result.stderr.toString("utf8"),
    });
  }

  const stdout = result.stdout;
  let offset = 0;
  for (const spec of specs) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = stdout.subarray(offset, newline).toString("utf8");
    offset = newline + 1;

    // A missing object reports "<spec> missing" and consumes no body.
    const parts = header.split(" ");
    const size = Number(parts[2]);
    if (parts.length < 3 || Number.isNaN(size)) continue;

    out.set(spec, stdout.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1; // the body is followed by a newline
  }
  return out;
}

/**
 * Resolve many `<ref>:<path>` specs to object SHAs in one `cat-file
 * --batch-check` process.
 *
 * Only the header line is read, so no content crosses the pipe: this is how a
 * scan asks "which refs even have this directory?" before paying to read it.
 * Specs that name nothing — the normal case, for a branch with no Navbook
 * directory — are simply absent from the result. A batch git could not answer
 * throws, for the reason {@link catBlobs} does.
 */
export function batchResolve(cwd: string, specs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (specs.length === 0) return out;

  const args = ["cat-file", "--batch-check"];
  const result = gitRun(args, { cwd, input: `${specs.join("\n")}\n` });
  if (result.code !== 0) throw new GitError(args, result);

  // One line per spec, in the order asked: `<sha> <type> <size>` when it
  // resolves, `<spec> missing` or `<spec> ambiguous` when it does not.
  const lines = splitLines(result.stdout);
  for (const [index, line] of lines.entries()) {
    const spec = specs[index];
    if (spec === undefined) break;
    const parts = line.split(" ");
    const sha = parts[0];
    if (parts.length < 3 || !sha || Number.isNaN(Number(parts[2]))) continue;
    out.set(spec, sha);
  }
  return out;
}

export interface TreeEntry {
  type: "blob" | "tree" | "commit";
  sha: string;
  /** Bytes, for a blob; 0 for a subtree or a submodule. */
  size: number;
  /** Relative to the tree listed. */
  path: string;
}

/**
 * Every entry under a tree already resolved to a SHA, recursively, with the
 * subtrees themselves and each blob's size.
 *
 * Throws when git cannot list it. The SHA came from git, so a failure is a
 * broken object store, and an empty answer would read as a directory with
 * nothing in it.
 */
export function lsTreeEntries(cwd: string, tree: string): TreeEntry[] {
  const output = git(["ls-tree", "-r", "-t", "-l", "-z", tree], { cwd });
  const entries: TreeEntry[] = [];
  for (const record of splitNul(output)) {
    // `<mode> SP <type> SP <sha> SP+ <size or -> TAB <path>`
    const tab = record.indexOf("\t");
    const [, type, sha, size] = record.slice(0, tab).split(/ +/);
    if (type !== "blob" && type !== "tree" && type !== "commit") continue;
    if (sha === undefined) continue;
    const bytes = Number(size);
    entries.push({ type, sha, size: Number.isNaN(bytes) ? 0 : bytes, path: record.slice(tab + 1) });
  }
  return entries;
}

/** Entries directly inside a tree that has already been resolved to a SHA. */
export function lsTreeNamesOfTree(cwd: string, tree: string): string[] {
  const output = gitMaybe(["ls-tree", "--name-only", "-z", tree], { cwd });
  return output === null ? [] : splitNul(output).map((name) => name.replace(/\/$/, ""));
}
