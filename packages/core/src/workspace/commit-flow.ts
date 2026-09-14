/**
 * The `--commit` flag — spec 04 §4.2.
 *
 * Without it, a mutating command leaves its changes staged for the user's own
 * commit. With it, the change is wrapped in a well-formed `docs` commit — but
 * only if nothing unrelated is staged, so the user never has work swept into a
 * tracker commit by accident, and only on a branch, so the commit is never one
 * that no ref reaches.
 */

import type { Plan } from "../core/ops.ts";
import { planPaths } from "../core/ops.ts";
import { commit, composeMessage, stagedPaths } from "../git/index-ops.ts";
import { branchesAt, currentBranch, worktreeOfBranch } from "../git/repo.ts";
import type { WsCtx } from "./ctx.ts";
import { wsFail } from "./errors.ts";
import { applyOps, repoPaths } from "./workspace.ts";

/** True when `path` is `allowed` or lives underneath it. */
function isWithin(path: string, allowed: string): boolean {
  return path === allowed || path.startsWith(`${allowed}/`);
}

/**
 * Refuse to commit when the index already holds changes this operation did not
 * make. Called before any file is written, so a refusal leaves nothing behind.
 */
export function assertNoUnrelatedStaged(ws: WsCtx, allowedPaths: readonly string[]): void {
  const staged = stagedPaths(ws.repoRoot);
  const unrelated = staged.filter(
    (path) => !allowedPaths.some((allowed) => isWithin(path, allowed)),
  );
  if (unrelated.length === 0) return;
  wsFail("unrelated-staged", "--commit refuses to run with unrelated changes already staged", [
    ...unrelated.slice(0, 10).map((path) => `  ${path}`),
    ...(unrelated.length > 10 ? [`  ... and ${unrelated.length - 10} more`] : []),
    "commit or unstage them first, or omit --commit",
  ]);
}

/**
 * Refuse to commit on a detached HEAD, where the commit would be reachable
 * from no branch.
 *
 * Detaching is the obvious way to reach files on a branch another worktree
 * holds, and a commit made there is reported as committed while no branch,
 * and no other worktree, ever sees it. `nav pr open` and `nav pr merge`
 * already refuse a detached HEAD; this is the same rule for every verb that
 * commits. Without `--commit` nothing is refused: a staged change loses
 * nothing, and the commit that records it is the user's to place.
 */
export function assertOnBranch(ws: WsCtx): void {
  if (currentBranch(ws.repoRoot) !== null) return;
  const branch = branchesAt(ws.repoRoot, "HEAD")[0];
  const tree = branch === undefined ? null : worktreeOfBranch(ws.repoRoot, branch);
  wsFail("precondition", "HEAD is detached; --commit would record this on no branch", [
    branch === undefined
      ? "check out a branch first"
      : tree
        ? `HEAD is at '${branch}', which is checked out in ${tree}; run the command there`
        : `HEAD is at '${branch}'; check it out first: 'git switch ${branch}'`,
    "or omit --commit, and commit the staged change where it belongs",
  ]);
}

/** Every refusal `--commit` makes, before any file is written. */
export function assertCommittable(ws: WsCtx, allowedPaths: readonly string[]): void {
  assertOnBranch(ws);
  assertNoUnrelatedStaged(ws, allowedPaths);
}

export interface RunPlanOptions {
  commit?: boolean;
}

export interface RunPlanResult {
  touched: string[];
  committed: boolean;
  /** The commit subject on its own. */
  subject: string;
  /** The whole commit message, subject plus trailers. */
  message: string;
}

/** Apply a plan and, with `--commit`, wrap it in its `docs` commit. */
export function runPlan(ws: WsCtx, plan: Plan, opts: RunPlanOptions): RunPlanResult {
  const allowed = repoPaths(ws.navDir, planPaths(plan));
  if (opts.commit) assertCommittable(ws, allowed);

  const { touched } = applyOps(ws, plan.ops);
  const message = composeMessage(plan.message, plan.trailers);
  // A plan can land as a no-op: an edit that changed nothing, or a delete of an
  // entity that was never committed in the first place. git refuses an empty
  // commit, and it is right to — there is nothing to record. Report that
  // plainly instead of surfacing git's failure for a command that succeeded.
  const committed = opts.commit === true && stagedPaths(ws.repoRoot).length > 0;
  if (committed) commit(ws.repoRoot, message);
  return { touched, committed, subject: plan.message, message };
}

/** The one-line report printed after a `--commit` run. */
export function commitReport(result: RunPlanResult): string {
  return result.committed ? `Committed ${result.subject}` : "Nothing to commit";
}
