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
 * at, as the entrypoint keeps a dirty tree for one: those are named in the log
 * and left. Nor is anything removed while a git is running in the clone, since
 * the lock may be its. The temporary files are
 * the ones git names as such (`tmp_…`, `.tmp-…`), in the directories packs,
 * commit graphs and the multi-pack index are written to.
 */

import {
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
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

/**
 * The clone's git directories, as git itself resolves them.
 *
 * Git answers relative to the directory it ran in unless told otherwise, and
 * `--path-format=absolute` would tell it — but only from git 2.31, and the
 * server has never asked for a git that new. So the answer is resolved here.
 */
export function gitDirs(repoRoot: string): GitDirs {
  const answer = gitMaybe(["rev-parse", "--git-common-dir", "--git-path", "objects"], {
    cwd: repoRoot,
  });
  const [common, objects] = answer?.split("\n") ?? [];
  if (!common || !objects) throw new Error(`cannot find the git directories of ${repoRoot}`);
  return { common: resolve(repoRoot, common), objects: resolve(repoRoot, objects) };
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

/** What a clear-up is told: when, and what may be removed. */
export interface ClearOptions {
  /** Only what was last modified before this, in epoch milliseconds. */
  before?: number;
  /** Only what was last modified at or after this, in epoch milliseconds. */
  since?: number;
  /**
   * Whether this server owns the clone's housekeeping. When it does not,
   * whatever does may be running beside it right now, holding one of these
   * very locks — so they are named as warnings and left.
   */
  remove: boolean;
  report: (line: string) => void;
  /** The gits running in the clone; looked up in /proc unless given. */
  running?: readonly number[];
}

/**
 * Clear what an interrupted housekeeping run left, or say why not.
 *
 * Age alone cannot tell a stale lock from one a running git holds: an
 * operator's `git gc`, a run a crashed server left orphaned, maintenance a
 * cron job started. So a git found running in the clone turns removing into
 * warning too. A temporary file breaks nothing by being there, so when
 * nothing is removed it is not mentioned either.
 */
export function clearLeftovers(dirs: GitDirs, repoRoot: string, opts: ClearOptions): void {
  const found = findLeftovers(dirs, age(opts));
  if (found.length === 0) return;
  const running = opts.running ?? gitsRunningIn(dirs, repoRoot);
  if (opts.remove && running.length === 0) {
    removeLeftovers(found, repoRoot, opts.report);
    return;
  }
  const why = opts.remove
    ? `a git is running in the clone (pid ${running.join(", ")})`
    : "--maintenance-interval-ms 0 leaves housekeeping to something else";
  for (const leftover of found) {
    if (leftover.kind !== "lock") continue;
    opts.report(
      `warning: ${describe(leftover, relative(repoRoot, leftover.path))} is left in place, ` +
        `since ${why}; remove it if nothing is running`,
    );
  }
}

/**
 * At startup: clear what was left before `before`, and name what is not ours to.
 *
 * A lock on the index, HEAD, a ref or its log means a commit or an update
 * was cut short. It is never removed — a person should look at what it was
 * doing — but it is named, because until it goes git refuses to update what
 * it locks, and that would otherwise surface as a failed request much later.
 */
export function clearLeftoversAtStart(
  dirs: GitDirs,
  repoRoot: string,
  opts: Omit<ClearOptions, "before" | "since"> & { before: number },
): void {
  clearLeftovers(dirs, repoRoot, opts);
  for (const leftover of findCutShort(dirs, { modifiedBefore: opts.before })) {
    opts.report(
      `warning: ${relative(repoRoot, leftover.path)} (a lock a cut-short commit or ref ` +
        "update left behind) is left in place for a person to look at; " +
        "git refuses to update what it locks until it is removed",
    );
  }
}

/** Locks that mean a commit or a ref update was cut short: named, never removed. */
export function findCutShort(dirs: GitDirs, age: LeftoverAge = {}): Leftover[] {
  const found: Leftover[] = [];
  const consider = (path: string): void => {
    const bytes = sizeIfWithin(path, age);
    if (bytes !== null) found.push({ path, kind: "lock", bytes });
  };
  consider(join(dirs.common, "index.lock"));
  consider(join(dirs.common, "HEAD.lock"));
  for (const dir of ["refs", "logs"]) {
    for (const path of locksUnder(join(dirs.common, dir))) consider(path);
  }
  return found;
}

/**
 * The pids of the gits at work on the clone's repository.
 *
 * A git works on it when it runs in any of its worktrees, or in its git or
 * object directory, or is pointed at them: by `GIT_DIR` and its kin in the
 * environment it started with, or by `--git-dir` on its command line (which
 * git only hands on to what it starts, so the command line has to be read
 * too). Read from /proc, so only on Linux — where the server's image runs —
 * and only for the processes this one may look at; elsewhere it finds none,
 * which leaves the age of a file as the only guard, as it was.
 */
export function gitsRunningIn(dirs: GitDirs, repoRoot: string): number[] {
  const places = [repoRoot, dirs.common, dirs.objects, ...worktrees(repoRoot)].map(real);
  const within = (path: string): boolean =>
    places.some((place) => path === place || path.startsWith(`${place}/`));
  const found: number[] = [];
  for (const entry of listing("/proc")) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      if (!readFileSync(`/proc/${entry}/comm`, "utf8").startsWith("git")) continue;
      const cwd = readlinkSync(`/proc/${entry}/cwd`);
      const named = [...pointedAt(entry)].map((path) => real(resolve(cwd, path)));
      if (within(cwd) || named.some(within)) found.push(Number(entry));
    } catch {
      // Gone since the listing, or not ours to look at.
    }
  }
  return found;
}

/** The directories a process's environment and command line point git at. */
function* pointedAt(pid: string): Generator<string> {
  const read = (file: string): string[] => {
    try {
      return readFileSync(`/proc/${pid}/${file}`, "utf8").split("\0");
    } catch {
      return [];
    }
  };
  for (const variable of read("environ")) {
    const match = /^GIT_(?:DIR|COMMON_DIR|OBJECT_DIRECTORY|WORK_TREE)=(.+)$/.exec(variable);
    if (match) yield match[1] as string;
  }
  const argv = read("cmdline");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=")) {
      yield arg.slice(arg.indexOf("=") + 1);
    } else if ((arg === "--git-dir" || arg === "--work-tree") && argv[i + 1]) {
      yield argv[i + 1] as string;
    }
  }
}

/** Every worktree of the clone's repository, the main one included. */
function worktrees(repoRoot: string): string[] {
  const listed = gitMaybe(["worktree", "list", "--porcelain"], { cwd: repoRoot }) ?? "";
  return listed
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** A path with its symlinks resolved, as /proc reports a working directory. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
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

/** Every `*.lock` file under a directory, however deep. */
function locksUnder(dir: string): string[] {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...locksUnder(path));
    else if (entry.name.endsWith(".lock")) found.push(path);
  }
  return found;
}

/** The age filter a clear-up asks for. */
function age(opts: ClearOptions): LeftoverAge {
  return {
    ...(opts.before === undefined ? {} : { modifiedBefore: opts.before }),
    ...(opts.since === undefined ? {} : { modifiedSince: opts.since }),
  };
}

/** A directory's entries, or none when it does not exist. */
function listing(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
