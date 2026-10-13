/**
 * Worktrees a front end makes for a write of its own.
 *
 * A write to a pull request whose branch nobody has checked out happens in a
 * temporary worktree on that branch — the server's for every such write, the
 * CLI's when asked to. Everything that write reads or writes is under the
 * Navbook directory, so by default only that directory is checked out there
 * (spec 02 §2.10, the worktree policy). A branch already checked out somewhere
 * is never made here, and is used as it is.
 */

import { addSparseWorktree, addWorktree, isConeDir } from "../git/repo.ts";
import type { WsCtx } from "./ctx.ts";
import { readWorktreePolicy } from "./workspace.ts";

/**
 * Check `branch` out into a new worktree at `path`, for a write `ws` is
 * making: sparse unless `ws`'s marker says otherwise or its Navbook directory
 * cannot be named as a cone.
 *
 * A fault in the policy is handed to `report` and read as the default, as
 * every policy fault is; `nav doctor` reports it too (D15). Throws what git
 * throws, having removed whatever it made.
 */
export function addWriteWorktree(
  ws: WsCtx,
  path: string,
  branch: string,
  report: (problem: string) => void = () => undefined,
): { sparse: boolean } {
  const reading = readWorktreePolicy(ws);
  for (const problem of reading.problems) report(problem);
  if (reading.policy.sparse && isConeDir(ws.navDir)) {
    addSparseWorktree(ws.repoRoot, path, branch, ws.navDir);
    return { sparse: true };
  }
  addWorktree(ws.repoRoot, path, branch);
  return { sparse: false };
}
