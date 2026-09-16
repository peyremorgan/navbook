/**
 * The single choke point for talking to git.
 *
 * Navbook shells out to the `git` binary rather than linking a library, so the
 * CLI's git behavior is definitionally the user's git (spec 05 §5.2).
 *
 * Two runners, one contract. {@link gitRun} blocks: the CLI is a process that
 * runs one command and exits, and has nothing to gain from yielding. The API
 * server has everything to gain, because it answers many people from one event
 * loop — a fetch that blocks the loop is every other request's latency — so
 * {@link gitRunAsync} is the same call as a promise, with a timeout the server
 * can put on the calls that reach the network. Both spawn the same binary with
 * the same environment and report the same {@link GitResult}.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

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
  /** Allow output larger than the default 64 MB buffer. */
  maxBuffer?: number;
}

export interface GitAsyncOptions extends GitOptions {
  /**
   * How long the command may run before it is stopped, in milliseconds.
   *
   * A command that outlives it is told to stop and the call rejects with
   * {@link GitTimeoutError}. Unset or 0 waits as long as git itself does.
   */
  timeoutMs?: number;
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

/**
 * A command that ran out of the time it was given, and was stopped.
 *
 * Not a {@link GitError}: there is no exit status to report, and the caller's
 * answer is different — nothing git said explains it, the clock does.
 */
export class GitTimeoutError extends Error {
  readonly args: string[];
  readonly timeoutMs: number;

  constructor(args: string[], timeoutMs: number) {
    super(`git ${args.join(" ")} did not finish within ${timeoutMs} ms and was stopped`);
    this.name = "GitTimeoutError";
    this.args = args;
    this.timeoutMs = timeoutMs;
  }
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * How long a stopped command gets to clean up before it is killed outright.
 *
 * Git removes its lock files on `SIGTERM`; a `SIGKILL` would leave them for
 * the next command to trip over. So that is what a timeout sends first, and
 * the kill is only for a git that did not take the hint.
 */
const KILL_GRACE_MS = 2_000;

/** The environment every git command runs with: the caller's, made locale-neutral. */
function gitEnv(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: "C", GIT_PAGER: "cat", ...extra };
}

/** What a failure to spawn git at all means to the person running it. */
function spawnFailure(error: NodeJS.ErrnoException): Error {
  if (error.code === "ENOENT") {
    return new Error("git was not found on PATH; Navbook requires a working git installation");
  }
  return error;
}

/** Run git and return its result without throwing. */
export function gitRun(args: string[], opts: GitOptions = {}): GitResult {
  const result = spawnSync("git", args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    env: gitEnv(opts.env),
  });
  if (result.error) throw spawnFailure(result.error as NodeJS.ErrnoException);
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

/**
 * Run git without blocking, and resolve with its result.
 *
 * The promise-returning twin of {@link gitRun}: same binary, same environment,
 * same result, and the same errors for a git that is missing or that produces
 * more output than allowed. What it adds is `timeoutMs`, which rejects with
 * {@link GitTimeoutError} rather than waiting on a remote that has stopped
 * answering.
 */
export function gitRunAsync(args: string[], opts: GitAsyncOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: gitEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let failure: Error | null = null;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killer: NodeJS.Timeout | undefined;

    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      outcome();
    };
    const fail = (error: Error): void => {
      if (failure === null) failure = error;
      child.kill("SIGKILL");
    };

    const stdout = collect(child.stdout, maxBuffer, () =>
      fail(new Error(`git ${args.join(" ")} produced more than ${maxBuffer} bytes of output`)),
    );
    const stderr = collect(child.stderr, maxBuffer, () =>
      fail(new Error(`git ${args.join(" ")} produced more than ${maxBuffer} bytes on stderr`)),
    );

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      }, opts.timeoutMs);
    }

    // A git that exits without reading its input closes the pipe first; that
    // is its business, not a failure of ours.
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");

    child.on("error", (error) => settle(() => reject(spawnFailure(error))));
    child.on("exit", () => {
      // The process is gone, so the clock stops; only its output is still
      // draining. A stopped command's output is not wanted, and waiting for it
      // could take as long as the command would have: a child git started —
      // `receive-pack`, a credential helper — keeps the pipes open until it
      // finishes, which is the wait the timeout exists to avoid.
      clearTimeout(timer);
      if (!timedOut) return;
      dropOutput(child);
      settle(() => reject(new GitTimeoutError(args, opts.timeoutMs ?? 0)));
    });
    child.on("close", (code) =>
      settle(() => {
        if (failure !== null) return reject(failure);
        resolve({ code: code ?? 1, stdout: stdout(), stderr: stderr() });
      }),
    );
  });
}

/** Gather a stream's output, calling `overflow` once it exceeds `maxBuffer`. */
function collect(stream: Readable, maxBuffer: number, overflow: () => void): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxBuffer) {
      overflow();
      return;
    }
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

/** Stop reading a child's output, so nothing it left running holds us. */
function dropOutput(child: ChildProcess): void {
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/** Run git without blocking, throwing {@link GitError} on a non-zero exit. */
export async function gitAsync(args: string[], opts: GitAsyncOptions = {}): Promise<string> {
  const result = await gitRunAsync(args, opts);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}

/** Run git without blocking; trimmed stdout, or null when the command fails. */
export async function gitMaybeAsync(
  args: string[],
  opts: GitAsyncOptions = {},
): Promise<string | null> {
  const result = await gitRunAsync(args, opts);
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
