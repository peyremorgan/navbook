/**
 * Confirmation for commands that change files or configuration.
 *
 * Following `apt`: print the exact actions first, then ask. `--yes` skips the
 * question but never the printing, so a scripted run still leaves a record of
 * what it did.
 */

import { readSync } from "node:fs";
import type { Ctx } from "./context.ts";

export interface Action {
  /** One line describing what will happen, e.g. the exact command to be run. */
  description: string;
  perform: () => void;
}

export interface ConfirmOptions {
  title: string;
  actions: readonly Action[];
  assumeYes?: boolean;
}

/** Print the planned actions, ask once, then perform them. */
export function confirmAndPerform(ctx: Ctx, opts: ConfirmOptions): boolean {
  if (opts.actions.length === 0) {
    ctx.stdout.write("Nothing to do.\n");
    return true;
  }

  ctx.stdout.write(`${opts.title}\n`);
  for (const action of opts.actions) ctx.stdout.write(`  ${action.description}\n`);

  if (!opts.assumeYes && !askYesNo(ctx, "Continue? [y/N] ")) {
    ctx.stdout.write("Aborted.\n");
    return false;
  }
  for (const action of opts.actions) action.perform();
  return true;
}

/**
 * Whether there is somebody at a terminal to answer a question.
 *
 * Both ends matter: the question is written to stdout and the answer is read
 * from stdin, so a run with either one redirected has nobody to ask. A caller
 * that would otherwise block a pipeline on a prompt uses this to decide to
 * say its piece and carry on instead.
 */
export function isInteractive(ctx: Ctx): boolean {
  return process.stdin.isTTY === true && ctx.stdout.isTTY === true;
}

/** Ask a yes/no question; anything but `y`/`yes` — including EOF — is a no. */
export function askYesNo(ctx: Ctx, question: string): boolean {
  ctx.stdout.write(question);
  const answer = readLineFromStdin();
  if (!ctx.stdout.isTTY) ctx.stdout.write("\n");
  return /^y(es)?$/i.test(answer.trim());
}

function readLineFromStdin(): string {
  const chunk = Buffer.alloc(256);
  let text = "";
  while (!text.includes("\n")) {
    let read: number;
    try {
      read = readSync(0, chunk, 0, chunk.length, null);
    } catch {
      break;
    }
    if (read === 0) break;
    text += chunk.subarray(0, read).toString("utf8");
  }
  return text.split("\n")[0] ?? "";
}
