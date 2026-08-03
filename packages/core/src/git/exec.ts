/**
 * The single choke point for talking to git.
 *
 * Navbook shells out to the `git` binary rather than linking a library, so the
 * CLI's git behavior is definitionally the user's git (spec 05 §5.2).
 */

import { spawnSync } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  cwd?: string;
  input?: string;
  /** Extra environment entries layered over a locale-neutral base. */
  env?: NodeJS.ProcessEnv;
  /** Allow output larger than the default 10 MB buffer. */
  maxBuffer?: number;
}

export class GitError extends Error {
  readonly code: number;
  readonly stderr: string;
  readonly args: string[];

  constructor(args: string[], result: GitResult) {
    super(`git ${args.join(" ")} failed (exit ${result.code}): ${result.stderr.trim()}`);
    this.name = "GitError";
    this.code = result.code;
    this.stderr = result.stderr;
    this.args = args;
  }
}

/** Run git and return its result without throwing. */
export function gitRun(args: string[], opts: GitOptions = {}): GitResult {
  const result = spawnSync("git", args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", GIT_PAGER: "cat", ...opts.env },
  });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("git was not found on PATH; Navbook requires a working git installation");
    }
    throw result.error;
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Run git, throwing {@link GitError} on a non-zero exit. */
export function git(args: string[], opts: GitOptions = {}): string {
  const result = gitRun(args, opts);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}

/** Run git and return trimmed stdout, or null when the command fails. */
export function gitMaybe(args: string[], opts: GitOptions = {}): string | null {
  const result = gitRun(args, opts);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Split NUL-delimited git output into entries, dropping the trailing blank. */
export function splitNul(output: string): string[] {
  return output.split("\0").filter((entry) => entry !== "");
}

/** Split line-oriented git output, dropping the trailing blank. */
export function splitLines(output: string): string[] {
  return output.split("\n").filter((line) => line !== "");
}
