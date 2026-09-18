/**
 * Writing to a pull request whose branch another worktree already holds.
 *
 * A pull request's files live on its source branch (spec 03 §3.5), so the
 * verbs that write into its directory refuse from any other checkout — core's
 * `findPrToWrite` names the branch, and the worktree that has it. When there is
 * somebody at a terminal and that worktree is clean, everything needed to
 * perform the write is already known, so this asks instead of only pointing.
 *
 * Answering yes does not change any directory. A child process cannot move its
 * parent shell's working directory, and nothing is spawned in any case: a
 * second `Ctx` rooted at the other worktree is enough, and the verb runs
 * against it unchanged.
 */

import { type EntityRecord, locatePrToWrite, type PrElsewhere } from "@navbook/core";
import type { Ctx } from "../context.ts";
import { makeContext } from "../context.ts";
import { askYesNo, isInteractive } from "../prompt.ts";

/** Help for the flag that answers the question in advance. */
export const IN_WORKTREE_HELP = "write in the worktree that has the source branch, without asking";

export interface PrWriteOptions {
  /** `--in-worktree`: answer yes in advance, and ask nobody. */
  inWorktree?: boolean;
}

/** The context a pull-request verb should run in, and the entity it writes to. */
export interface PrWriteSite {
  ctx: Ctx;
  entity: EntityRecord;
  /** The worktree the write was moved to, or null when it stayed here. */
  movedTo: string | null;
}

/**
 * Whether the offer can be made at all.
 *
 * A remote-tracking source has no worktree to go to; an unclean one is not
 * somewhere to leave a staged change the user is not looking at — without
 * `--commit` that is exactly what a write leaves behind, and with it the
 * commit would be refused over the unrelated staged paths anyway.
 */
function reachable(where: PrElsewhere): where is PrElsewhere & { worktree: string } {
  return where.worktree !== null && !where.sourceRemote && where.worktreeClean;
}

/**
 * Resolve where a pull-request write should happen, asking first when it can
 * happen somewhere better than here.
 *
 * Declining returns this context unchanged, so the caller proceeds into core's
 * ordinary refusal: the answer was "not there", not "do it here".
 */
export function prWriteSite(ctx: Ctx, prefix: string, opts: PrWriteOptions = {}): PrWriteSite {
  const { entity, elsewhere } = locatePrToWrite(ctx, prefix);
  if (elsewhere === null) return { ctx, entity, movedTo: null };
  if (!reachable(elsewhere)) return { ctx, entity, movedTo: null };

  const { worktree, branch } = elsewhere;
  if (!opts.inWorktree) {
    // Only ever asked, never assumed. A run with nothing to answer the question
    // keeps the refusal it has always had: a pipeline that started writing into
    // a checkout nobody mentioned would be a worse surprise than exit 1.
    if (!isInteractive(ctx)) return { ctx, entity, movedTo: null };
    ctx.stdout.write(
      `#${entity.id} is on '${branch}', checked out in ${worktree} ${ctx.colors.dim("(clean)")}\n`,
    );
    if (!askYesNo(ctx, "Write it there? [y/N] ")) return { ctx, entity, movedTo: null };
  }

  // Discovery runs again from the new root, so `NAV_ROOT` and a nested
  // Navbook directory resolve there exactly as they would for a command
  // typed in that worktree. The terminal is the one we already have.
  const there = makeContext({
    cwd: worktree,
    env: ctx.env,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  });
  return { ctx: there, entity: locatePrToWrite(there, prefix).entity, movedTo: worktree };
}

/** The note a verb prints when its write went somewhere other than here. */
export function reportMove(ctx: Ctx, movedTo: string | null): void {
  if (movedTo !== null) ctx.stderr.write(`${ctx.colors.dim(`written in ${movedTo}`)}\n`);
}
