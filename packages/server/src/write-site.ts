/**
 * Writing on a branch the server does not serve — spec 06 §6.3.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), and the clone has one branch checked out: the tracker's. So a write to
 * a pull request on any other branch — opening one, commenting on one, patching
 * one — happens where a person at a terminal would make it: in a worktree on
 * that branch. The server makes the worktree for the one write, in a temporary
 * directory, and removes it afterwards; the branch is pushed like the served
 * one, by {@link RepoSync.writeOn}.
 *
 * The branch must already be on the remote. The server never creates a branch
 * anybody would see, and it never writes on one of the clone's own local
 * branches either: those are an operator's, and one may carry commits nobody
 * meant to publish. It works on a copy of its own instead, named under
 * {@link COPY_PREFIX} — made from the remote-tracking branch when it is needed,
 * pushed to the remote's branch of the original name, and deleted again once
 * the remote has everything on it. A copy that still carries something the
 * remote lacks (a push that was refused, or stopped) is kept, and the next
 * write to that branch pushes it, exactly as the served branch carries a
 * stopped push. Every branch under the prefix is the server's, which is what
 * lets it keep and delete them without asking whose they are.
 *
 * A server with no remote has nothing to copy from or push to: it writes on
 * the clone's branch itself, which is then the only copy there is, and keeps it.
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  addWorktree,
  createBranch,
  currentBranch,
  deleteBranch,
  gitMaybe,
  gitRun,
  isAncestor,
  isValidBranchName,
  makeWsCtx,
  removeWorktree,
  resolveSha,
  splitLines,
  type WsCtx,
  worktreeHolding,
} from "@navbook/core";
import type { GraphQLCtx } from "./context.ts";
import { apiError } from "./errors.ts";
import type { WriteResult, WriteRoot } from "./sync.ts";

/**
 * What every temporary worktree's directory name starts with.
 *
 * The one mark that tells a worktree this server made from one a person did,
 * which is what lets a restart remove the ones a killed process left behind
 * and nothing else.
 */
export const TEMP_WORKTREE_PREFIX = "nav-server-wt-";

/**
 * What the server's copy of a branch is called, before the branch's own name:
 * `nav-server/feat/x` is its copy of the remote's `feat/x`.
 */
export const COPY_PREFIX = "nav-server/";

/** Where a write happens: the clone itself, or a temporary worktree on another branch. */
export interface WriteSite extends WriteRoot {
  /** The branch written on, as the remote and the pull request name it. */
  branch: string;
  /**
   * The local branch checked out at {@link root}: the served branch, the
   * server's copy of {@link branch}, or — with no remote — {@link branch} itself.
   */
  local: string;
  /** The temporary worktree, or null when {@link root} is the clone. */
  worktree: string | null;
}

/**
 * Choose where a write to `branch` happens, making the worktree if it needs one.
 *
 * Null, or the served branch, is the clone itself. Anything else is refused
 * with `INVALID_INPUT` unless git takes it for a branch name, and with
 * `PRECONDITION` unless it is a branch on the remote (or, for a server with no
 * remote, a branch in the clone) whose local branch no worktree of somebody
 * else's holds. Synchronous and local, so {@link RepoSync.writeOn} can call it
 * under the lock, once the fetch has brought the remote-tracking branches up
 * to date.
 */
