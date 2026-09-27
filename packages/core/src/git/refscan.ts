/**
 * Reading the Navbook directory out of branches that are not checked out.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so listing open PRs means enumerating refs, not walking the working
 * tree. Blobs are read through a single `git cat-file --batch` process so the
 * cost is one subprocess rather than one per file.
 */

import { spawnSync } from "node:child_process";
import { GitError, gitMaybe, gitRun, spawnFailure, splitLines, splitNul } from "./exec.ts";

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

/** Entries directly inside `dir` at `ref`; empty when the path does not exist. */
export function lsTreeNames(cwd: string, ref: string, dir: string): string[] {
  const output = gitMaybe(["ls-tree", "--name-only", "-z", `${ref}:${dir}`], { cwd });
  return output === null ? [] : splitNul(output).map((name) => name.replace(/\/$/, ""));
}

/** Every file path under `dir` at `ref`, recursively. */
export function lsTreeRecursive(cwd: string, ref: string, dir: string): string[] {
  const output = gitMaybe(["ls-tree", "-r", "--name-only", "-z", `${ref}:${dir}`], { cwd });
  return output === null ? [] : splitNul(output);
}

/**
 * How much a single `catBlobs` batch may read. Only files a reader parses are
 * asked for, so this bounds Markdown, not whatever data sits beside it.
 */
const CAT_BLOBS_MAX_BUFFER = 256 * 1024 * 1024;

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
  const out = new Map<string, string>();
  if (requests.length === 0) return out;

  const args = ["cat-file", "--batch"];
  const specs = requests.map((request) => `${request.ref}:${request.path}`);
  // No `encoding` option: stdout must stay a Buffer, because the batch protocol
  // frames each blob by byte length rather than by any text delimiter.
  const result = spawnSync("git", args, {
    cwd,
    input: `${specs.join("\n")}\n`,
    maxBuffer: CAT_BLOBS_MAX_BUFFER,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === "ENOBUFS") {
      throw new Error(
        `git ${args.join(" ")} produced more than ${CAT_BLOBS_MAX_BUFFER} bytes reading ${specs.length} blobs`,
      );
    }
    throw spawnFailure(error);
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

/** Every file path under a tree that has already been resolved to a SHA, recursively. */
export function lsTreeRecursiveOfTree(cwd: string, tree: string): string[] {
  const output = gitMaybe(["ls-tree", "-r", "--name-only", "-z", tree], { cwd });
  return output === null ? [] : splitNul(output);
}

/** Entries directly inside a tree that has already been resolved to a SHA. */
export function lsTreeNamesOfTree(cwd: string, tree: string): string[] {
  const output = gitMaybe(["ls-tree", "--name-only", "-z", tree], { cwd });
  return output === null ? [] : splitNul(output).map((name) => name.replace(/\/$/, ""));
}
