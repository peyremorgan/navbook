/**
 * Talking to a remote — fetching and pushing.
 *
 * The CLI never needs these: it works in a checkout the user pushes themselves.
 * The API server does, because it owns a clone rather than a database and keeps
 * it in step with origin around every operation (spec 06 §6.3).
 *
 * Both commands reach the network, so both run with the terminal prompt
 * disabled: a server request must fail with a message rather than hang on a
 * credential prompt nobody is there to answer.
 */

import { GitError, git, gitRun, splitLines } from "./exec.ts";

/** Environment for a command that may reach the network. */
const NON_INTERACTIVE: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };

/** Remotes configured on the repository. */
export function listRemotes(cwd: string): string[] {
  const result = gitRun(["remote"], { cwd });
  return result.code === 0 ? splitLines(result.stdout) : [];
}

/** True when the repository has a remote of this name. */
export function hasRemote(cwd: string, name: string): boolean {
  return listRemotes(cwd).includes(name);
}

/** Fetch a remote's branches, throwing {@link GitError} when git fails. */
export function fetchRemote(cwd: string, remote: string): void {
  git(["fetch", "--quiet", "--prune", remote], { cwd, env: NON_INTERACTIVE });
}

export type PushOutcome = "ok" | "rejected";

/**
 * Push a branch to a remote.
 *
 * A non-fast-forward refusal is a result, not a failure: it means somebody else
 * pushed first, and the caller's answer is to merge and try again. Every other
 * failure — no such remote, no credentials, no network — throws, because
 * retrying it could not help.
 */
export function pushBranch(cwd: string, remote: string, branch: string): PushOutcome {
  const args = ["push", "--quiet", remote, `${branch}:${branch}`];
  const result = gitRun(args, { cwd, env: NON_INTERACTIVE });
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
