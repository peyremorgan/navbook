#!/usr/bin/env node
/**
 * `nav` entry point.
 */

import { CommanderError } from "commander";
import { type Ctx, makeContext } from "./context.ts";
import { type ExitCode, NavError } from "./errors.ts";
import { buildProgram } from "./program.ts";

export interface RunOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

/** Run the CLI and return its exit code. Never throws for expected failures. */
export function run(opts: RunOptions = {}): ExitCode {
  const argv = opts.argv ?? process.argv.slice(2);
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  let ctx: Ctx | null = null;
  const getCtx = (): Ctx => {
    ctx ??= makeContext({ cwd: opts.cwd, env: opts.env, stdout, stderr });
    return ctx;
  };

  const program = buildProgram(getCtx);
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => stdout.write(text),
    writeErr: (text) => stderr.write(text),
  });

  try {
    program.parse(argv, { from: "user" });
    return 0;
  } catch (error) {
    return report(error, stderr);
  }
}

function report(error: unknown, stderr: NodeJS.WriteStream): ExitCode {
  if (error instanceof CommanderError) {
    // Commander already wrote help or the version string.
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") return 0;
    if (error.code === "commander.help") return 0;
    return error.exitCode === 0 ? 0 : 1;
  }
  if (error instanceof NavError) {
    stderr.write(`nav: ${error.message}\n`);
    for (const line of error.details) stderr.write(`${line}\n`);
    return error.exitCode;
  }
  stderr.write(`nav: ${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
}

/**
 * A closed pipe is a normal way for a command to end — `nav issue list | head`
 * closes stdout as soon as it has enough. Without this, node turns that into an
 * unhandled EPIPE and a stack trace.
 */
function exitQuietlyOnClosedPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

const isMain = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isMain) {
  exitQuietlyOnClosedPipe(process.stdout);
  exitQuietlyOnClosedPipe(process.stderr);
  process.exitCode = run();
}
