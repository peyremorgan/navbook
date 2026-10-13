/**
 * Git configuration for every git the server runs, passed through the environment.
 *
 * `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>` is
 * configuration git reads as if it were given with `-c`, and every git the
 * server starts inherits the process environment — the CLI's, a plugin's,
 * the synchronous commit's as much as the network calls'. Nothing is written
 * into the clone's own config, which stays the deployment's to read.
 */

import { existsSync } from "node:fs";
import { gitMaybe, SPARSE_CHECKOUT_CONFIG } from "@navbook/core";

/**
 * Add one entry after whatever the environment already carries.
 *
 * Git reads the entries in order and the last one of a key wins, so this
 * overrides any earlier value of `key` without disturbing the others — the
 * entrypoint's identity and credential helper among them.
 */
export function appendGitConfig(env: NodeJS.ProcessEnv, key: string, value: string): void {
  const given = env.GIT_CONFIG_COUNT;
  const count = given === undefined || given === "" ? 0 : gitCount(given);
  // Anything else, git refuses outright: there is nothing sensible to add to.
  if (count === null) {
    throw new Error(`GIT_CONFIG_COUNT is '${given}', which git does not accept as a count`);
  }
  env[`GIT_CONFIG_KEY_${count}`] = key;
  env[`GIT_CONFIG_VALUE_${count}`] = value;
  env.GIT_CONFIG_COUNT = String(count + 1);
}

/**
 * A count read the way git reads it: decimal, leading blanks and a `+`
 * allowed, nothing after the digits. `010` is ten entries to git, not eight;
 * `0x2` and a negative count it refuses, and so does this.
 */
function gitCount(text: string): number | null {
  const match = /^\s*\+?([0-9]+)$/.exec(text);
  return match === null ? null : Number.parseInt(match[1] as string, 10);
}

/**
 * Keep git from starting maintenance on its own after a commit, fetch or merge.
 *
 * It would detach it, where nothing the server does can stop it cleanly; the
 * server runs the same maintenance itself instead (`maintenance.ts`).
 */
export function disableAutoMaintenance(env: NodeJS.ProcessEnv): void {
  appendGitConfig(env, "maintenance.auto", "false");
}

/**
 * Keep the worktrees the server makes for a write to their sparse-checkout
 * patterns, through every merge it runs there (core `addSparseWorktree`).
 *
 * Git applies the patterns only in a worktree that has a patterns file of its
 * own, so the clone itself stays whole — unless it has one already, left from
 * a sparse checkout somebody once set up and turned off. These settings would
 * then turn it back on, under the server, so it is left alone: the server's
 * worktrees are still sparse when made, and a merge there writes out whatever
 * it brings in. What to say about that is returned, or null.
 */
export function enableSparseWorktrees(env: NodeJS.ProcessEnv, repoRoot: string): string | null {
  const own = gitMaybe(
    ["rev-parse", "--path-format=absolute", "--git-path", "info/sparse-checkout"],
    { cwd: repoRoot, env },
  );
  if (own !== null && existsSync(own)) {
    return (
      `nav-server: ${own} exists, so the clone keeps its own sparse-checkout settings; ` +
      "a merge in a worktree made for a write checks out everything it brings in"
    );
  }
  for (const [key, value] of SPARSE_CHECKOUT_CONFIG) appendGitConfig(env, key, value);
  return null;
}
