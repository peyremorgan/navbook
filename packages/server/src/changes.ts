/**
 * What a pull request's revision changes, remembered across requests.
 *
 * A revision pins two SHAs, and what lies between two SHAs never changes: the
 * commits `base..head` and the diff of their trees are functions of immutable
 * objects (spec 02 §2.7). So an answer worked out once is right for as long
 * as the process lives, and the key needs no invalidation — unlike the author
 * walk in `people.ts`, whose key moves whenever HEAD does. What bounds this
 * cache is memory, not staleness: entries are evicted least-recently-used
 * once the patches they hold pass a budget.
 *
 * Nothing here takes the repository lock. A diff between two commits reads
 * the object store only, which a fetch or a merge running beside it appends
 * to and never rewrites; there is no tree to see consistently, because no
 * tree is read. That also means a request for a large diff queues behind
 * nothing and blocks nothing: git runs asynchronously, and the event loop
 * answers everybody else meanwhile.
 *
 * Sizing follows what the forges settled on, because their numbers are what
 * reviewers are used to. GitHub loads 400 lines of a file automatically and
 * withholds the rest behind "Load diff", and caps a file at 20,000 lines;
 * GitLab collapses files once a diff passes 5,000 lines; Gitea stops at
 * 1,000 lines. The budgets below sit in that range and are named for what
 * they decide, so a client sees every file of every diff, gets the patches of
 * a diff of ordinary size in the same answer, and asks for the rest by path.
 *
 * Derived, disposable and uncommitted (spec 06 §6.6).
 */

import {
  type ChangedFile,
  type CommitRange,
  commitsBetween,
  type Diff,
  diffBetweenAsync,
  GitError,
  objectExists,
} from "@navbook/core";
import { apiError } from "./errors.ts";

/**
 * A file whose patch is longer than this is listed with its counts but
 * without its hunks, until asked for by path (Gitea's limit; GitHub's is 400).
 */
export const INLINE_FILE_LINES = 1_000;

/**
 * Patches are sent in order until this many lines are on the wire; the files
 * after that are listed only. GitLab collapses at 5,000; GitHub caps a diff
 * at 20,000.
 */
export const INLINE_LINE_BUDGET = 10_000;

/** A patch asked for by path is cut here, as GitHub cuts a file (20,000 lines). */
export const HARD_FILE_LINES = 20_000;

/**
 * How much patch text the cache holds in all before the least recently used
 * entries go. The largest release-to-release diff of a big Go project is
 * about 300,000 lines and 12 MB, so this keeps a handful of those without
 * keeping the process in swap.
 */
const CACHE_BUDGET_CHARS = 64 * 1024 * 1024;

/**
 * A diff whose patch text passes this is remembered as a listing only, and
 * each file is diffed on its own when asked for.
 */
const KEEP_PATCHES_UP_TO_CHARS = 24 * 1024 * 1024;

/** How long git gets for one diff before the answer is a listing instead. */
const DIFF_TIMEOUT_MS = 30_000;

/** A file of a projected diff: what the API says about it. */
export interface ChangedFileView extends Omit<ChangedFile, "patch"> {
  /** Null when withheld for size or not applicable; the hunks otherwise. */
  patch: string | null;
  /** True when `patch` was cut at {@link HARD_FILE_LINES}. */
  truncated: boolean;
}

export interface ChangesView {
  base: string;
  head: string;
  files: ChangedFileView[];
  additions: number;
  deletions: number;
}

interface Entry {
  diff: Diff;
  /** False when the diff was kept without hunks, so patches are read per path. */
  withPatches: boolean;
  chars: number;
}

export interface RevisionCacheOptions {
  repoRoot: string;
  /**
   * The tracker's directory, whose files are listed after everything else.
   *
   * A pull request's own files ride on its branch (spec 03 §3.5), so its
   * `pr.md` and comments are in every diff of it. They are part of the change
   * and are shown; they are not what a reviewer opened the diff to read, and
   * `.navbook` sorts before `src`.
   */
  navDir?: string;
  /** Injectable, so a test can count the reads. */
  readDiff?: typeof diffBetweenAsync;
  readCommits?: typeof commitsBetween;
  exists?: typeof objectExists;
}

export class RevisionCache {
  private readonly diffs = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private readonly commits = new Map<string, CommitRange>();
  private chars = 0;
  private readonly opts: RevisionCacheOptions;
  private readonly readDiff: typeof diffBetweenAsync;
  private readonly readCommits: typeof commitsBetween;
  private readonly exists: typeof objectExists;

  constructor(opts: RevisionCacheOptions) {
    this.opts = opts;
    this.readDiff = opts.readDiff ?? diffBetweenAsync;
    this.readCommits = opts.readCommits ?? commitsBetween;
    this.exists = opts.exists ?? objectExists;
  }

  /** The commits `base..head`, oldest first, walked once per pair. */
  commitsOf(base: string, head: string, limit: number): CommitRange {
    const key = pairKey(base, head);
    let range = this.commits.get(key);
    if (range === undefined) {
      this.require(base, head);
      range = this.readCommits(this.opts.repoRoot, base, head);
      // A walk is a line per commit; a thousand pairs is a few megabytes.
      if (this.commits.size >= 1_000)
        this.commits.delete(this.commits.keys().next().value as string);
      this.commits.set(key, range);
    }
    return { total: range.total, commits: range.commits.slice(0, limit) };
  }

