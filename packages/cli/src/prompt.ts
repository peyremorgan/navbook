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
  return /^y(es)?$/i.test((askLine(ctx, question) ?? "").trim());
}

/**
 * Ask a question and read one line of answer, without its newline.
 *
 * Null at the end of input, so a caller walking through several questions can
 * tell a closed stdin — a pipeline that ran out of answers — from an empty
 * answer somebody typed. When the answer did not come from a terminal, the
 * newline the terminal would have echoed is written, so the transcript still
 * reads one question per line.
 */
export function askLine(ctx: Ctx, question: string): string | null {
  ctx.stdout.write(question);
  const answer = readLineFromStdin();
  if (!ctx.stdout.isTTY) ctx.stdout.write("\n");
  return answer;
}

/**
 * One line of stdin, read a byte at a time.
 *
 * A byte at a time because stdin is shared by every question a command asks:
 * a buffered read would swallow the answers to the questions after this one,
 * which a person typing never notices and a script piping them always does.
 */
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

function readLineFromStdin(): string | null {
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let read: number;
    try {
      read = readSync(0, byte, 0, 1, null);
    } catch (error) {
      // A non-blocking stdin with nothing buffered yet: wait for it rather
      // than mistake it for the end of input, and without spinning.
      if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
        Atomics.wait(PAUSE, 0, 0, 20);
        continue;
      }
      break;
    }
    if (read === 0) break;
    if (byte[0] === 0x0a) return Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
    bytes.push(byte[0] as number);
  }
  return bytes.length === 0 ? null : Buffer.from(bytes).toString("utf8").replace(/\r$/, "");
}
