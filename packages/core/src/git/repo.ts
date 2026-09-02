/**
 * Repository discovery and identity.
 *
 * The Navbook directory sits at the repository root (spec 02 §2.1), so "walk up
 * like git does" and "ask git for the top level" are the same answer.
 *
 * Its *name* defaults to `.navbook` but is not fixed: a repository may use
 * another one, and says so by the {@link NAV_MARKER} file the directory
 * carries. Locating the directory by a file inside it is what lets a rename
 * survive a clone — an environment variable would have to be set again by every
 * contributor, whereas the marker is committed with the tree it describes.
 */

import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV_MARKER } from "../core/tree.ts";
import { git, gitMaybe, gitRun, splitLines, splitNul } from "./exec.ts";

/** The directory name used unless a repository says otherwise. */
export const DEFAULT_NAV_DIR = ".navbook";

/** Never searched for a marker: neither can hold a Navbook directory. */
const UNSEARCHABLE = new Set([".git", "node_modules"]);

export interface RepoPaths {
  repoRoot: string;
  /** The directory's name relative to the repository root, in POSIX form. */
  navDir: string;
  navRoot: string;
  hasNavbook: boolean;
}

export class NotARepositoryError extends Error {}

/** More than one directory claims to be the Navbook root. */
export class AmbiguousNavRootError extends Error {
  readonly candidates: string[];

  constructor(candidates: string[]) {
    super(`more than one Navbook directory found: ${candidates.join(", ")}`);
    this.name = "AmbiguousNavRootError";
    this.candidates = candidates;
  }
}

/**
 * Locate the repository root containing `cwd`, and its Navbook directory.
 *
 * `navDir` overrides discovery entirely; it is the caller's job to have
 * validated it. The directory it names need not exist — `hasNavbook` reports
 * that, so `nav init` can be told where to create one.
 */
export function findRepo(cwd: string, navDir?: string): RepoPaths {
  const top = gitMaybe(["rev-parse", "--show-toplevel"], { cwd });
  if (top === null) {
    throw new NotARepositoryError(`not inside a git repository: ${cwd}`);
  }
  const repoRoot = top;
  const dir = navDir ?? discoverNavDir(repoRoot);
  const navRoot = join(repoRoot, ...dir.split("/"));
  // A *directory*, not merely something at that path: a plain file there is
  // not a tree to read, and treating it as one reports an empty tracker and
  // then fails with a raw ENOTDIR on the first write.
  return { repoRoot, navDir: dir, navRoot, hasNavbook: isDirectory(navRoot) };
}

/** True when `path` is a directory, or a symlink to one. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The Navbook directory of `repoRoot`, by name.
 *
 * The default is checked first, so the overwhelmingly common repository costs
 * one `stat` and never scans anything. Only when it is absent does the marker
 * search run: first over the root's own children, then — for a directory
 * nested deeper, like `.github/navbook/` — over what git has staged. The git
 * pass is second because it cannot see a marker that was never added, which is
 * every marker between `nav init` writing it and the commit landing.
 *
 * Finding nothing is not an error: it yields the default name with
 * `hasNavbook` false, which is how "run `nav init`" gets reported.
 */
export function discoverNavDir(repoRoot: string): string {
  if (isDirectory(join(repoRoot, DEFAULT_NAV_DIR))) return DEFAULT_NAV_DIR;
  let candidates = markersInChildren(repoRoot);
  if (candidates.length === 0) candidates = markersInIndex(repoRoot);
  if (candidates.length > 1) throw new AmbiguousNavRootError(candidates);
  return candidates[0] ?? DEFAULT_NAV_DIR;
}

/** Directories one level below the root that carry a marker. */
function markersInChildren(repoRoot: string): string[] {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(repoRoot, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    // A symlinked directory is followed deliberately: `existsSync` resolves it,
    // and a repository that arranges its tree that way still has one root.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (UNSEARCHABLE.has(entry.name)) continue;
    if (existsSync(join(repoRoot, entry.name, NAV_MARKER))) found.push(entry.name);
  }
  return found.sort();
}

