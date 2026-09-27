/**
 * What an interrupted git housekeeping run leaves in the clone (#cvb57nhm).
 *
 * Git removes its lock files when it is asked to stop, but a SIGKILL — the
 * kernel tearing a container down, the OOM killer — leaves them behind, and
 * git never takes a lock it finds already taken: a stale `packed-refs.lock`
 * fails every `fetch --prune` from then on, which is every request the server
 * answers. The half-written pack a repack was making is left too, as large as
 * the repository, and nothing in git's default maintenance removes it.
 *
 * So this finds exactly those files, and nothing else. The locks are the ones
 * maintenance and ref packing take; a lock on the index, on HEAD or on a ref
 * means a commit or a ref update was cut short, and that is a person's to look
 * at, as the entrypoint keeps a dirty tree for one. The temporary files are
 * the ones git names as such (`tmp_…`, `.tmp-…`), in the directories packs,
 * commit graphs and the multi-pack index are written to.
 */

import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { gitMaybe } from "@navbook/core";

/** Where a clone keeps its refs and its objects. */
export interface GitDirs {
  /** The common git directory: `.git`, for an ordinary clone. */
  common: string;
  /** The object directory, wherever `GIT_OBJECT_DIRECTORY` or the layout puts it. */
  objects: string;
}

export interface Leftover {
  path: string;
  kind: "lock" | "temporary file";
  bytes: number;
}

/** Which files, when they are older or newer than a moment, to look for. */
export interface LeftoverAge {
  /** Only files last modified before this, in epoch milliseconds. */
  modifiedBefore?: number;
  /** Only files last modified at or after this, in epoch milliseconds. */
  modifiedSince?: number;
}

/** The lock files housekeeping takes, by the directory they are under. */
const LOCKS: ReadonlyArray<readonly [keyof GitDirs, string]> = [
  ["common", "packed-refs.lock"],
  ["common", "gc.pid"],
  ["common", "gc.log.lock"],
  ["objects", "maintenance.lock"],
  ["objects", "info/commit-graph.lock"],
  ["objects", "info/commit-graphs/commit-graph-chain.lock"],
  ["objects", "pack/multi-pack-index.lock"],
  ["objects", "pack/multi-pack-index.d/multi-pack-index-chain.lock"],
];

/**
 * Where under the object directory housekeeping writes temporary files, and
 * how it names them: the names it renames into place or removes once done.
 */
const TEMPORARIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["", ["bitmap-ref-tips_"]],
  ["pack", ["tmp_", ".tmp-"]],
  ["info/commit-graphs", ["tmp_"]],
  ["pack/multi-pack-index.d", ["tmp_"]],
];

/** The clone's git directories, as git itself resolves them. */
export function gitDirs(repoRoot: string): GitDirs {
  const answer = gitMaybe(
    ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-path", "objects"],
    { cwd: repoRoot },
  );
  const [common, objects] = answer?.split("\n") ?? [];
  if (!common || !objects) throw new Error(`cannot find the git directories of ${repoRoot}`);
  return { common, objects };
}

/** Every leftover of an interrupted housekeeping run in the clone, within `age`. */
export function findLeftovers(dirs: GitDirs, age: LeftoverAge = {}): Leftover[] {
  const found: Leftover[] = [];
  const consider = (path: string, kind: Leftover["kind"]): void => {
    const bytes = sizeIfWithin(path, age);
    if (bytes !== null) found.push({ path, kind, bytes });
  };
  for (const [base, path] of LOCKS) consider(join(dirs[base], path), "lock");
  for (const [dir, prefixes] of TEMPORARIES) {
    const at = join(dirs.objects, dir);
    for (const name of listing(at)) {
      if (prefixes.some((prefix) => name.startsWith(prefix))) {
        consider(join(at, name), "temporary file");
      }
    }
  }
  return found;
}

/**
 * Remove what {@link findLeftovers} found, saying what went.
 *
 * One that has gone already is no loss; one that cannot be removed is said,
 * and the rest are still removed.
 */
export function removeLeftovers(
  found: readonly Leftover[],
  repoRoot: string,
  report: (line: string) => void,
): void {
  for (const leftover of found) {
    const name = relative(repoRoot, leftover.path);
    try {
      rmSync(leftover.path, { force: true });
      report(`nav-server: removed ${describe(leftover, name)}`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      report(`nav-server: could not remove ${describe(leftover, name)}: ${why}`);
    }
  }
}

/**
 * At startup: clear what was left before `before`, or only say so.
 *
 * `remove` is whether this server owns the clone's housekeeping. When it does
 * not, whatever does may be running beside it at this very moment, and one of
 * these locks may be its — so a lock is named as a warning and left, and a
 * temporary file, which breaks nothing by being there, is not mentioned.
 */
export function clearLeftoversAtStart(
  dirs: GitDirs,
  repoRoot: string,
  opts: { before: number; remove: boolean; report: (line: string) => void },
): void {
  const found = findLeftovers(dirs, { modifiedBefore: opts.before });
  if (opts.remove) {
    removeLeftovers(found, repoRoot, opts.report);
    return;
  }
  for (const leftover of found) {
    if (leftover.kind !== "lock") continue;
    opts.report(
      `warning: ${describe(leftover, relative(repoRoot, leftover.path))} is left in place, ` +
        "since --maintenance-interval-ms 0 leaves housekeeping to something else; " +
        "remove it if nothing is running",
    );
  }
}

/** How a leftover is named in the log. */
function describe(leftover: Leftover, name: string): string {
  const size = leftover.kind === "temporary file" ? `, ${leftover.bytes} bytes` : "";
  return `${name} (a ${leftover.kind} an interrupted git left behind${size})`;
}

/** A regular file's size when its age is within bounds, or null. */
function sizeIfWithin(path: string, age: LeftoverAge): number | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (age.modifiedBefore !== undefined && !(stat.mtimeMs < age.modifiedBefore)) return null;
  if (age.modifiedSince !== undefined && !(stat.mtimeMs >= age.modifiedSince)) return null;
  return stat.size;
}

/** A directory's entries, or none when it does not exist. */
function listing(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
