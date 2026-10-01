/**
 * Reading history, for the doctor checks that cannot be decided from the tree
 * alone (D7, D9, D10), for pinning pull-request revisions, and for the commit
 * listings a feature's timeline is built from.
 */

import { SHA_PATTERN } from "../core/files.ts";
import { dedupePeople, type Person, parsePerson } from "../core/person.ts";
import { git, gitMaybe, gitRun, gitRunAsync, splitLines } from "./exec.ts";

/** ASCII SOH/STX: separators that cannot occur in a commit message or path. */
const RECORD_SEPARATOR = "\u0001";
const FIELD_SEPARATOR = "\u0002";
/** The largest `-n` git accepts: it parses the count into a C `int`. */
const GIT_MAX_COUNT = 2 ** 31 - 1;

export interface FileVersion {
  sha: string;
  /** The file's path in that commit, which a rename may have changed. */
  path: string;
  authored: Date;
}

/**
 * Every commit that touched `path`, oldest first, following renames.
 *
 * `--follow` reports the path as it stood at each commit, which is what makes a
 * `pr.md` readable across its move from `prs/open/` to `prs/merged/`.
 */
export function fileVersions(cwd: string, path: string): FileVersion[] {
  return followFrom(cwd, "HEAD", path);
}

/**
 * {@link fileVersions} from `rev` back.
 *
 * A copy is where a file begins. `--follow` detects copies as well as renames,
 * so a new comment much like an older one reads as copied from it, and the
 * history would go on into the other file's; it stops at the copy instead.
 *
 * `nav pr merge` moves a pull request's files inside the merge commit, and
 * `git log` does not diff a merge, so `--follow` never sees that rename. The
 * history it gives then opens on whatever came after: an edit, a rename of the
 * moved file, or nothing at all. `-m` is no cure, because diffing a merge
 * against the parent that lacks a file pairs it with any similar file that
 * parent holds. So only a history that opens on an add or a copy is taken as
 * whole, and any other is resumed by hand from just before its oldest commit.
 *
 * Newer gits do follow that rename through the merge, but still without
 * listing the merge: the record before it names the file by its old path, with
 * nothing in between to say where the new one came from. So each record must
 * name the path the record after it came from, and the history stops at the
 * first that does not, to be resumed through the merge like any other.
 */
function followFrom(cwd: string, rev: string, path: string): FileVersion[] {
  // `-z` for paths as they are, never C-quoted: one resumed from is read back.
  const output = gitMaybe(
    ["log", "-z", "--follow", "--name-status", "--format=%x01%H%x02%aI", rev, "--", path],
    { cwd },
  );
  if (output === null) return [];

  const versions: FileVersion[] = [];
  // The oldest record's change: its status, and the path it had before it.
  let opening = { status: "", from: path };
  for (const record of output.split(RECORD_SEPARATOR)) {
    // `sha STX date NUL`, a newline, then NUL-terminated fields: `M`, path;
    // `A`, path; or `R087` or `C054`, old path, new path.
    const [header, status, ...paths] = record.split("\0");
    const [sha, authored] = (header ?? "").split(FIELD_SEPARATOR);
    if (!sha || !authored) continue;
    const date = new Date(authored);
    if (Number.isNaN(date.getTime())) continue;
    const named = paths.filter(Boolean);
    const current = named.at(-1) || path;
    // A rename this listing does not show, which only a merge can hide.
    if (current !== opening.from) break;
    versions.push({ sha, path: current, authored: date });
    opening = { status: (status ?? "").trim(), from: named[0] || current };
    if (opening.status.startsWith("C")) break;
  }
  versions.reverse();

  if (/^[AC]/.test(opening.status)) return versions;
  // The oldest commit `--follow` lists is never a merge, so `^` is its one
  // parent, and `from` is the path the file had there.
  const oldest = versions[0];
  const before = oldest
    ? throughMerge(cwd, `${oldest.sha}^`, opening.from)
    : throughMerge(cwd, rev, path);
  return [...before, ...versions];
}

