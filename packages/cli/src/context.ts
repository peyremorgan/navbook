/**
 * The CLI's context: a workspace context plus the terminal it reports to.
 *
 * Everything that is not presentation — repository paths, the clock, ID
 * minting, identity — lives in `workspace/ctx.ts` and is shared with any other
 * front end. This module adds only what a terminal program needs on top.
 */

import { type CoreExtensions, makeWsCtx, type WsCtx } from "@navbook/core";
import { type Colors, makeColors } from "./render/colors.ts";

export interface Ctx extends WsCtx {
  colors: Colors;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export interface MakeContextOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  /** Skip repository discovery, for commands that work outside a repository. */
  requireRepo?: boolean;
  /** The Navbook directory, when the caller already knows it; see `makeWsCtx`. */
  navDir?: string;
  /**
   * What the loaded plugins registered (spec 02 §2.12).
   *
   * Supplied only for a command whose declaration says it needs the format
   * extensions, because loading them means importing plugin code and that is
   * what the budget of spec 05 §5.2 cannot afford on every invocation.
   */
  ext?: CoreExtensions;
}

/**
 * How the program asks for its context: built on first use, and memoised.
 *
 * `requireRepo: false` is for a command that works outside a repository; the
 * default refuses to build one there, which is the error most commands want.
 */
export type GetCtx = (opts?: { requireRepo?: boolean }) => Ctx;

export function makeContext(opts: MakeContextOptions = {}): Ctx {
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  const ws = makeWsCtx({
    cwd: opts.cwd,
    env,
    ...(opts.requireRepo !== undefined ? { requireRepo: opts.requireRepo } : {}),
    ...(opts.navDir !== undefined ? { navDir: opts.navDir } : {}),
    ...(opts.ext !== undefined ? { ext: opts.ext } : {}),
  });

  return { ...ws, colors: makeColors(stdout, env), stdout, stderr };
}
