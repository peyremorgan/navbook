/**
 * The CLI's context: a workspace context plus the terminal it reports to.
 *
 * Everything that is not presentation — repository paths, the clock, ID
 * minting, identity — lives in `workspace/ctx.ts` and is shared with any other
 * front end. This module adds only what a terminal program needs on top.
 */

import { makeWsCtx, type WsCtx } from "@navbook/core";
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
}

export function makeContext(opts: MakeContextOptions = {}): Ctx {
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  const ws = makeWsCtx({
    cwd: opts.cwd,
    env,
    ...(opts.requireRepo !== undefined ? { requireRepo: opts.requireRepo } : {}),
  });

  return { ...ws, colors: makeColors(stdout, env), stdout, stderr };
}