/**
 * The history of `path` as of `rev`, for when `--follow` cannot see it: up to
 * and including the merge that brought the file into `rev`'s line.
 *
 * Without `--follow`, `git log` lists a merge that no parent shares the path
 * with, so the newest commit it names is that merge. Its diff against each
 * parent says which one held the file and under what name; where two could
 * have, the likelier rename wins.
 */
function throughMerge(cwd: string, rev: string, path: string): FileVersion[] {
  const output = gitMaybe(["log", "-n1", "--format=%H%x02%aI%x02%P", rev, "--", path], { cwd });
  const [sha, authored, parents] = (output ?? "").split(FIELD_SEPARATOR);
  const parentShas = (parents ?? "").split(" ").filter(Boolean);
  // A commit other than a merge is one `--follow` would have listed.
  if (!sha || !authored || parentShas.length < 2) return [];
  const date = new Date(authored);
  if (Number.isNaN(date.getTime())) return [];

  let best: { parent: string; from: string; score: number } | null = null;
  // Last parent first: the branch merged in is the one likely to hold it.
  for (const parent of [...parentShas].reverse()) {
    const source = mergeSources(cwd, parent, sha).get(path);
    if (source && source.score > (best?.score ?? -1)) best = { parent, ...source };
    if (best?.score === 100) break;
  }
  const merge: FileVersion = { sha, path, authored: date };
  // No parent held it under any name: the merge itself created it.
  if (!best) return [merge];
  return [...followFrom(cwd, best.parent, best.from), merge];
}

/** Where each file a merge changes came from in one parent, by its new path. */
type Sources = Map<string, { from: string; score: number }>;

/**
 * The diffs {@link mergeSources} has read, newest last. A merge's diff against
 * its first parent is the whole branch, and every file the merge moved asks
 * for it, once per check that reads history.
 */
const sourceCache = new Map<string, Sources>();
const SOURCE_CACHE_SIZE = 32;

/**
 * For each file `merge` holds that differs from `parent`, the path it had in
 * `parent` and how sure git is: a modification is the same path at 100, a
 * rename or copy is the old path at git's similarity score, and an add is not
 * listed. Commits never change, so neither does the answer.
 */
function mergeSources(cwd: string, parent: string, merge: string): Sources {
  const key = `${cwd}\0${parent}\0${merge}`;
  const cached = sourceCache.get(key);
  if (cached) return cached;

  const sources: Sources = new Map();
  const output = gitMaybe(["diff", "-z", "--name-status", "--find-renames", parent, merge], {
    cwd,
  });
  // NUL-terminated fields: `M`, path; or `R087`, old path, new path.
  const fields = (output ?? "").split("\0");
  for (let i = 0; i < fields.length; ) {
    const status = fields[i] ?? "";
    if (/^[RC]/.test(status)) {
      const [from, to] = [fields[i + 1] ?? "", fields[i + 2] ?? ""];
      sources.set(to, { from, score: Number(status.slice(1)) || 0 });
      i += 3;
    } else {
      const path = fields[i + 1] ?? "";
      if (/^[MT]/.test(status)) sources.set(path, { from: path, score: 100 });
      i += 2;
    }
  }

  if (sourceCache.size >= SOURCE_CACHE_SIZE) {
    sourceCache.delete(sourceCache.keys().next().value as string);
  }
  sourceCache.set(key, sources);
  return sources;
}

