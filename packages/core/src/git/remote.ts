/**
 * Talking to a remote — fetching and pushing.
 *
 * The CLI never needs these: it works in a checkout the user pushes themselves.
 * The API server does, because it owns a clone rather than a database and keeps
 * it in step with origin around every operation (spec 06 §6.3).
 *
 * Both commands reach the network, so both run with the terminal prompt
 * disabled: a server request must fail with a message rather than hang on a
 * credential prompt nobody is there to answer. And both have an `Async` twin
 * that takes a timeout, because a remote that has stopped answering is the
 * other way a request could hang — and the one a server cannot afford, since
 * every operation queues behind the one holding the clone.
 */

import {
  GitError,
  type GitResult,
  git,
  gitAsync,
  gitRun,
  gitRunAsync,
  splitLines,
} from "./exec.ts";

/** Environment for a command that may reach the network. */
const NON_INTERACTIVE: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };

/** What a call that reaches the network may be told. */
export interface NetworkOptions {
  /** Stop the command after this long; unset or 0 waits as long as git does. */
  timeoutMs?: number;
}

/** Remotes configured on the repository. */
export function listRemotes(cwd: string): string[] {
  const result = gitRun(["remote"], { cwd });
  return result.code === 0 ? splitLines(result.stdout) : [];
}

/** True when the repository has a remote of this name. */
export function hasRemote(cwd: string, name: string): boolean {
  return listRemotes(cwd).includes(name);
}

const fetchArgs = (remote: string): string[] => ["fetch", "--quiet", "--prune", remote];

/** Fetch a remote's branches, throwing {@link GitError} when git fails. */
export function fetchRemote(cwd: string, remote: string): void {
  git(fetchArgs(remote), { cwd, env: NON_INTERACTIVE });
}

/**
 * {@link fetchRemote} without blocking.
 *
 * Rejects with {@link GitTimeoutError} when the fetch outlives `timeoutMs`.
 */
export async function fetchRemoteAsync(
  cwd: string,
  remote: string,
  opts: NetworkOptions = {},
): Promise<void> {
  await gitAsync(fetchArgs(remote), { cwd, env: NON_INTERACTIVE, ...opts });
}

export type PushOutcome = "ok" | "rejected";

const pushArgs = (remote: string, branch: string): string[] => [
  "push",
  "--quiet",
  remote,
  `${branch}:${branch}`,
];

/**
 * Push a branch to a remote.
 *
 * A non-fast-forward refusal is a result, not a failure: it means somebody else
 * pushed first, and the caller's answer is to merge and try again. Every other
 * failure — no such remote, no credentials, no network — throws, because
 * retrying it could not help.
 */
export function pushBranch(cwd: string, remote: string, branch: string): PushOutcome {
  const args = pushArgs(remote, branch);
  return pushOutcome(args, gitRun(args, { cwd, env: NON_INTERACTIVE }));
}

/**
 * {@link pushBranch} without blocking.
 *
 * Rejects with {@link GitTimeoutError} when the push outlives `timeoutMs`. A
 * stopped push may or may not have landed — the remote decides that on its
 * own clock — which is why the caller's next push carries the same commits.
 */
export async function pushBranchAsync(
  cwd: string,
  remote: string,
  branch: string,
  opts: NetworkOptions = {},
): Promise<PushOutcome> {
  const args = pushArgs(remote, branch);
  return pushOutcome(args, await gitRunAsync(args, { cwd, env: NON_INTERACTIVE, ...opts }));
}

function pushOutcome(args: string[], result: GitResult): PushOutcome {
  if (result.code === 0) return "ok";
  if (isNonFastForward(result.stderr)) return "rejected";
  throw new GitError(args, result);
}

/**
 * Whether git refused a push because the remote has commits we do not.
 *
 * Matched on stderr because git reports every push failure with exit code 1.
 * The phrasing has been stable for many major versions, and the failure mode of
 * not recognising one is an error surfaced to the caller — never a silent loss.
 */
function isNonFastForward(stderr: string): boolean {
  return /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i.test(stderr);
}
