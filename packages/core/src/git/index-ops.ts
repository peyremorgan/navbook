/**
 * Index and commit operations.
 */

import type { Trailer } from "../core/ops.ts";
import type { NavTree } from "../core/tree.ts";
import { BLOB_BATCH_BYTES, blobSizes, MAX_READ_BYTES, readBlobsBySha } from "./blobs.ts";
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

/** Limits on how {@link stagedTree} reads; a parameter so tests can shrink them. */
export interface StagedReadLimits {
  /** The largest blob read up front; a bigger one waits until it is asked for. */
  prefetch: number;
  /** The most bytes one `cat-file --batch` process is given to read. */
  batch: number;
}

const STAGED_READ_LIMITS: StagedReadLimits = { prefetch: 1024 * 1024, batch: BLOB_BATCH_BYTES };

/**
 * The files staged under `dir`, as a tree keyed by their path below it.
 *
 * Only stage-0 blobs are listed: a staged deletion is not in the index at all,
 * a conflicted path has no stage 0, and a submodule is not a file, which is
 * what `git show :<path>` failing on each of them used to say.
 *
 * Whatever the number of files, this costs `ls-files`, one `cat-file
 * --batch-check` for the sizes and one `cat-file --batch` per
 * {@link StagedReadLimits.batch} bytes of blobs up to
 * {@link StagedReadLimits.prefetch}. A larger blob is read on its own when
 * `parseTree` asks for it, so a big report or image nothing parses is listed
 * and never read; a small one rides along in the batch, where it costs bytes
 * rather than a process.
 *
 * Objects are asked for by name, never by path, so no line git answers with
 * can carry a path, and a path may hold any byte git allows. A blob that
 * cannot be read throws: the pre-commit hook would otherwise judge a tree with
 * files missing from it, and pass it.
 */
export function stagedTree(
  cwd: string,
  dir: string,
  limits: StagedReadLimits = STAGED_READ_LIMITS,
): NavTree {
  const prefix = `${dir}/`;
  // `<mode> <sha> <stage>\t<path>`, NUL-terminated.
  const shaOf = new Map<string, string>();
  for (const entry of splitNul(git(["ls-files", "--stage", "-z", "--", dir], { cwd }))) {
    const tab = entry.indexOf("\t");
    const [mode, sha, stage] = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    if (stage !== "0" || mode === "160000" || sha === undefined) continue;
    if (path.startsWith(prefix)) shaOf.set(path.slice(prefix.length), sha);
  }

  const sizes = blobSizes(cwd, [...new Set(shaOf.values())], { what: "staged" });
  const sizeOf = new Map(sizes.map((blob) => [blob.sha, blob.size]));
  const contents = readBlobsBySha(
    cwd,
    sizes.filter((blob) => blob.size <= limits.prefetch),
    { what: "staged", batchBytes: limits.batch },
  );

  return {
    keys: () => shaOf.keys(),
    get(key) {
      const sha = shaOf.get(key);
      if (sha === undefined) return undefined;
      let text = contents.get(sha);
      if (text === undefined) {
        const size = sizeOf.get(sha) as number;
        if (size > MAX_READ_BYTES) {
          throw new Error(
            `staged ${key} is ${size} bytes, more than the ${MAX_READ_BYTES} Navbook reads`,
          );
        }
        text = git(["cat-file", "blob", sha], { cwd, maxBuffer: size + 1024 });
        contents.set(sha, text);
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
