/**
 * Reading history, for the doctor checks that cannot be decided from the tree
 * alone (D7, D9, D10), for pinning pull-request revisions, and for the commit
 * listings a feature's timeline is built from.
 */

import { dedupePeople, type Person, parsePerson } from "../core/person.ts";
import { git, gitMaybe, gitRun, splitLines } from "./exec.ts";

/** ASCII SOH/STX: separators that cannot occur in a commit message or path. */
const RECORD_SEPARATOR = "\u0001";
const FIELD_SEPARATOR = "\u0002";

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
  const output = gitMaybe(
    ["log", "--follow", "--name-only", "--format=%x01%H%x02%aI", "--", path],
    { cwd },
  );
  if (output === null) return [];

  const versions: FileVersion[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    if (record.trim() === "") continue;
    const [header, ...rest] = record.split("\n");
    const [sha, authored] = (header ?? "").split(FIELD_SEPARATOR);
    if (!sha || !authored) continue;
    const names = rest.filter((line) => line.trim() !== "");
    const date = new Date(authored);
    if (Number.isNaN(date.getTime())) continue;
    versions.push({ sha, path: names[0] ?? path, authored: date });
  }
  return versions.reverse();
}

/** File contents at a commit, or null when the path did not exist there. */
export function blobAt(cwd: string, sha: string, path: string): string | null {
  const result = gitRun(["show", `${sha}:${path}`], { cwd });
  return result.code === 0 ? result.stdout : null;
}

/** The commit that introduced `path`, following renames. */
export function addedAt(cwd: string, path: string): FileVersion | null {
  return fileVersions(cwd, path)[0] ?? null;
}

/** True when `ancestor` is an ancestor of `descendant` (or the same commit). */
export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return gitRun(["merge-base", "--is-ancestor", ancestor, descendant], { cwd }).code === 0;
}

/** The merge base of two revisions, or null when they share no history. */
export function mergeBase(cwd: string, a: string, b: string): string | null {
  return gitMaybe(["merge-base", a, b], { cwd });
}

/** True when the object exists locally; false for an unfetched commit. */
export function objectExists(cwd: string, sha: string): boolean {
  return gitRun(["cat-file", "-e", `${sha}^{commit}`], { cwd }).code === 0;
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
  const args = ["log", `--format=%x01%H%x02%aI%x02%an <%ae>%x02%s%x02%B`];
  if (search.limit !== undefined) args.push("-n", String(search.limit));
  if (search.grep !== undefined) args.push("--extended-regexp", `--grep=${search.grep}`);
  if (search.paths?.length) args.push("--", ...search.paths);

  const result = gitRun(args, { cwd });
  if (result.code !== 0) return [];

  const out: CommitSummary[] = [];
  for (const record of result.stdout.split(RECORD_SEPARATOR)) {
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
