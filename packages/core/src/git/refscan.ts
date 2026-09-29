/**
 * Reading the Navbook directory out of branches that are not checked out.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so listing open PRs means enumerating refs, not walking the working
 * tree. Their blobs are read through `blobs.ts`, a few `cat-file --batch`
 * processes for the lot rather than one per file.
 */

import { catObjects, MAX_READ_BYTES } from "./blobs.ts";
import { GitError, git, gitMaybe, gitRun, splitLines, splitNul } from "./exec.ts";

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

export interface BlobRequest {
  ref: string;
  path: string;
}

/**
 * Read many blobs in one `git cat-file --batch` process.
 *
 * Results are keyed `<ref>:<path>`; missing objects are simply absent, which is
 * the normal case for a branch that has no Navbook directory at all. Anything
 * else throws (see {@link catObjects}).
 */
export function catBlobs(cwd: string, requests: readonly BlobRequest[]): Map<string, string> {
  return catObjects(
    cwd,
    requests.map((request) => `${request.ref}:${request.path}`),
    // Asked by path, so the sizes are not known and cannot size the buffer;
    // a reader that knows them uses `readBlobsBySha` (`blobs.ts`) instead.
    MAX_READ_BYTES,
  );
}

/**
 * Resolve many `<ref>:<path>` specs to object SHAs in one `cat-file
 * --batch-check` process.
 *
 * Only the header line is read, so no content crosses the pipe: this is how a
 * scan asks "which refs even have this directory?" before paying to read it.
 * Specs that name nothing — the normal case, for a branch with no Navbook
 * directory — are simply absent from the result, and so are specs naming an
 * object of another `type` when one is asked for: a branch where `prs/open` is
 * a file or a symlink has no directory there, and listing it as a tree would
 * fail. A batch git could not answer throws, for the reason {@link catBlobs}
 * does.
 */
export function batchResolve(
  cwd: string,
  specs: readonly string[],
  type?: "blob" | "tree",
): Map<string, string> {
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
    if (type !== undefined && parts[1] !== type) continue;
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
