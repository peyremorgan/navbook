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

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree,
  currentBranch,
  type EntityRecord,
  findPrToWrite,
  gitRun,
  isTreeClean,
  isValidBranchName,
  locatePrToWrite,
  type PrElsewhere,
  refusePrWrite,
  removeWorktree,
  worktreeHolding,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { makeContext } from "../context.ts";
import { fail } from "../errors.ts";
import { askYesNo, isInteractive } from "../prompt.ts";

/**
 * Help for `-y`, which answers the question in advance. The same letter
 * answers `nav pr merge` and `nav install` in advance, and means the same
 * thing here: this verb's one question, whichever of the two it would be.
 */
export const YES_HELP =
  "accept the offer to write in a worktree on the source branch — the clean one that has it, or a temporary one";

/** Help for `-y` on `nav pr open`, whose question is about `--source`. */
export const SOURCE_YES_HELP =
  "with --source, write it in a worktree on that branch — the clean one that has it, or a temporary one";

export interface PrWriteOptions {
  /** `-y`: accept either offer in advance, and ask nobody. */
  yes?: boolean;
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

/**
 * Ask whether to write there, unless `-y` already said yes.
 *
 * `what` is what is being written to, as the question names it: a pull
 * request by its ID, or the pull request about to be opened.
 */
function agreed(ctx: Ctx, what: string, to: Destination, opts: PrWriteOptions): boolean {
  if (opts.yes) return true;
  // Only ever asked, never assumed. A run with nothing to answer the question
  // keeps the refusal it has always had: a pipeline that started writing into
  // a checkout nobody mentioned would be a worse surprise than exit 1.
  if (!isInteractive(ctx)) return false;
  if (to.worktree !== null) {
    ctx.stdout.write(
      `${what} is on '${to.branch}', checked out in ${to.worktree} ${ctx.colors.dim("(clean)")}\n`,
    );
    return askYesNo(ctx, "Write it there? [y/N] ");
  }
  ctx.stdout.write(`${what} is on '${to.branch}', which no worktree has checked out\n`);
  return askYesNo(ctx, "Check it out in a temporary worktree and write it there? [y/N] ");
}

/**
 * A context rooted at `worktree`, reporting to the terminal we already have.
 *
 * The Navbook directory is the one already resolved here rather than found
 * again: the pull request was located under it, and a second discovery from
 * another root is one more chance to land somewhere it is not. The plugin
 * extensions carry over for the same reason: the other checkout's tree is
 * the same format, and read without them its registered keys would be raw.
 */
function contextIn(ctx: Ctx, worktree: string): Ctx {
  return makeContext({
    cwd: worktree,
    env: ctx.env,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
    navDir: ctx.navDir,
    ext: ctx.ext,
  });
}

/**
 * A new worktree on `branch` in a fresh temporary directory.
 *
 * `mkdtemp` rather than a fixed name, so two runs never collide and nothing a
 * user made is ever in the way; under `os.tmpdir()`, so `TMPDIR` says where.
 * The branch only flavours the name, so it is cut short: a directory name has
 * a length limit and a branch name has none.
 */
function checkOutTemporarily(ctx: Ctx, branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), `nav-${safe}-`));
    addWorktree(ctx.repoRoot, dir, branch);
    return dir;
  } catch (error) {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    fail(`could not check '${branch}' out into a temporary worktree`, [
      error instanceof Error ? error.message.trim() : String(error),
    ]);
  }
}

/**
 * Take a temporary worktree away again, unless it holds what the user would lose.
 *
 * After `--commit` the write is on the branch and the worktree holds nothing.
 * Without it — or when the commit itself failed, a hook refusing it, say — the
 * write is staged there and nowhere else, so the worktree stays and says where
 * it is: removing it would throw away a review somebody just wrote. A run that
 * failed before writing anything leaves it clean, and it goes. Untracked files
 * do not count: nothing but this run has been in there.
 */
