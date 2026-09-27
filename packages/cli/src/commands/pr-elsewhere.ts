/**
 * Writing to a pull request whose branch is not checked out here.
 *
 * A pull request's files live on its source branch (spec 03 §3.5), so the
 * verbs that write into its directory refuse from any other checkout — core's
 * `findPrToWrite` names the branch, and the worktree that has it. Everything
 * needed to perform the write anyway is already known at that moment, so when
 * somebody can be asked, this asks instead of only pointing:
 *
 * - When a clean worktree already has the branch, the write happens there.
 * - When none has it, the branch is checked out into a temporary worktree,
 *   the write happens there, and the worktree goes away again once it holds
 *   nothing the user would lose.
 *
 * No directory changes either way. A child process cannot move its parent
 * shell's working directory, and nothing is spawned in any case: a second
 * `Ctx` rooted at the other worktree is enough, and the verb runs against it
 * unchanged.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree,
  type EntityRecord,
  findPrToWrite,
  isTrackedTreeClean,
  locatePrToWrite,
  type PrElsewhere,
  removeWorktree,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { makeContext } from "../context.ts";
import { fail } from "../errors.ts";
import { askYesNo, isInteractive } from "../prompt.ts";

/** Help for the flag that answers the question in advance. */
export const IN_WORKTREE_HELP =
  "write in a worktree on the source branch — the clean one that has it, or a temporary one — without asking";

export interface PrWriteOptions {
  /** `--in-worktree`: answer yes in advance, and ask nobody. */
  inWorktree?: boolean;
}

/** Where a write goes when it does not go here. */
interface Destination {
  branch: string;
  /** The clean worktree that has {@link branch}, or null to make a temporary one. */
  worktree: string | null;
}

/**
 * Where the write could go instead of here, or null when nowhere can take it.
 *
 * An existing worktree must be clean: without `--commit` a write leaves a
 * staged change behind, and one mixed into somebody's work in progress where
 * they are not looking is not a favour; with it, the commit would be refused
 * over the unrelated staged paths anyway. A branch no worktree has can be
 * checked out into a new one — but only a local branch: checking out a
 * remote-tracking one would create a local branch as a side effect, which is
 * more than a comment should do.
 */
function destination(where: PrElsewhere): Destination | null {
  if (where.sourceRemote) return null;
  if (where.worktree === null) return { branch: where.branch, worktree: null };
  return where.worktreeClean ? { branch: where.branch, worktree: where.worktree } : null;
}

/** Ask whether to write there, unless `--in-worktree` already said yes. */
function agreed(ctx: Ctx, entity: EntityRecord, to: Destination, opts: PrWriteOptions): boolean {
  if (opts.inWorktree) return true;
  // Only ever asked, never assumed. A run with nothing to answer the question
  // keeps the refusal it has always had: a pipeline that started writing into
  // a checkout nobody mentioned would be a worse surprise than exit 1.
  if (!isInteractive(ctx)) return false;
  if (to.worktree !== null) {
    ctx.stdout.write(
      `#${entity.id} is on '${to.branch}', checked out in ${to.worktree} ${ctx.colors.dim("(clean)")}\n`,
    );
    return askYesNo(ctx, "Write it there? [y/N] ");
  }
  ctx.stdout.write(`#${entity.id} is on '${to.branch}', which no worktree has checked out\n`);
  return askYesNo(ctx, "Check it out in a temporary worktree and write it there? [y/N] ");
}

/** A context rooted at `worktree`, reporting to the terminal we already have. */
function contextIn(ctx: Ctx, worktree: string): Ctx {
  // Discovery runs again from the new root, so `NAV_ROOT` and a nested
  // Navbook directory resolve there exactly as they would for a command
  // typed in that worktree.
  return makeContext({ cwd: worktree, env: ctx.env, stdout: ctx.stdout, stderr: ctx.stderr });
}

/**
 * A new worktree on `branch` in a fresh temporary directory.
 *
 * `mkdtemp` rather than a fixed name, so two runs never collide and nothing a
 * user made is ever in the way; under `os.tmpdir()`, so `TMPDIR` says where.
 */
function checkOutTemporarily(ctx: Ctx, branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
  const dir = mkdtempSync(join(tmpdir(), `nav-${safe}-`));
  try {
    addWorktree(ctx.repoRoot, dir, branch);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    fail(`could not check '${branch}' out into a temporary worktree`, [
      error instanceof Error ? error.message.trim() : String(error),
    ]);
  }
  return dir;
}

/**
 * Take a temporary worktree away again, unless it holds what the user would lose.
 *
 * After `--commit` the write is on the branch and the worktree holds nothing.
 * Without it, the write is staged there and nowhere else, so the worktree stays
 * and says where it is — removing it would throw the change away. Untracked
 * files do not count: nothing but this run has been in there. A run that
 * failed has nothing worth keeping, and goes regardless.
 */
function release(ctx: Ctx, dir: string, branch: string, failed: boolean): void {
  if (failed || isTrackedTreeClean(dir)) {
    try {
      removeWorktree(ctx.repoRoot, dir, { force: true });
    } catch {
      // Never mask the error that brought us here with one about tidying up.
      rmSync(dir, { recursive: true, force: true });
    }
    if (!failed) {
      ctx.stderr.write(
        `${ctx.colors.dim(`written in a temporary worktree on '${branch}', since removed`)}\n`,
      );
    }
    return;
  }
  ctx.stderr.write(
    `${ctx.colors.yellow("note:")} the change is staged in ${dir}, a temporary worktree on '${branch}'\n` +
      `commit it there, then remove it: 'git worktree remove ${dir}'\n`,
  );
}

/**
 * Run a pull-request write where it belongs, asking first when that is not here.
 *
 * `write` gets the context to write in and the pull request as that context
 * sees it. When the write cannot or may not move, this is core's refusal
 * naming where the pull request lives — declining the question included: the
 * answer was "not there", not "do it here".
 */
export function withPrWriteSite<T>(
  ctx: Ctx,
  prefix: string,
  opts: PrWriteOptions,
  write: (at: Ctx, entity: EntityRecord) => T,
): T {
  const { entity, elsewhere } = locatePrToWrite(ctx, prefix);
  if (elsewhere === null) return write(ctx, entity);

  const to = destination(elsewhere);
  if (to === null || !agreed(ctx, entity, to, opts)) {
    // Throws: this checkout does not hold it, and core says where it is.
    return write(ctx, findPrToWrite(ctx, prefix));
  }

  if (to.worktree !== null) {
    const there = contextIn(ctx, to.worktree);
    const result = write(there, locatePrToWrite(there, prefix).entity);
    ctx.stderr.write(`${ctx.colors.dim(`written in ${to.worktree}`)}\n`);
    return result;
  }

  const dir = checkOutTemporarily(ctx, to.branch);
  let failed = true;
  try {
    const there = contextIn(ctx, dir);
    const result = write(there, locatePrToWrite(there, prefix).entity);
    failed = false;
    return result;
  } finally {
    release(ctx, dir, to.branch, failed);
  }
}
