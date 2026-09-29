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
 * anybody would see, it only keeps a local copy of one — made from the
 * remote-tracking branch when it is needed, and deleted again once everything
 * on it has reached the remote. A copy that still carries something the remote
 * lacks (a push that was refused, or stopped) is kept, and the next write to
 * that branch pushes it, exactly as the served branch carries a stopped push.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  addWorktree,
  createBranch,
  currentBranch,
  deleteBranch,
  gitMaybe,
  gitRun,
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
import type { WriteOutcome, WriteResult, WriteRoot } from "./sync.ts";

/**
 * What every temporary worktree's directory name starts with.
 *
 * The one mark that tells a worktree this server made from one a person did,
 * which is what lets a restart remove the ones a killed process left behind
 * and nothing else.
 */
export const TEMP_WORKTREE_PREFIX = "nav-server-wt-";

/** Where a write happens: the clone itself, or a temporary worktree on another branch. */
export interface WriteSite extends WriteRoot {
  /** The branch checked out at {@link root}. */
  branch: string;
  /** The temporary worktree, or null when {@link root} is the clone. */
  worktree: string | null;
}

/**
 * Choose where a write to `branch` happens, making the worktree if it needs one.
 *
 * Null, or the served branch, is the clone itself. Anything else is refused
 * with `PRECONDITION` unless it is a branch on the remote (or, for a server
 * with no remote, a branch in the clone) that no worktree of somebody else's
 * holds. Synchronous and local, so {@link RepoSync.writeOn} can call it under
 * the lock, once the fetch has brought the remote-tracking branches up to date.
 */
export function openWriteSite(ctx: GraphQLCtx, branch: string | null): WriteSite {
  const root = ctx.ws.repoRoot;
  const served = currentBranch(root);
  if (branch === null || branch === served) {
    return { root, branch: served ?? "", worktree: null };
  }

  if (!isValidBranchName(root, branch)) {
    throw apiError(`'${branch}' is not a branch name git accepts`, "PRECONDITION", { branch });
  }
  const remote = ctx.sync.remote;
  // The local copy this call made, so a failure below can take it away again.
  let created: string | null = null;
  if (remote !== null) {
    const upstream = `refs/remotes/${remote}/${branch}`;
    if (resolveSha(root, upstream) === null) {
      throw apiError(`'${branch}' is not a branch on '${remote}'`, "PRECONDITION", {
        branch,
        remote,
        details: [
          "a pull request is written on its source branch, and the server writes only to branches it can push",
          `push '${branch}' first, and name it without the remote`,
        ],
      });
    }
    const upstreamSha = resolveSha(root, upstream);
    if (resolveSha(root, `refs/heads/${branch}`) === null && upstreamSha !== null) {
      createBranch(root, branch, upstream);
      created = upstreamSha;
    }
  } else if (resolveSha(root, `refs/heads/${branch}`) === null) {
    throw apiError(`there is no branch '${branch}' in the server's clone`, "PRECONDITION", {
      branch,
    });
  }

  const holder = worktreeHolding(root, branch);
  if (holder !== null) {
    if (existsSync(holder)) {
      throw apiError(
        `'${branch}' is checked out in ${holder}, which is not a worktree this server made`,
        "PRECONDITION",
        {
          branch,
          details: ["an operator must remove that worktree before the server can write there"],
        },
      );
    }
    // Registered, but gone — cleared from a temporary directory at reboot,
    // say. Git would refuse to check the branch out again until it is pruned.
    gitRun(["worktree", "prune"], { cwd: root });
  }

  // The branch only flavours the name, so it is cut short: a directory name
  // has a length limit and a branch name has none.
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
  const dir = mkdtempSync(join(tmpdir(), `${TEMP_WORKTREE_PREFIX}${safe}-`));
  try {
    addWorktree(root, dir, branch);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if (created !== null) deleteBranch(root, branch, created);
    throw error;
  }
  return { root: dir, branch, worktree: dir };
}

/**
 * Take a site away again. Never throws: the error that brought a failed write
 * here is the one the client must see.
 *
 * The worktree always goes, with whatever it holds: a write that committed has
 * its commit on the branch, and one that failed was reported to a client that
 * still has what it sent. The local copy of the branch goes too once it is
 * exactly the remote's — and stays while it carries a commit the remote lacks.
 */
export function closeWriteSite(
  ctx: GraphQLCtx,
  site: WriteSite,
  outcome: WriteOutcome,
  report: (line: string) => void,
): void {
  if (site.worktree === null) return;
  const root = ctx.ws.repoRoot;
  removeTemporaryWorktree(root, site.worktree, report);

  const remote = ctx.sync.remote;
  if (remote === null) return;
  const local = resolveSha(root, `refs/heads/${site.branch}`);
  if (local === null || local !== resolveSha(root, `refs/remotes/${remote}/${site.branch}`)) {
    if (local !== null && !outcome.pushed) {
      report(
        `nav-server: kept the clone's copy of '${site.branch}', which carries a commit ` +
          `'${remote}' does not have yet; the next write to it pushes it`,
      );
    }
    return;
  }
  try {
    deleteBranch(root, site.branch, local);
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
    close: (site, outcome) => closeWriteSite(ctx, site, outcome, ctx.report),
  });
}

/**
 * Remove the temporary worktrees an earlier process left: one killed between
 * making a worktree and removing it. Everything else is left alone, local
 * branches included — one may carry a commit that still has to be pushed.
 */
export function sweepTemporaryWorktrees(repoRoot: string, report: (line: string) => void): void {
  const listing = gitMaybe(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (listing === null) return;
  for (const line of splitLines(listing)) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (!basename(path).startsWith(TEMP_WORKTREE_PREFIX)) continue;
    removeTemporaryWorktree(repoRoot, path, report);
    report(`nav-server: removed a temporary worktree an earlier run left at ${path}`);
  }
  gitRun(["worktree", "prune"], { cwd: repoRoot });
}

/** Remove a worktree this server made, falling back to deleting it and pruning. */
function removeTemporaryWorktree(
  repoRoot: string,
  path: string,
  report: (line: string) => void,
): void {
  try {
    removeWorktree(repoRoot, path, { force: true });
    return;
  } catch (error) {
    // Deleting the directory alone would leave git recording the branch as
    // checked out at a path that no longer exists, so prune that too.
    rmSync(path, { recursive: true, force: true });
    gitRun(["worktree", "prune"], { cwd: repoRoot });
    if (existsSync(path)) {
      report(
        `nav-server: could not remove the temporary worktree at ${path}: ${
          error instanceof Error ? error.message.trim() : String(error)
        }`,
      );
    }
  }
}
