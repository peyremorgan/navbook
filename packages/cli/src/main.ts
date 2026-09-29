#!/usr/bin/env node
/**
 * `nav` entry point.
 */

import { realpathSync } from "node:fs";
import type { CoreExtensions } from "@navbook/core";
import { WorkspaceError } from "@navbook/core";
import { CommanderError } from "commander";
import { type Ctx, type GetCtx, makeContext } from "./context.ts";
import { type ExitCode, NavError } from "./errors.ts";
import { hintUndeclared } from "./plugins/hint.ts";
import {
  missingLine,
  type ResolvedPlugins,
  resolvePlugins,
  skippedLine,
} from "./plugins/resolve.ts";
import { PluginRuntime } from "./plugins/runtime.ts";
import { BUILTIN_NOUNS, buildProgram } from "./program.ts";

/** The reading of a repository there was none of, used when discovery failed. */
const NO_DECLARATION = {
  plugins: new Map<string, Record<string, unknown>>(),
  declared: false,
  problems: [],
};

export interface RunOptions {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

/**
 * Run the CLI and return its exit code. Never throws for expected failures.
 *
 * Asynchronous because a plugin's code is imported when one of its commands
 * runs (spec 04 §4.3), and `import()` is a promise. Nothing else about the
 * CLI became async: every built-in verb is still synchronous from end to end,
 * and a run with no plugins awaits nothing that was not already resolved.
 */
export async function run(opts: RunOptions = {}): Promise<ExitCode> {
  const argv = opts.argv ?? process.argv.slice(2);
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const env = opts.env ?? process.env;

  // Built once and memoised. `ext` is filled in below, before any command
  // runs, when and only when the words typed call for it.
  let ctx: Ctx | null = null;
  let ext: CoreExtensions | undefined;
  // A second context, for the commands that work outside a repository (the
  // plugin store's verbs), which a missing repository must not fail. Kept
  // apart so a command that does need one still gets the complaint.
  let looseCtx: Ctx | null = null;
  const getCtx: GetCtx = (want = {}) => {
    if (want.requireRepo === false) {
      looseCtx ??= makeContext({
        cwd: opts.cwd,
        env: opts.env,
        stdout,
        stderr,
        requireRepo: false,
      });
      return looseCtx;
    }
    ctx ??= makeContext({ cwd: opts.cwd, env: opts.env, stdout, stderr, ...(ext ? { ext } : {}) });
    return ctx;
  };

  let plugins: PluginRuntime;
  try {
    plugins = loadPluginRuntime(getCtx, env, stderr);
  } catch (error) {
    return report(error, stderr);
  }

  // The one place plugin code may be imported before parsing, and only because
  // the tree cannot be read without it: a registered directory would otherwise
  // parse as an uninterpreted path and a registered key as raw YAML. Decided
  // from the manifests, so a run that needs none pays nothing (spec 04 §4.3).
  if (plugins.needsCoreFor(argv)) {
    try {
      ext = await plugins.coreExtensions(getCtx());
      // Drop any context built while resolving, so nothing that reads the tree
      // can have been handed one without the extensions.
      ctx = null;
    } catch (error) {
      return report(error, stderr);
    }
  }

  const program = buildProgram(getCtx, plugins);
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => stdout.write(text),
    writeErr: (text) => stderr.write(text),
  });

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    return report(error, stderr);
  }
}

/**
 * Resolve what plugins this invocation has, and say what is missing.
 *
 * Reading the declaration needs a repository, and plenty of commands work
 * without one (`nav id`, `nav --help`, `nav init`). A context that cannot be
 * built is therefore not an error here: it means there is no declaration to
 * read, and whichever command runs next will complain about the missing
 * repository in its own words if it needs one.
 */
function loadPluginRuntime(
  getCtx: () => Ctx,
  env: NodeJS.ProcessEnv,
  stderr: NodeJS.WriteStream,
): PluginRuntime {
  let resolved: ResolvedPlugins;
  try {
    resolved = resolvePlugins(getCtx(), env);
  } catch {
    resolved = { active: [], missing: [], skipped: [], declaration: NO_DECLARATION };
  }
  const runtime = new PluginRuntime(resolved, BUILTIN_NOUNS);
  // Said once per run, before anything is parsed, so the reason a command is
  // missing is on screen above the complaint that it is missing.
  for (const line of runtime.notices) stderr.write(`${line}\n`);
  for (const { name, reason } of resolved.skipped) stderr.write(`${skippedLine(name, reason)}\n`);
  for (const name of resolved.missing) {
    stderr.write(`${missingLine(name, navDirOf(getCtx))}\n`);
  }
  // Said here rather than per command: whatever runs next, the reason `nav` is
  // ignoring a directory belongs above its output, not buried in it.
  try {
    const ctx = getCtx();
    if (ctx.hasNavbook) {
      hintUndeclared(
        ctx,
        resolved.declaration,
        resolved.active.flatMap((plugin) => plugin.manifest.format?.root ?? []),
      );
    }
  } catch {
    // No repository: there is no tree to have namespaces in.
  }
  return runtime;
}

function navDirOf(getCtx: () => Ctx): string {
  try {
    return getCtx().navDir;
  } catch {
    return ".navbook";
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
  // The workspace and operation layers report failures without knowing what an
  // exit code is. Every one of them is operational: a format violation reaches
  // exit 2 only through `doctor`, which raises it here in the CLI.
  if (error instanceof WorkspaceError) {
    stderr.write(`nav: ${error.message}\n`);
    for (const line of error.details) stderr.write(`${line}\n`);
    return 1;
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

/**
 * True when this file is the program being run.
 *
 * The paths are resolved through symlinks first: npm installs the binary as a
 * link in `node_modules/.bin`, so `process.argv[1]` is the link while
 * `import.meta.filename` is its target. Comparing them raw makes the installed
 * CLI silently do nothing.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(import.meta.filename);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  exitQuietlyOnClosedPipe(process.stdout);
  exitQuietlyOnClosedPipe(process.stderr);
  process.exitCode = await run();
}
