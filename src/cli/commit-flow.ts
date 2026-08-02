/**
 * The `--commit` flag — spec 04 §4.2.
 *
 * Without it, a mutating command leaves its changes staged for the user's own
 * commit. With it, the change is wrapped in a well-formed `docs` commit — but
 * only if nothing unrelated is staged, so the user never has work swept into a
 * tracker commit by accident.
 */

import type { Plan } from "../core/ops.ts";
import { planPaths } from "../core/ops.ts";
import { commit, composeMessage, stagedPaths } from "../git/index-ops.ts";
import type { Ctx } from "./context.ts";
import { fail } from "./errors.ts";
import { applyOps, repoPath } from "./workspace.ts";

/** True when `path` is `allowed` or lives underneath it. */
function isWithin(path: string, allowed: string): boolean {
  return path === allowed || path.startsWith(`${allowed}/`);
}

/**
 * Refuse to commit when the index already holds changes this operation did not
 * make. Called before any file is written, so a refusal leaves nothing behind.
 */
export function assertNoUnrelatedStaged(ctx: Ctx, allowedPaths: readonly string[]): void {
  const staged = stagedPaths(ctx.repoRoot);
  const unrelated = staged.filter(
    (path) => !allowedPaths.some((allowed) => isWithin(path, allowed)),
  );
  if (unrelated.length === 0) return;
  fail("--commit refuses to run with unrelated changes already staged", [
    ...unrelated.slice(0, 10).map((path) => `  ${path}`),
    ...(unrelated.length > 10 ? [`  ... and ${unrelated.length - 10} more`] : []),
    "commit or unstage them first, or omit --commit",
  ]);
}

export interface RunPlanOptions {
  commit?: boolean;
}

export interface RunPlanResult {
  touched: string[];
  committed: boolean;
  message: string;
}

/** Apply a plan and, with `--commit`, wrap it in its `docs` commit. */
export function runPlan(ctx: Ctx, plan: Plan, opts: RunPlanOptions): RunPlanResult {
  const allowed = planPaths(plan).map(repoPath);
  if (opts.commit) assertNoUnrelatedStaged(ctx, allowed);

  const { touched } = applyOps(ctx, plan.ops);
  const message = composeMessage(plan.message, plan.trailers);
  if (opts.commit) commit(ctx.repoRoot, message);
  return { touched, committed: opts.commit === true, message };
}

/** The one-line report printed after a committed change. */
export function commitReport(plan: Plan): string {
  return `Committed ${plan.message}`;
}
