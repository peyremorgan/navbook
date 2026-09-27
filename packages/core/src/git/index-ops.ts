/**
 * Index and commit operations.
 */

import type { Trailer } from "../core/ops.ts";
import type { NavTree } from "../core/tree.ts";
import { GitError, git, gitRun, splitLines, splitNul } from "./exec.ts";
import { catBlobs } from "./refscan.ts";

/** Repository-relative paths currently staged in the index. */
export function stagedPaths(cwd: string): string[] {
  const head = gitRun(["rev-parse", "--verify", "--quiet", "HEAD"], { cwd });
  const args =
    head.code === 0 ? ["diff", "--cached", "--name-only", "-z"] : ["ls-files", "--cached", "-z"];
  return splitNul(git(args, { cwd }));
}

/** Contents of a staged file, or null when it is not in the index. */
export function stagedContent(cwd: string, path: string): string | null {
  const result = gitRun(["show", `:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
}

/**
 * The largest staged file {@link stagedTree} reads up front. A bigger one
 * waits until it is asked for, which for extension data (§2.12) is never.
 */
const PREFETCH_LIMIT = 1024 * 1024;

/**
 * Staged files as a tree, keyed by their path with `prefix` removed.
 *
 * A path the index holds no blob for — a staged deletion, a conflicted path
 * with no stage 0 — is left out, as it was when each file cost a
 * `git show :<path>` that failed. The rest costs two `git cat-file`
 * processes whatever their number: one for each blob's size, one to read
 * every blob up to {@link PREFETCH_LIMIT}. A larger file is read on its own
 * when asked for, so a report or an image nothing parses is listed and never
 * read.
 *
 * A blob the first process found and the second did not return means the
 * batch failed, and throws: the pre-commit hook would otherwise judge a tree
 * with files missing from it, and pass it.
 */
export function stagedTree(cwd: string, paths: readonly string[], prefix: string): NavTree {
  if (paths.length === 0) return new Map();
  // The batch protocol is one spec per line, so a path with a newline in it,
  // which git allows, is read on its own rather than splitting the batch.
  const batched = paths.filter((path) => !path.includes("\n"));
  const args = ["cat-file", "--batch-check"];
  const check = gitRun(args, { cwd, input: batched.map((path) => `:${path}\n`).join("") });
  if (check.code !== 0) throw new GitError(args, check);

  // One line per spec, in the order asked: `<sha> <type> <size>`, or
  // `<spec> missing` when the index has nothing at stage 0 for it.
  const sizes = new Map<string, number>();
  for (const [index, line] of splitLines(check.stdout).entries()) {
    const path = batched[index];
    const [, type, size] = line.split(" ");
    if (path !== undefined && type === "blob") sizes.set(path, Number(size));
  }

  const small = [...sizes].filter(([, size]) => size <= PREFETCH_LIMIT).map(([path]) => path);
  const read = catBlobs(
    cwd,
    small.map((path) => ({ ref: "", path })),
  );
  const contents = new Map<string, string>();
  for (const path of small) {
    const text = read.get(`:${path}`);
    if (text === undefined) throw new Error(`git cat-file --batch did not return ':${path}'`);
    contents.set(path, text);
  }
  for (const path of paths) {
    if (!path.includes("\n")) continue;
    const text = stagedContent(cwd, path);
    if (text !== null) contents.set(path, text);
  }

  const listed = [...sizes.keys(), ...contents.keys()];
  const keys = new Map(listed.map((path) => [path.slice(prefix.length), path]));
  return {
    keys: () => keys.keys(),
    get(key) {
      const path = keys.get(key);
      if (path === undefined) return undefined;
      let text = contents.get(path);
      if (text === undefined) {
        const size = sizes.get(path) ?? 0;
        text = git(["cat-file", "blob", `:${path}`], { cwd, maxBuffer: size + 1024 });
        contents.set(path, text);
      }
      return text;
    },
  };
}

/**
 * Everything under `pathspecs` that differs from HEAD — staged, unstaged or
 * untracked — as the `XY path` lines `git status --short` would print.
 *
 * Used to tell content git could give back from content it could not, so a
 * destructive command only stops to ask when there is something to lose.
 */
export function uncommittedPaths(cwd: string, pathspecs: readonly string[]): string[] {
  if (pathspecs.length === 0) return [];
  const args = ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...pathspecs];
  const fields = splitNul(git(args, { cwd }));
  const entries: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] as string;
    entries.push(entry);
    // A rename or copy is reported as one record followed by its origin path
    // in a field of its own; that field is not a status entry.
    if (entry.startsWith("R") || entry.startsWith("C")) i++;
  }
  return entries;
}

/**
 * Blob hashes of files as they stand on disk, keyed by the path asked for.
 *
 * The name git's object store would give each file — which depends on the
 * repository: which hash algorithm it uses, and which filters its attributes
 * apply — and so asked of git rather than computed here. That is not what a
 * `baseSha` is: that one names a version of the text, whatever the repository
 * would store for it, and is `core/hash.ts`'s `blobSha`. Reach for this only
 * when the object store's own name is wanted.
 *
 * Batched, since the caller usually wants a directory's worth at once and one
 * subprocess is the difference between a listing costing one and costing one
 * per file. git refuses the whole batch when any path is unreadable, and an
 * empty map is the honest answer to "what do these look like now".
 */
export function hashObjects(cwd: string, paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const result = gitRun(["hash-object", "--", ...paths], { cwd });
  if (result.code !== 0) return out;
  const hashes = splitLines(result.stdout);
  if (hashes.length !== paths.length) return out;
  for (const [index, path] of paths.entries()) out.set(path, hashes[index] as string);
  return out;
}

/** The blob hash of one file on disk, or null when it cannot be read. */
export function hashObject(cwd: string, path: string): string | null {
  return hashObjects(cwd, [path]).get(path) ?? null;
}

/** Repository-relative paths of every file in the index. */
export function indexPaths(cwd: string): string[] {
  return splitNul(git(["ls-files", "--cached", "-z"], { cwd }));
}

/** Stage the given paths, including deletions. */
export function add(cwd: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  git(["add", "--all", "--", ...paths], { cwd });
}

/** Move a tracked path, staging the rename. */
export function move(cwd: string, from: string, to: string): void {
  git(["mv", "--", from, to], { cwd });
}

/** Compose a commit message from a subject and its trailers. */
export function composeMessage(subject: string, trailers: readonly Trailer[]): string {
  if (trailers.length === 0) return `${subject}\n`;
  const lines = trailers.map((t) => `${t.key}: ${t.id}`);
  return `${subject}\n\n${lines.join("\n")}\n`;
}

/** Create a commit from what is currently staged. */
export function commit(cwd: string, message: string, opts: { allowEmpty?: boolean } = {}): string {
  const args = ["commit", "--quiet", "-m", message];
  if (opts.allowEmpty) args.push("--allow-empty");
  git(args, { cwd });
  return git(["rev-parse", "HEAD"], { cwd }).trim();
}
