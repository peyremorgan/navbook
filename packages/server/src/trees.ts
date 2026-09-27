/**
 * The parsed tree, remembered across requests against the commit it was read at.
 *
 * Every read parses the Navbook tree, and on a deployment of a few thousand
 * files that parse was nearly all an issue page cost (#esqpmn7i). Between two
 * changes to the clone, every one of those parses produced the same answer.
 *
 * So, like the history walk `AuthorCache` keeps, the parse is remembered
 * against HEAD's sha, taken inside the caller's transaction. That covers what
 * `RepoSync` does to the clone: a merge from the remote moves HEAD, and a
 * mutation is reported through {@link TreeCache.invalidate}, because one that
 * fails can leave the working tree changed without having moved HEAD at all.
 *
 * What neither covers is somebody editing the served clone by hand, which is
 * supported: it is the way out of a clone the API cannot fix for itself. A
 * watchdog asks git every `intervalMs` whether anything under the Navbook
 * directory differs from HEAD, off the path of any request. While something
 * does, the cache is bypassed and every read parses the files as they are; a
 * hand edit is therefore seen within one interval. An interval of 0, which
 * elsewhere asks that every read see the clone as it is now, turns the cache
 * off altogether.
 *
 * A tree parsed with more comments serves a request that needs fewer, so an
 * issue page's comment-free reads and `people`'s full one share at most two
 * parses per commit. The records are shared by every request that reads them,
 * which is safe because nothing on the read path writes to a record: sorting
 * and filtering copy, and a record's comments are read into a new one.
 *
 * Derived, disposable and uncommitted — the only kind of index the format
 * permits anything to keep (spec 06 §6.6).
 */

import {
  type CommentScope,
  hasChangesUnderAsync,
  loadRepo,
  type Repo,
  resolveSha,
  type WsCtx,
} from "@navbook/core";

/** How much of a tree each scope reads, so a wider one can serve a narrower. */
const WIDTH: Record<CommentScope, number> = { none: 0, prs: 1, all: 2 };

export interface TreeCacheOptions {
  repoRoot: string;
  /** The Navbook directory, relative to `repoRoot`: what the watchdog asks about. */
  navDir: string;
  /** How often the watchdog looks for hand edits; 0 turns the cache off. */
  intervalMs: number;
  /** The parse itself, injectable so a test can count how often it happens. */
  load?: (ws: WsCtx, scope: CommentScope) => Repo;
  /** HEAD's sha, or null on a branch with no commits; injectable likewise. */
  head?: (repoRoot: string) => string | null;
  /** Whether anything under the Navbook directory differs from HEAD; likewise. */
  changed?: () => Promise<boolean>;
  /** Where to say the watchdog could not look, once until it can again. */
  report?: (line: string) => void;
}

export class TreeCache {
  private sha: string | null = null;
  private readonly trees = new Map<CommentScope, Repo>();
  /** True from the watchdog seeing a hand edit until it sees the tree clean. */
  private edited = false;
  private readonly opts: TreeCacheOptions;
  private readonly load: (ws: WsCtx, scope: CommentScope) => Repo;
  private readonly head: (repoRoot: string) => string | null;
  private readonly changed: () => Promise<boolean>;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private blind = false;

  constructor(opts: TreeCacheOptions) {
    this.opts = opts;
    this.load = opts.load ?? ((ws, comments) => loadRepo(ws, { comments }));
    this.head = opts.head ?? ((repoRoot) => resolveSha(repoRoot, "HEAD"));
    this.changed = opts.changed ?? (() => hasChangesUnderAsync(opts.repoRoot, opts.navDir));
  }

  /**
   * The tree at HEAD, with at least `scope`'s comments, parsed only when new.
   *
   * Call it where the tree is held still: inside `sync.read`, `sync.write` or
   * `sync.locked`, so the sha and the files it describes cannot part company.
   */
  at(ws: WsCtx, scope: CommentScope): Repo {
    if (this.opts.intervalMs <= 0 || this.edited) return this.load(ws, scope);
    const sha = this.head(ws.repoRoot);
    // No commit yet: nothing to key on, and nothing much to parse.
    if (sha === null) return this.load(ws, scope);
    if (sha !== this.sha) {
      this.trees.clear();
      this.sha = sha;
    }
    for (const [held, repo] of this.trees) {
      if (WIDTH[held] >= WIDTH[scope]) return repo;
    }
    const repo = this.load(ws, scope);
    this.trees.set(scope, repo);
    return repo;
  }

  /** Forget every tree: the working tree may have changed without HEAD moving. */
  invalidate(): void {
    this.sha = null;
    this.trees.clear();
  }

  /**
   * Look once for hand edits. Never throws: a watchdog that cannot tell
   * treats the tree as edited, since a cache it cannot vouch for is one to skip.
   */
  async check(): Promise<void> {
    let edited: boolean;
    try {
      edited = await this.changed();
      if (this.blind) this.opts.report?.("nav-server: the tree watchdog can see again");
      this.blind = false;
    } catch (error) {
      if (!this.blind) {
        const why = error instanceof Error ? error.message : String(error);
        this.opts.report?.(
          `nav-server: the tree watchdog cannot look, so nothing is cached: ${why}`,
        );
      }
      this.blind = true;
      edited = true;
    }
    if (edited) this.invalidate();
    this.edited = edited;
  }

  /** Start the watchdog, looking at once and then every `intervalMs`. */
  start(): void {
    if (this.opts.intervalMs <= 0 || this.timer || this.inFlight) return;
    this.stopped = false;
    this.schedule(0);
  }

  /** Stop the watchdog, waiting for a look in flight to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.check().finally(() => {
        this.inFlight = null;
        this.schedule(this.opts.intervalMs);
      });
    }, delayMs);
    // A pending look is no reason to keep the process alive.
    this.timer.unref();
  }
}