function release(ctx: Ctx, dir: string, branch: string, failed: boolean): void {
  if (isTreeClean(dir, { untracked: false })) {
    try {
      removeWorktree(ctx.repoRoot, dir, { force: true });
    } catch {
      // Never mask the error that brought us here with one about tidying up.
      // Deleting the directory alone would leave git recording the branch as
      // checked out at a path that no longer exists, so prune that too.
      rmSync(dir, { recursive: true, force: true });
      gitRun(["worktree", "prune"], { cwd: ctx.repoRoot });
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

/** Terminal signals, which reach the editor and git as well as us. */
const TERMINAL_SIGNALS = ["SIGINT", "SIGQUIT", "SIGHUP"] as const;

/**
 * Run `body` with terminal signals left to the children.
 *
 * Ctrl-C while `$EDITOR` is open goes to the whole foreground process group.
 * By default it would kill us mid-`spawnSync`, before any `finally` runs, and
 * leave the temporary worktree registered with the branch checked out. Git
 * ignores these signals while its own editor runs, for the same reason; so
 * does this. The editor still gets the signal, exits, and the command fails
 * through its ordinary path — which is the one that tidies up.
 */
function sheltered<T>(body: () => T): T {
  const ignore = (): void => {};
  for (const signal of TERMINAL_SIGNALS) process.on(signal, ignore);
  try {
    return body();
  } finally {
    for (const signal of TERMINAL_SIGNALS) process.off(signal, ignore);
  }
}

/**
 * `write`, refusing a result that is still on its way.
 *
 * A write site is held for exactly as long as `write` runs: a temporary
 * worktree is released, and terminal signals given back, the moment it
 * returns. A promise returned then would go on writing into a worktree already
 * taken away — or into one kept, after the user was told what it holds — so
 * it fails instead, as a write that threw does: a worktree holding what it
 * staged before its first `await` is kept and named, a clean one goes. What
 * the promise does later is nobody's to report, so its rejection is dropped
 * rather than left to end the process with a less useful message.
 */
function synchronous<A extends unknown[], T>(write: (...args: A) => T): (...args: A) => T {
  return (...args) => {
    const result = write(...args);
    if (typeof (result as { then?: unknown } | null)?.then === "function") {
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
      fail(
        "a write at a pull request's write site must be synchronous, and this one returned a promise",
        [
          "the site is released as soon as the write returns, so nothing it awaits would land there",
          "do the asynchronous work first, then write inside the callback without awaiting",
        ],
      );
    }
    return result;
  };
}

/**
 * Run `write` at `to`: in the clean worktree that has the branch, or in a
 * temporary one made for the purpose and taken away again afterwards.
 */
function writeAt<T>(ctx: Ctx, to: Destination, write: (at: Ctx) => T): T {
  if (to.worktree !== null) {
    const result = write(contextIn(ctx, to.worktree));
    ctx.stderr.write(`${ctx.colors.dim(`written in ${to.worktree}`)}\n`);
    return result;
  }

  const { branch } = to;
  return sheltered(() => {
    const dir = checkOutTemporarily(ctx, branch);
    let failed = true;
    try {
      const result = write(contextIn(ctx, dir));
      failed = false;
      return result;
    } finally {
      release(ctx, dir, branch, failed);
    }
  });
}

/**
 * Run a pull-request write where it belongs, asking first when that is not here.
 *
 * `write` gets the context to write in and the pull request as that context
 * sees it. When the write cannot or may not move, this is core's refusal
 * naming where the pull request lives — declining the question included: the
 * answer was "not there", not "do it here".
 *
 * `write` is synchronous, wherever the site is: one returning a promise fails.
 */
export function withPrWriteSite<T>(
  ctx: Ctx,
  prefix: string,
  opts: PrWriteOptions,
  given: (at: Ctx, entity: EntityRecord) => T,
): T {
  const write = synchronous(given);
  const { entity, elsewhere } = locatePrToWrite(ctx, prefix);
  if (elsewhere === null) return write(ctx, entity);

  const to = destination(elsewhere);
  // Built from what was just found, rather than scanning every ref again.
  if (to === null || !agreed(ctx, `#${entity.id}`, to, opts)) refusePrWrite(entity, elsewhere);

  // Found again there, refusing if that checkout does not hold the pull
  // request after all — the branch moved since we looked, say. Without this
  // the write would land beside no `pr.md`, the stranded comment the refusal
  // exists to prevent.
  return writeAt(ctx, to, (at) => write(at, findPrToWrite(at, prefix)));
}

/**
 * Run a write on `branch`, asking first when that is not the branch checked
 * out here — the write that opens a pull request on a branch the caller is not
 * standing on, which has no pull request yet to be found on it.
 *
 * Only a local branch, named as one: a remote-tracking one would have to
 * become a local branch first, which is more than opening a pull request
 * should do, and a revision such as `feat/work~1` names a commit, which no
 * pull request can be written on — checked out, it is a detached HEAD, and the
 * `source` recorded would be no branch at all. A worktree that has the branch
 * is used when it is clean, and refused when it is not, or is registered and
 * gone. `write` is synchronous, as for {@link withPrWriteSite}.
 */
export function withBranchWriteSite<T>(
  ctx: Ctx,
  branch: string,
  opts: PrWriteOptions,
  given: (at: Ctx) => T,
): T {
  const write = synchronous(given);
  if (!isValidBranchName(ctx.repoRoot, branch)) {
    fail(`'${branch}' is not a branch name`, [
      "a pull request is written on a branch, so name one — not a revision such as 'main~1' or 'main@{1}'",
    ]);
  }
  if (branch === currentBranch(ctx.repoRoot)) return write(ctx);
  // `show-ref --verify` rather than `rev-parse`, which reads its argument as
  // a revision and finds a commit for more than an exact ref.
  if (
    gitRun(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: ctx.repoRoot })
      .code !== 0
  ) {
    fail(`'${branch}' is not a local branch`, [
      `create it first, e.g. 'git switch -c ${branch}' or 'git branch ${branch} origin/${branch}'`,
    ]);
  }

  const worktree = worktreeHolding(ctx.repoRoot, branch);
  if (worktree !== null && !existsSync(worktree)) {
    fail(`'${branch}' is registered to a worktree at ${worktree}, which no longer exists`, [
      "clear it with 'git worktree prune', then try again",
    ]);
  }
  if (worktree !== null && !isTreeClean(worktree, { untracked: false })) {
    fail(`'${branch}' is checked out in ${worktree}, which has uncommitted changes`, [
      "commit or stash them there, or run the command there",
    ]);
  }
  const to: Destination = { branch, worktree };
  if (!agreed(ctx, "The pull request", to, opts)) {
    fail(`'${branch}' is not checked out here`, [
      "a pull request is written on its source branch, beside the files it proposes to merge",
      worktree === null
        ? `check it out first, or pass -y to write in a temporary worktree`
        : `run the command in ${worktree}, or pass -y to write there`,
    ]);
  }
  return writeAt(ctx, to, write);
}