  /**
   * The diff of a pair, projected for the wire.
   *
   * Without `paths`: every file, with patches inline up to the budgets.
   * With `paths`: those files only, each with its patch however long, cut at
   * the hard limit — the follow-up a client makes for a withheld file.
   */
  async changesOf(base: string, head: string, paths?: readonly string[]): Promise<ChangesView> {
    const entry = await this.entryOf(base, head);
    if (paths === undefined) return inline(entry.diff);
    const wanted = new Set(paths);
    const files = entry.diff.files.filter((file) => wanted.has(file.path));
    if (entry.withPatches) return { ...entry.diff, files: files.map(cut) };
    // Kept as a listing, so the hunks are read now, for these files only.
    const fresh = await this.readDiff(this.opts.repoRoot, base, head, {
      paths: files.flatMap((file) =>
        file.oldPath === null ? [file.path] : [file.path, file.oldPath],
      ),
      timeoutMs: DIFF_TIMEOUT_MS,
    });
    const byPath = new Map(fresh.files.map((file) => [file.path, file]));
    return {
      ...entry.diff,
      files: files.map((file) => cut(byPath.get(file.path) ?? file)),
    };
  }

  private entryOf(base: string, head: string): Promise<Entry> {
    const key = pairKey(base, head);
    const cached = this.diffs.get(key);
    if (cached !== undefined) {
      // Re-inserting is what makes the map's order the recency order.
      this.diffs.delete(key);
      this.diffs.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.inflight.get(key);
    if (pending !== undefined) return pending;
    const loading = this.load(base, head).then((entry) => {
      this.remember(key, entry);
      return entry;
    });
    this.inflight.set(key, loading);
    loading.finally(() => this.inflight.delete(key)).catch(() => undefined);
    return loading;
  }

  private async load(base: string, head: string): Promise<Entry> {
    this.require(base, head);
    const cwd = this.opts.repoRoot;
    try {
      const diff = this.ordered(
        await this.readDiff(cwd, base, head, { timeoutMs: DIFF_TIMEOUT_MS }),
      );
      const chars = sizeOf(diff);
      if (chars <= KEEP_PATCHES_UP_TO_CHARS) return { diff, withPatches: true, chars };
      // Too much to keep: the listing is what is remembered, and the hunks
      // are dropped rather than held for a "Load diff" nobody may click.
      return { diff: listingOf(diff), withPatches: false, chars: 0 };
    } catch (error) {
      // Git refusing is the client's news; git overflowing or running out of
      // time is the size of the diff, and the listing is the answer to that.
      if (error instanceof GitError) throw error;
      const diff = await this.readDiff(cwd, base, head, {
        patches: false,
        timeoutMs: DIFF_TIMEOUT_MS,
      });
      return { diff: this.ordered(diff), withPatches: false, chars: 0 };
    }
  }

  /** Git's order, except that the tracker's own files come last. */
  private ordered(diff: Diff): Diff {
    const prefix = this.opts.navDir === undefined ? null : `${this.opts.navDir}/`;
    if (prefix === null) return diff;
    const tracker = (file: ChangedFile): boolean => file.path.startsWith(prefix);
    return {
      ...diff,
      files: [...diff.files.filter((f) => !tracker(f)), ...diff.files.filter(tracker)],
    };
  }

  private remember(key: string, entry: Entry): void {
    this.diffs.set(key, entry);
    this.chars += entry.chars;
    for (const [oldest, old] of this.diffs) {
      if (this.chars <= CACHE_BUDGET_CHARS || oldest === key) break;
      this.diffs.delete(oldest);
      this.chars -= old.chars;
    }
  }

  /**
   * Both commits must be here. A revision names objects, and a clone that
   * has not fetched them cannot say what they changed; the remedy is a
   * fetch, which is nothing this server can do for the client.
   */
  private require(base: string, head: string): void {
    for (const sha of [base, head]) {
      if (!this.exists(this.opts.repoRoot, sha)) {
        throw apiError(
          `this clone does not have commit ${sha}; fetch the branch first`,
          "MISSING_COMMIT",
          {
            sha,
          },
        );
      }
    }
  }
}

function pairKey(base: string, head: string): string {
  return `${base}..${head}`;
}

function sizeOf(diff: Diff): number {
  let chars = 0;
  for (const file of diff.files) chars += file.patch.length;
  return chars;
}

function listingOf(diff: Diff): Diff {
  return { ...diff, files: diff.files.map((file) => ({ ...file, patch: "" })) };
}

/** A file with its patch cut at the hard limit, for an answer by path. */
function cut(file: ChangedFile): ChangedFileView {
  if (file.patch === "") return { ...file, patch: null, truncated: false };
  if (file.lines <= HARD_FILE_LINES) return { ...file, truncated: false };
  const kept = file.patch.split("\n", HARD_FILE_LINES).join("\n");
  return { ...file, patch: `${kept}\n`, truncated: true };
}

/**
 * Every file, with patches inline while the budgets allow.
 *
 * Files are visited in git's order, and a file that is too long on its own
 * is skipped rather than ending the run, so the small files after a
 * generated one still arrive with their hunks.
 */
function inline(diff: Diff): ChangesView {
  let spent = 0;
  const files = diff.files.map((file): ChangedFileView => {
    if (file.patch === "") return { ...file, patch: null, truncated: false };
    if (file.lines > INLINE_FILE_LINES || spent + file.lines > INLINE_LINE_BUDGET) {
      return { ...file, patch: null, truncated: false };
    }
    spent += file.lines;
    return { ...file, truncated: false };
  });
  return { ...diff, files };
}
