/**
 * Merging, for `nav pr merge` and for the API server's pull.
 *
 * The PR directory has to move into `prs/merged/` as part of the merge that
 * lands the branch, so the merge is performed with `--no-commit` and committed
 * only after the move is staged (spec 02 §2.8).
 *
 * Each operation has a blocking form and an `Async` twin. They share their
 * arguments and their reading of what git said, so the two cannot drift: the
 * only difference between them is which runner they hand the command to.
 */

import { git, gitAsync, gitRun, gitRunAsync } from "./exec.ts";
import { isAncestor, isAncestorAsync } from "./history.ts";

export type MergeOutcome = "up-to-date" | "fast-forward" | "staged" | "conflict";

const HEAD = ["rev-parse", "HEAD"];
const tipOf = (source: string): string[] => ["rev-parse", `${source}^{commit}`];
const fastForwardArgs = (source: string): string[] => ["merge", "--ff-only", "--quiet", source];
const mergeArgs = (source: string): string[] => [
  "merge",
  "--no-ff",
  "--no-commit",
  "--quiet",
  source,
];
const commitArgs = (message: string): string[] => ["commit", "--quiet", "--no-edit", "-m", message];
const ABORT = ["merge", "--abort"];
const CONFLICTED = ["diff", "--name-only", "--diff-filter=U"];

/** True when merging `source` into HEAD would just move the branch pointer. */
export function canFastForward(cwd: string, source: string): boolean {
  const head = git(HEAD, { cwd }).trim();
  const tip = git(tipOf(source), { cwd }).trim();
  return isAncestor(cwd, head, tip);
}

/** {@link canFastForward} without blocking. */
export async function canFastForwardAsync(cwd: string, source: string): Promise<boolean> {
  const head = (await gitAsync(HEAD, { cwd })).trim();
  const tip = (await gitAsync(tipOf(source), { cwd })).trim();
  return isAncestorAsync(cwd, head, tip);
}

/** True when `source` is already contained in HEAD. */
export function isAlreadyMerged(cwd: string, source: string): boolean {
  const head = git(HEAD, { cwd }).trim();
  const tip = git(tipOf(source), { cwd }).trim();
  return isAncestor(cwd, tip, head);
}

/** {@link isAlreadyMerged} without blocking. */
export async function isAlreadyMergedAsync(cwd: string, source: string): Promise<boolean> {
  const head = (await gitAsync(HEAD, { cwd })).trim();
  const tip = (await gitAsync(tipOf(source), { cwd })).trim();
  return isAncestorAsync(cwd, tip, head);
}

/** Fast-forward HEAD to `source`. */
export function fastForward(cwd: string, source: string): void {
  git(fastForwardArgs(source), { cwd });
}

/** {@link fastForward} without blocking. */
export async function fastForwardAsync(cwd: string, source: string): Promise<void> {
  await gitAsync(fastForwardArgs(source), { cwd });
}

/**
 * Start a real merge commit without completing it, leaving the result staged so
 * the caller can add the PR directory move before committing.
 */
export function mergeNoCommit(cwd: string, source: string): MergeOutcome {
  return mergeOutcome(gitRun(mergeArgs(source), { cwd }).code);
}

/** {@link mergeNoCommit} without blocking. */
export async function mergeNoCommitAsync(cwd: string, source: string): Promise<MergeOutcome> {
  return mergeOutcome((await gitRunAsync(mergeArgs(source), { cwd })).code);
}

function mergeOutcome(code: number): MergeOutcome {
  return code === 0 ? "staged" : "conflict";
}

/** Complete an in-progress merge with an explicit message. */
export function commitMerge(cwd: string, message: string): string {
  git(commitArgs(message), { cwd });
  return git(HEAD, { cwd }).trim();
}

/** {@link commitMerge} without blocking. */
export async function commitMergeAsync(cwd: string, message: string): Promise<string> {
  await gitAsync(commitArgs(message), { cwd });
  return (await gitAsync(HEAD, { cwd })).trim();
}

/** Abandon an in-progress merge. */
export function abortMerge(cwd: string): void {
  gitRun(ABORT, { cwd });
}

/** {@link abortMerge} without blocking. */
export async function abortMergeAsync(cwd: string): Promise<void> {
  await gitRunAsync(ABORT, { cwd });
}

/** Paths git could not merge automatically. */
export function conflictedPaths(cwd: string): string[] {
  return conflicted(gitRun(CONFLICTED, { cwd }));
}

/** {@link conflictedPaths} without blocking. */
export async function conflictedPathsAsync(cwd: string): Promise<string[]> {
  return conflicted(await gitRunAsync(CONFLICTED, { cwd }));
}

function conflicted(result: { code: number; stdout: string }): string[] {
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter((line) => line !== "");
}

/** The commit being merged in, read from MERGE_HEAD. */
export function mergeHead(cwd: string): string | null {
  const result = gitRun(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd });
  return result.code === 0 ? result.stdout.trim() : null;
}
