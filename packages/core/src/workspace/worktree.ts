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

import { posix } from "node:path";
import { gitMaybe } from "../git/exec.ts";
import { addSparseWorktree, addWorktree, isConeDir } from "../git/repo.ts";
import type { WsCtx } from "./ctx.ts";
import { readWorktreePolicy } from "./workspace.ts";

/**
 * Check `branch` out into a new worktree at `path`, for a write `ws` is
 * making: sparse unless `ws`'s marker says otherwise, or some directory the
 * write needs cannot be named as a cone.
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
  const dirs = reading.policy.sparse ? sparseDirs(ws) : null;
  if (dirs !== null) {
    addSparseWorktree(ws.repoRoot, path, branch, dirs);
    return { sparse: true };
  }
  addWorktree(ws.repoRoot, path, branch);
  return { sparse: false };
}

/**
 * What a sparse worktree must check out, or null when one of them cannot be.
 *
 * The Navbook directory, and the hooks directory when `core.hooksPath` names
 * one inside the tree: git looks for it relative to the worktree a commit is
 * made in, and runs no hook at all when it is not there — which would let a
 * write past checks the repository set up (a `.husky/` directory, say).
 */
function sparseDirs(ws: WsCtx): string[] | null {
  const dirs = [ws.navDir];
  const hooks = gitMaybe(["config", "--get", "core.hooksPath"], { cwd: ws.repoRoot });
  // An absolute path (or `~/…`, or a Windows drive) is the same from every worktree.
  const absolute = hooks !== null && (posix.isAbsolute(hooks) || /^(~|[A-Za-z]:)/.test(hooks));
  if (hooks !== null && hooks !== "" && !absolute) {
    dirs.push(posix.normalize(hooks.replaceAll("\\", "/")).replace(/\/+$/, ""));
  }
  return dirs.every(isConeDir) ? dirs : null;
}