/** Directories at any depth whose marker git has staged or committed. */
function markersInIndex(repoRoot: string): string[] {
  // Raw stdout, not `gitMaybe`: that trims, and `-z` output is NUL-delimited,
  // so trimming would eat a leading space belonging to the first path's name.
  const listed = gitRun(["ls-files", "--cached", "-z", "--", `*/${NAV_MARKER}`], {
    cwd: repoRoot,
  });
  if (listed.code !== 0) return [];
  const dirs = new Set<string>();
  for (const path of splitNul(listed.stdout)) {
    const cut = path.lastIndexOf("/");
    if (cut <= 0) continue;
    const dir = path.slice(0, cut);
    if (!UNSEARCHABLE.has(dir.split("/")[0] ?? "")) dirs.add(dir);
  }
  return [...dirs].sort();
}

/** Current branch name, or null when HEAD is detached. */
export function currentBranch(cwd: string): string | null {
  const name = gitMaybe(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd });
  return name === null || name === "" ? null : name;
}

/** Resolve a revision to a full 40-hex SHA, or null when it does not exist. */
export function resolveSha(cwd: string, rev: string): string | null {
  const sha = gitMaybe(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd });
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** True when the repository has at least one commit. */
export function hasCommits(cwd: string): boolean {
  return resolveSha(cwd, "HEAD") !== null;
}

/**
 * The repository's default branch — the tracker of record (spec 03 §3.1).
 *
 * Prefers what `origin/HEAD` designates, then a configured `init.defaultBranch`
 * that actually exists, then conventional names, then the current branch.
 */
export function defaultBranch(cwd: string): string | null {
  const originHead = gitMaybe(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
    cwd,
  });
  if (originHead?.startsWith("origin/")) {
    const name = originHead.slice("origin/".length);
    if (name !== "") return name;
  }
  const branches = new Set(
    splitLines(
      gitMaybe(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd }) ?? "",
    ),
  );
  const configured = gitMaybe(["config", "--get", "init.defaultBranch"], { cwd });
  if (configured && branches.has(configured)) return configured;
  for (const candidate of ["main", "master", "trunk"]) {
    if (branches.has(candidate)) return candidate;
  }
  return currentBranch(cwd);
}

export interface Identity {
  name?: string;
  email: string;
}

export class MissingIdentityError extends Error {}

/** Author identity from `git config user.name` / `user.email` (spec 04 §4.2). */
export function userIdentity(cwd: string): Identity {
  const email = gitMaybe(["config", "--get", "user.email"], { cwd });
  if (!email) {
    throw new MissingIdentityError(
      "git user.email is not configured; run `git config --global user.email you@example.com`",
    );
  }
  const name = gitMaybe(["config", "--get", "user.name"], { cwd });
  return name ? { name, email } : { email };
}

/** True when the working tree and index have no changes at all. */
export function isTreeClean(cwd: string): boolean {
  const status = gitRun(["status", "--porcelain"], { cwd });
  return status.code === 0 && status.stdout.trim() === "";
}

/** True when a merge is currently in progress. */
export function isMergeInProgress(cwd: string): boolean {
  const gitDir = gitMaybe(["rev-parse", "--git-dir"], { cwd });
  if (!gitDir) return false;
  const absolute = gitDir.startsWith("/") ? gitDir : join(cwd, gitDir);
  return existsSync(join(absolute, "MERGE_HEAD"));
}

/** Absolute path of the repository's git directory. */
export function gitDir(cwd: string): string {
  return git(["rev-parse", "--absolute-git-dir"], { cwd }).trim();
}

/** Absolute path of the hooks directory git will actually use. */
export function hooksDir(cwd: string): string {
  const path = git(["rev-parse", "--git-path", "hooks"], { cwd }).trim();
  return path.startsWith("/") ? path : join(cwd, path);
}
