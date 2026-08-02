/**
 * Merging, for `nav pr merge`.
 *
 * The PR directory has to move into `prs/merged/` as part of the merge that
 * lands the branch, so the merge is performed with `--no-commit` and committed
 * only after the move is staged (spec 02 §2.8).
 */

import { git, gitRun } from "./exec.ts";
import { isAncestor } from "./history.ts";

export type MergeOutcome = "up-to-date" | "fast-forward" | "staged" | "conflict";

/** True when merging `source` into HEAD would just move the branch pointer. */
export function canFastForward(cwd: string, source: string): boolean {
  const head = git(["rev-parse", "HEAD"], { cwd }).trim();
  const tip = git(["rev-parse", `${source}^{commit}`], { cwd }).trim();
  return isAncestor(cwd, head, tip);
}

/** True when `source` is already contained in HEAD. */
export function isAlreadyMerged(cwd: string, source: string): boolean {
  const head = git(["rev-parse", "HEAD"], { cwd }).trim();
  const tip = git(["rev-parse", `${source}^{commit}`], { cwd }).trim();
  return isAncestor(cwd, tip, head);
}

/** Fast-forward HEAD to `source`. */
export function fastForward(cwd: string, source: string): void {
  git(["merge", "--ff-only", "--quiet", source], { cwd });
}

/**
 * Start a real merge commit without completing it, leaving the result staged so
 * the caller can add the PR directory move before committing.
 */
export function mergeNoCommit(cwd: string, source: string): MergeOutcome {
  const result = gitRun(["merge", "--no-ff", "--no-commit", "--quiet", source], { cwd });
  if (result.code === 0) return "staged";
  return "conflict";
}

/** Complete an in-progress merge with an explicit message. */
export function commitMerge(cwd: string, message: string): string {
  git(["commit", "--quiet", "--no-edit", "-m", message], { cwd });
  return git(["rev-parse", "HEAD"], { cwd }).trim();
}

/** Abandon an in-progress merge. */
export function abortMerge(cwd: string): void {
  gitRun(["merge", "--abort"], { cwd });
}

/** Paths git could not merge automatically. */
export function conflictedPaths(cwd: string): string[] {
  const result = gitRun(["diff", "--name-only", "--diff-filter=U"], { cwd });
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter((line) => line !== "");
}

/** The commit being merged in, read from MERGE_HEAD. */
export function mergeHead(cwd: string): string | null {
  const result = gitRun(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}
