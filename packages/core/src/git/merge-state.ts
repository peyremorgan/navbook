/**
 * What an interrupted `nav pr merge` left behind — spec 04 §4.3.
 *
 * `--continue` used to need nothing: a conflicted `git merge` leaves
 * `MERGE_HEAD`, and the commit it names says which pull request was coming in.
 * Two of the merge methods of [02 §2.10] stop without one. A replay stops
 * inside a rebase, whose `MERGE_HEAD` — when the backend writes one at all —
 * names a commit being replayed rather than the branch. A squash never writes
 * one, because the commit it is heading for has a single parent and is not a
 * merge. Neither leaves anything that says which branch to come back to
 * either, since a replay stops with HEAD somewhere else entirely.
 *
 * So the merge writes down what it was doing before the step that can stop,
 * and removes it once the pull request is filed as merged. The note lives in
 * the git directory rather than in the tracker for the same reason `MERGE_HEAD`
 * does: it is one worktree's business, it must survive a checkout of another
 * branch, and a merge is exactly the operation that would otherwise try to
 * merge it.
 *
 * A note that cannot be read is treated as no note at all. The fallback is
 * what `--continue` did before this file existed, which is worse than the note
 * but not nothing, and a tool that refused to finish a merge because of a
 * scratch file it wrote itself would be the least helpful outcome available.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMergeMethod, type MergeMethod } from "../core/policy.ts";
import { gitDir } from "./repo.ts";

/** Which step was under way, and therefore how it is picked back up. */
export type MergeStage =
  /** `git merge --no-ff --no-commit`, which leaves `MERGE_HEAD`. */
  | "merge"
  /** A replay of the source's commits, which leaves a rebase in progress. */
  | "replay"
  /** `git merge --squash`, which leaves a staged change and nothing else. */
  | "squash";

/** The merge a repository is in the middle of. */
export interface PendingMerge {
  /** The pull request being merged. */
  id: string;
  /** The ref its commits came from, as the plan named it. */
  sourceRef: string;
  /** The branch to be standing on when the merge lands. */
  targetBranch: string;
  method: MergeMethod;
  stage: MergeStage;
  /** Whether the source branch is to be brought up to the target afterwards. */
  syncSource: boolean;
  /** Whether the replay was handed the branch name, and so rewrote it. */
  rewroteSource: boolean;
}

/** Bumped only by a change that an older `nav` would read wrongly. */
const VERSION = 1;

const DIR = "navbook";
const FILE = "pending-merge.json";

function notePath(cwd: string): string {
  return join(gitDir(cwd), DIR, FILE);
}

/** Write down what this merge is doing, replacing any earlier note. */
export function writePendingMerge(cwd: string, pending: PendingMerge): void {
  const path = notePath(cwd);
  mkdirSync(join(gitDir(cwd), DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: VERSION, ...pending }, null, 2)}\n`, "utf8");
}

/** The merge in progress, or null when there is no readable note. */
export function readPendingMerge(cwd: string): PendingMerge | null {
  const path = notePath(cwd);
  if (!existsSync(path)) return null;
  try {
    return parsePendingMerge(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/** Forget the merge, which is what finishing or abandoning one amounts to. */
export function clearPendingMerge(cwd: string): void {
  rmSync(notePath(cwd), { force: true });
}

/**
 * Read a note only if every field of it is there and of the right shape.
 *
 * All or nothing: half a note would send `--continue` to the wrong branch with
 * the wrong method, which is worse than sending it to `MERGE_HEAD`.
 */
function parsePendingMerge(value: unknown): PendingMerge | null {
  if (typeof value !== "object" || value === null) return null;
  const note = value as Record<string, unknown>;
  if (note.version !== VERSION) return null;
  const { id, sourceRef, targetBranch, method, stage, syncSource, rewroteSource } = note;
  if (typeof id !== "string" || id === "") return null;
  if (typeof sourceRef !== "string" || sourceRef === "") return null;
  if (typeof targetBranch !== "string" || targetBranch === "") return null;
  if (!isMergeMethod(method)) return null;
  if (stage !== "merge" && stage !== "replay" && stage !== "squash") return null;
  if (typeof syncSource !== "boolean" || typeof rewroteSource !== "boolean") return null;
  return { id, sourceRef, targetBranch, method, stage, syncSource, rewroteSource };
}
