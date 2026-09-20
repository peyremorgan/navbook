/**
 * Merging, for `nav pr merge` and for the API server's pull.
 *
 * The PR directory has to move into `prs/merged/` as part of the merge that
 * lands the branch, so the merge is performed with `--no-commit` and committed
 * only after the move is staged (spec 02 §2.8).
 *
 * Each operation the API server's pull needs has a blocking form and an
 * `Async` twin. They share their arguments and their reading of what git said,
 * so the two cannot drift: the only difference between them is which runner
 * they hand the command to. The replay and squash below have no twin, because
 * the server never performs them — it fast-forwards a tracker it did not
 * write, while these rewrite commits somebody is waiting at a terminal for.
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

/* ----------------------------------------------------- replay and squash */

const squashArgs = (source: string): string[] => ["merge", "--squash", "--quiet", source];
const REBASE_CONTINUE = ["rebase", "--continue"];

/**
 * An editor that answers instantly and changes nothing.
 *
 * `git rebase --continue` opens the message of the commit it is completing
 * unless told not to. There is nobody to close it: the message is the one the
 * author already wrote, and a replay that hung waiting on `vi` inside a tool
 * would look exactly like a tool that had crashed.
 */
const NO_EDITOR = { GIT_EDITOR: "true" };

/** What a replay of the source's commits onto another base came to. */
export type ReplayOutcome = "replayed" | "conflict";

export interface ReplayResult {
  outcome: ReplayOutcome;
  /** The tip of the replayed commits; null while a conflict is unresolved. */
  tip: string | null;
}

/**
 * Replay `source`'s commits since `upstream` onto `onto` (spec 04 §4.3).
 *
 * `git rebase --onto` rather than a range of cherry-picks, because a pull
 * request branch that merged its target back in is ordinary and a cherry-pick
 * refuses a merge commit, while a rebase flattens it — which is what somebody
 * asking for a linear history meant.
 *
 * What `source` is decides what moves. A branch name is rebased *in place*:
 * git leaves that branch pointing at the replayed commits, which is what
 * "rebase the branch" says and the only way the branch can end up on them. A
 * SHA detaches HEAD instead and leaves every ref alone, which is what a caller
 * that must not touch the branch — `--no-sync-source`, a remote-tracking ref,
 * a branch another worktree stands on — passes for exactly that reason.
 *
 * Either way HEAD is left on the replay and not on the target branch, so the
 * caller checks the target out again before landing anything.
 */
export function replayOnto(
  cwd: string,
  onto: string,
  upstream: string,
  source: string,
): ReplayResult {
  const result = gitRun(["rebase", "--quiet", "--onto", onto, upstream, source], {
    cwd,
    env: NO_EDITOR,
  });
  if (result.code !== 0) return { outcome: "conflict", tip: null };
  return { outcome: "replayed", tip: git(HEAD, { cwd }).trim() };
}

/** Carry on with a replay whose conflicts have been resolved and staged. */
export function continueReplay(cwd: string): ReplayResult {
  const result = gitRun(REBASE_CONTINUE, { cwd, env: NO_EDITOR });
  if (result.code !== 0) return { outcome: "conflict", tip: null };
  return { outcome: "replayed", tip: git(HEAD, { cwd }).trim() };
}

/**
 * Stage the whole of `source`'s change as one commit's worth, without
 * committing it, so the caller can add the PR directory move before it lands.
 *
 * Note that git records no `MERGE_HEAD` for a squash — the commit it produces
 * has one parent and is not a merge — which is why a squash interrupted by a
 * conflict cannot be recognized from the repository alone.
 */
export function squashMerge(cwd: string, source: string): MergeOutcome {
  return mergeOutcome(gitRun(squashArgs(source), { cwd }).code);
}