export function openWriteSite(ctx: GraphQLCtx, branch: string | null): WriteSite {
  const root = ctx.ws.repoRoot;
  const served = currentBranch(root);
  if (branch === null || branch === served) {
    return { root, branch: served ?? "", local: served ?? "", worktree: null };
  }

  if (!isValidBranchName(root, branch)) {
    throw apiError(`'${branch}' is not a branch name git accepts`, "INVALID_INPUT", { branch });
  }
  const remote = ctx.sync.remote;
  const local = remote === null ? branch : `${COPY_PREFIX}${branch}`;
  // Where the copy this call made started, so a failure below can take it away again.
  let created: string | null = null;
  if (remote !== null) {
    const upstream = `refs/remotes/${remote}/${branch}`;
    const upstreamSha = resolveSha(root, upstream);
    if (upstreamSha === null) {
      throw apiError(`'${branch}' is not a branch on '${remote}'`, "PRECONDITION", {
        branch,
        remote,
        details: [
          "a pull request is written on its source branch, and the server writes only to branches it can push",
          `push '${branch}' first, and name it without the remote`,
        ],
      });
    }
    if (resolveSha(root, `refs/heads/${local}`) === null) {
      createBranch(root, local, upstream);
      created = upstreamSha;
    }
  } else if (resolveSha(root, `refs/heads/${branch}`) === null) {
    throw apiError(`there is no branch '${branch}' in the server's clone`, "PRECONDITION", {
      branch,
    });
  }

  try {
    claimBranch(ctx, local);
    // The branch only flavours the name, so it is cut short: a directory name
    // has a length limit and a branch name has none.
    const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
    const dir = mkdtempSync(join(tmpdir(), `${TEMP_WORKTREE_PREFIX}${safe}-`));
    try {
      addWorktree(root, dir, local);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return {
      root: dir,
      branch,
      local,
      worktree: dir,
      ...(remote === null ? {} : { upstream: branch }),
    };
  } catch (error) {
    if (created !== null) dropBranch(root, local, created);
    throw error;
  }
}

/**
 * Make sure no worktree holds `local`, so it can be checked out.
 *
 * One of this server's own temporary worktrees — left by a close that could
 * not remove it, or by a killed process the startup sweep has not met yet —
 * is removed. One whose directory is gone is pruned. Anybody else's is
 * refused: an operator put it there.
 */
function claimBranch(ctx: GraphQLCtx, local: string): void {
  const root = ctx.ws.repoRoot;
  const holder = worktreeHolding(root, local);
  if (holder === null) return;
  if (basename(holder).startsWith(TEMP_WORKTREE_PREFIX)) {
    if (removeTemporaryWorktree(root, holder, ctx.report)) return;
    throw apiError(
      `'${local}' is still checked out in ${holder}, a worktree the server could not remove`,
      "PRECONDITION",
      { branch: local, details: ["the server's log says why; an operator must remove it"] },
    );
  }
  if (existsSync(holder)) {
    throw apiError(
      `'${local}' is checked out in ${holder}, which is not a worktree this server made`,
      "PRECONDITION",
      {
        branch: local,
        details: ["an operator must remove that worktree before the server can write there"],
      },
    );
  }
  // Registered, but gone — cleared from a temporary directory at reboot,
  // say. Git would refuse to check the branch out again until it is pruned.
  gitRun(["worktree", "prune"], { cwd: root });
}

/**
 * Take a site away again. Never throws: the error that brought a failed write
 * here is the one the client must see.
 *
 * The worktree always goes, with whatever it holds: a write that committed has
 * its commit on the branch, and one that failed was reported to a client that
 * still has what it sent. The copy goes too once the remote has everything on
 * it — and stays while it carries a commit the remote lacks, or while the
 * worktree could not be removed: deleting a branch a worktree still stands on
 * would leave that worktree on nothing. The next write to the branch takes
 * either over.
 */
export function closeWriteSite(
  ctx: GraphQLCtx,
  site: WriteSite,
  report: (line: string) => void,
): void {
  if (site.worktree === null) return;
  const root = ctx.ws.repoRoot;
  if (!removeTemporaryWorktree(root, site.worktree, report)) return;

  const remote = ctx.sync.remote;
  // With no remote, the branch is the clone's own and the only copy there is.
  if (remote === null || site.upstream === undefined) return;
  const local = resolveSha(root, `refs/heads/${site.local}`);
  if (local === null) return;
  const upstream = resolveSha(root, `refs/remotes/${remote}/${site.branch}`);
  if (upstream === null || !isAncestor(root, local, upstream)) {
    report(
      `nav-server: kept '${site.local}', the server's copy of '${site.branch}', which carries ` +
        `a commit '${remote}' does not have; the next write to '${site.branch}' pushes it`,
    );
    return;
  }
  dropBranch(root, site.local, local);
}

/** Delete one of the server's own branches, if it is still at `expected`. */
function dropBranch(root: string, branch: string, expected: string): void {
  try {
    deleteBranch(root, branch, expected);
  } catch {
    // It moved since it was read, which only another write could have done;
    // that write's own close decides what happens to it.
  }
}

/** A workspace rooted at the site: the viewer as author, the request's tree layout and plugins. */
export function wsAt(ctx: GraphQLCtx, site: WriteSite): WsCtx {
  if (site.worktree === null) return ctx.ws;
  return makeWsCtx({
    cwd: site.root,
    env: ctx.ws.env,
    identity: ctx.viewer,
    navDir: ctx.ws.navDir,
    ext: ctx.ws.ext,
  });
}

/**
 * A whole write on `choose()`'s branch: pull, open the site, write, push, close.
 *
 * `choose` runs under the lock after the fetch, so it may read refs that fetch
 * just brought in; null means the served branch.
 */
export function writeOnBranch<T>(
  ctx: GraphQLCtx,
  choose: () => string | null,
  body: (at: WsCtx, site: WriteSite) => T,
  committed: (result: T) => boolean,
): Promise<WriteResult<T>> {
  return ctx.sync.writeOn<T, WriteSite>({
    open: () => openWriteSite(ctx, choose()),
    body: (site) => body(wsAt(ctx, site), site),
    committed,
    close: (site) => closeWriteSite(ctx, site, ctx.report),
  });
}

/**
 * Remove the temporary worktrees an earlier process left: one killed between
 * making a worktree and removing it. Everything else is left alone, branches
 * included — a copy may carry a commit that still has to be pushed.
 */
export function sweepTemporaryWorktrees(repoRoot: string, report: (line: string) => void): void {
  const listing = gitMaybe(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (listing === null) return;
  for (const path of worktreePaths(listing)) {
    if (!basename(path).startsWith(TEMP_WORKTREE_PREFIX)) continue;
    if (removeTemporaryWorktree(repoRoot, path, report)) {
      report(`nav-server: removed a temporary worktree an earlier run left at ${path}`);
    }
  }
  gitRun(["worktree", "prune"], { cwd: repoRoot });
}

/**
 * Remove a worktree this server made, falling back to deleting it and pruning.
 *
 * True once git no longer has it registered, whatever is left on disk; false
 * — having said why — while it does, because then the branch it stands on is
 * still checked out there.
 */
function removeTemporaryWorktree(
  repoRoot: string,
  path: string,
  report: (line: string) => void,
): boolean {
  // Read before the directory goes: git records the path it was given made
  // real, so a temporary directory reached through a symlink is listed as its
  // target.
  const real = realOrSelf(path);
  try {
    removeWorktree(repoRoot, path, { force: true });
    return true;
  } catch (error) {
    // Deleting the directory alone would leave git recording the branch as
    // checked out at a path that no longer exists, so prune that too.
    let why = error instanceof Error ? error.message.trim() : String(error);
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (rmError) {
      why = rmError instanceof Error ? rmError.message : String(rmError);
    }
    gitRun(["worktree", "prune"], { cwd: repoRoot });
    const listing = gitMaybe(["worktree", "list", "--porcelain"], { cwd: repoRoot }) ?? "";
    const registered = worktreePaths(listing).some((listed) => listed === path || listed === real);
    if (registered) {
      report(`nav-server: could not remove the temporary worktree at ${path}: ${why}`);
    }
    return !registered;
  }
}

/** The paths `git worktree list --porcelain` names, the main worktree first. */
function worktreePaths(listing: string): string[] {
  return splitLines(listing)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
