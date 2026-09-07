/**
 * Index and commit operations.
 */

import type { Trailer } from "../core/ops.ts";
import { git, gitRun, splitLines, splitNul } from "./exec.ts";

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
 * Asked of git rather than computed here, because the answer depends on the
 * repository: which hash algorithm it uses, and which filters its attributes
 * apply. A hash worked out in this process would be right for most
 * repositories and quietly wrong for the rest.
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
