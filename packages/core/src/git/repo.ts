/**
 * Repository discovery and identity.
 *
 * `.navbook/` always sits at the repository root (spec 02 §2.1), so "walk up
 * like git does" and "ask git for the top level" are the same answer.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, gitMaybe, gitRun, splitLines } from "./exec.ts";

export const NAVBOOK_DIR = ".navbook";

export interface RepoPaths {
  repoRoot: string;
  navRoot: string;
  hasNavbook: boolean;
}

export class NotARepositoryError extends Error {}

/** Locate the repository root containing `cwd`, and its `.navbook/` directory. */
export function findRepo(cwd: string): RepoPaths {
  const top = gitMaybe(["rev-parse", "--show-toplevel"], { cwd });
  if (top === null) {
    throw new NotARepositoryError(`not inside a git repository: ${cwd}`);
  }
  const repoRoot = top;
  const navRoot = join(repoRoot, NAVBOOK_DIR);
  return { repoRoot, navRoot, hasNavbook: existsSync(navRoot) };
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