/** File contents at a commit, or null when the path did not exist there. */
export function blobAt(cwd: string, sha: string, path: string): string | null {
  const result = gitRun(["show", `${sha}:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
}

/** {@link blobAt}, without blocking. */
export async function blobAtAsync(cwd: string, sha: string, path: string): Promise<string | null> {
  const result = await gitRunAsync(["show", `${sha}:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
}

/**
 * A blob's contents by its own hash, or null when this repository lacks it.
 *
 * Null covers every way the object can be unusable: not fetched here, not a
 * blob at all, or not a hash. Only a hash-shaped argument reaches git, so a
 * caller may pass exactly what a client sent.
 */
export function blobContent(cwd: string, sha: string): string | null {
  if (!SHA_PATTERN.test(sha)) return null;
  const result = gitRun(["cat-file", "blob", sha], { cwd });
  return result.code === 0 ? result.stdout : null;
}

/** The commit that introduced `path`, following renames. */
export function addedAt(cwd: string, path: string): FileVersion | null {
  return fileVersions(cwd, path)[0] ?? null;
}

/** True when `ancestor` is an ancestor of `descendant` (or the same commit). */
export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return gitRun(isAncestorArgs(ancestor, descendant), { cwd }).code === 0;
}

/** {@link isAncestor} without blocking. */
export async function isAncestorAsync(
  cwd: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  return (await gitRunAsync(isAncestorArgs(ancestor, descendant), { cwd })).code === 0;
}

function isAncestorArgs(ancestor: string, descendant: string): string[] {
  return ["merge-base", "--is-ancestor", ancestor, descendant];
}

/** The merge base of two revisions, or null when they share no history. */
export function mergeBase(cwd: string, a: string, b: string): string | null {
  return gitMaybe(["merge-base", a, b], { cwd });
}

/** True when the object exists locally; false for an unfetched commit. */
export function objectExists(cwd: string, sha: string): boolean {
  return gitRun(["cat-file", "-e", `${sha}^{commit}`], { cwd }).code === 0;
}

/** {@link objectExists}, without blocking. */
export async function objectExistsAsync(cwd: string, sha: string): Promise<boolean> {
  return (await gitRunAsync(["cat-file", "-e", `${sha}^{commit}`], { cwd })).code === 0;
}

/** Commit messages of the given revision range, newest first. */
export function commitMessages(cwd: string, range: string, limit = 100): string[] {
  const output = gitMaybe(["log", "--format=%B%x00", "-n", String(limit), range], { cwd });
  if (output === null) return [];
  return output.split("\0").filter((message) => message.trim() !== "");
}

/** Branch names that contain the given commit. */
export function branchesContaining(cwd: string, sha: string): string[] {
  const output = gitMaybe(["branch", "--all", "--format=%(refname:short)", "--contains", sha], {
    cwd,
  });
  return output === null ? [] : splitLines(output);
}

/** Author date of a commit. */
export function authoredAt(cwd: string, sha: string): Date | null {
  const value = gitMaybe(["show", "-s", "--format=%aI", sha], { cwd });
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface CommitSummary {
  sha: string;
  subject: string;
  /** The author, formatted as `Name <email>`. */
  author: string;
  date: Date;
  /** The whole message, subject included, for a caller that must read it. */
  message: string;
}

export interface CommitSearch {
  /** Limit to commits touching these paths; a directory means everything under it. */
  paths?: readonly string[];
  /** Limit to commits whose message matches this extended regular expression. */
  grep?: string;
  limit?: number;
}

/**
 * Commits matching a search, newest first.
 *
 * One search, not two: git ANDs `--grep` with a pathspec, so asking for "this
 * path *or* this word" in a single invocation is not a thing `git log` can be
 * told to do. A caller that wants a union runs this twice and merges, which is
 * what {@link featureCommits} does.
 *
 * The whole message comes back because the only honest way to decide whether a
 * commit really references an entity is to parse it with the reference grammar
 * of spec 02 §2.9. A regular expression handed to git narrows the walk; it does
 * not get to be a second, differently-spelled definition of a reference.
 */
export function searchCommits(cwd: string, search: CommitSearch): CommitSummary[] {
  const args = ["log", ...COMMIT_LOG_ARGS];
  // git reads `-n` as a C int and refuses anything larger outright, which the
  // `code !== 0` below would report as no commits at all. No repository holds
  // that many, so a limit past it is no limit.
  if (search.limit !== undefined && search.limit <= GIT_MAX_COUNT) {
    args.push("-n", String(search.limit));
  }
  if (search.grep !== undefined) args.push("--extended-regexp", `--grep=${search.grep}`);
  if (search.paths?.length) args.push("--", ...search.paths);

  const result = gitRun(args, { cwd });
  if (result.code !== 0) return [];
  return parseCommitLog(result.stdout);
}

/**
 * The `git log` arguments every commit listing shares, and the reader of what
 * they print: one record per commit, the message last because it alone may
 * hold the field separator.
 *
 * `%aN`/`%aE` so that `.mailmap` is honoured, as {@link commitAuthors} does,
 * and no signature block, which `log.showSignature` would otherwise put
 * between the records.
 */
export const COMMIT_LOG_ARGS = [
  "--no-show-signature",
  "--format=%x01%H%x02%aI%x02%aN <%aE>%x02%s%x02%B",
] as const;

export function parseCommitLog(output: string): CommitSummary[] {
  const out: CommitSummary[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    if (record === "") continue;
    const [sha, authored, author, subject, ...rest] = record.split(FIELD_SEPARATOR);
    if (!sha || !authored || subject === undefined) continue;
    const date = new Date(authored);
    if (Number.isNaN(date.getTime())) continue;
    // The message is last and may itself hold the field separator, so whatever
    // follows the subject is the message rather than only the next field.
    out.push({
      sha,
      subject,
      author: author ?? "",
      date,
      message: rest.join(FIELD_SEPARATOR),
    });
  }
  return out;
}

/** Resolve a revision, throwing a useful message when it does not exist. */
export function requireSha(cwd: string, rev: string): string {
  return git(["rev-parse", "--verify", `${rev}^{commit}`], { cwd }).trim();
}

/**
 * Everyone who authored a commit reachable from `rev`, newest first.
 *
 * `%aN` and `%aE` rather than `%an` and `%ae`, so `.mailmap` is applied by git
 * itself — which is how the SHOULD of spec 02 §2.4 is honoured here without
 * this layer learning what a mailmap is. One entry per address, and since the
 * walk is newest first the name a person last committed under is the one that
 * survives.
 *
 * The separators are NUL and newline rather than the SOH and STX the listings
 * above use, because those two are the ones git guarantees: it truncates an
 * identity at a NUL and strips the newlines out of one, while a control
 * character like SOH survives in a name and would otherwise split a record
 * that is not finished. Angle brackets are stripped too, so composing the
 * address back from the two halves cannot be made to say something else.
 *
 * An author git accepts but the format's grammar does not — `root@localhost`,
 * whose domain has no dot — is skipped rather than offered: every person field
 * validates what it is given, so a suggestion that could not be saved is worse
 * than no suggestion at all.
 *
 * Empty where the revision does not resolve, which is the repository whose
 * branch is unborn as well as the one asked about a rev it does not have.
 */
export function commitAuthors(cwd: string, rev = "HEAD"): Person[] {
  const result = gitRun(
    // `--no-show-signature`: a clone with `log.showSignature` set would
    // otherwise interleave the signature's own lines into the output.
    ["log", "--no-show-signature", "--format=%aE%x00%aN", rev],
    // One short line per commit, where the default budget is sized for one
    // commit's patch: a history long enough to overflow 64 MB is not exotic.
    { cwd, maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.code !== 0) return [];

  const people: Person[] = [];
  for (const line of splitLines(result.stdout)) {
    const [email, name] = line.split("\0");
    if (email === undefined || email === "") continue;
    const person = parsePerson(name === undefined || name === "" ? email : `${name} <${email}>`);
    if (person !== null) people.push(person);
  }
  return dedupePeople(people);
}
