/**
 * Keeping the server's clone in step with origin — spec 06 §6.3.
 *
 * The server owns a clone, not a database: git is the only durable state, and
 * the clone is a working copy that can be thrown away and made again. So every
 * operation pulls before it runs, and every mutation pushes after it.
 *
 * Contention is handled by the ordinary merge rules of spec 03 §3.3, which
 * Navbook's tree is laid out to satisfy — the server gets no privileged path.
 * What it must never do is resolve a conflict on somebody's behalf: a merge that
 * conflicts is aborted and reported, and any commit already made stays in the
 * clone for an operator to deal with.
 */

import {
  abortMerge,
  canFastForward,
  commitMerge,
  conflictedPaths,
  currentBranch,
  fastForward,
  fetchRemote,
  isAlreadyMerged,
  type MergeOutcome,
  mergeNoCommit,
  type PushOutcome,
  pushBranch,
  resolveSha,
} from "@navbook/core";
import { apiError } from "./errors.ts";
import { Mutex } from "./lock.ts";

/** The git operations the engine needs, injectable so the matrix is testable. */
export interface SyncGit {
  fetchRemote(cwd: string, remote: string): void;
  pushBranch(cwd: string, remote: string, branch: string): PushOutcome;
  resolveSha(cwd: string, rev: string): string | null;
  isAlreadyMerged(cwd: string, source: string): boolean;
  canFastForward(cwd: string, source: string): boolean;
  fastForward(cwd: string, source: string): void;
  mergeNoCommit(cwd: string, source: string): MergeOutcome;
  commitMerge(cwd: string, message: string): string;
  abortMerge(cwd: string): void;
  conflictedPaths(cwd: string): string[];
  currentBranch(cwd: string): string | null;
}

export const REAL_GIT: SyncGit = {
  fetchRemote,
  pushBranch,
  resolveSha,
  isAlreadyMerged,
  canFastForward,
  fastForward,
  mergeNoCommit,
  commitMerge,
  abortMerge,
  conflictedPaths,
  currentBranch,
};

export interface SyncOptions {
  repoRoot: string;
  /** The remote to synchronise with, or null to work offline. */
  remote: string | null;
  /** How stale a read may let its view of the remote become. */
  pullIntervalMs: number;
  git?: SyncGit;
  now?: () => number;
}

/** What a mutation's write did, and whether the commit reached the remote. */
export interface WriteResult<T> {
  result: T;
  pushed: boolean;
}

/**
 * A merge with the remote that git could not do on its own.
 *
 * Internal to the engine: whether a local commit was left behind depends on
 * where the merge was attempted, and only the caller knows that.
 */
class MergeConflict extends Error {
  readonly paths: string[];

  constructor(paths: string[]) {
    super("merge conflict");
    this.name = "MergeConflict";
    this.paths = paths;
  }
}

/** The conflict as a client is told about it. */
export function syncConflict(paths: readonly string[], keptLocalCommit: boolean): Error {
  return apiError(
    "the server's clone conflicts with the remote and was not merged",
    "SYNC_CONFLICT",
    {
      paths,
      keptLocalCommit,
      details: keptLocalCommit
        ? ["the change was committed locally but not pushed; an operator must reconcile the clone"]
        : ["an operator must reconcile the clone before this operation can run"],
    },
  );
}

/** A push the remote kept refusing, with no conflict to explain it. */
export function syncPushRejected(): Error {
  return apiError(
    "the change was committed locally but the remote refused the push",
    "SYNC_PUSH_REJECTED",
    { details: ["the remote moved again during the retry; try the operation again"] },
  );
}

export class RepoSync {
  private readonly lock = new Mutex();
  private readonly opts: SyncOptions;
  private readonly git: SyncGit;
  private readonly now: () => number;
  private lastFetch = Number.NEGATIVE_INFINITY;

  constructor(opts: SyncOptions) {
    this.opts = opts;
    this.git = opts.git ?? REAL_GIT;
    this.now = opts.now ?? Date.now;
  }

  /** True when there is no remote to synchronise with. */
  get localOnly(): boolean {
    return this.opts.remote === null;
  }

  /** Run a read, having brought the clone up to date first. */
  read<T>(body: () => T): Promise<T> {
    return this.lock.run(() => {
      this.pull({ force: false, keptLocalCommit: false });
      return body();
    });
  }

  /**
   * Run something against the clone without synchronising first.
   *
   * For work that follows a transaction rather than starting one: a field
   * resolver runs after its parent returned, so the lock has been released and
   * the tree it reads could otherwise be moving under it. The pull is skipped
   * because the answer must describe the same tree the parent already saw.
   */
  locked<T>(body: () => T): Promise<T> {
    return this.lock.run(body);
  }

  /**
   * Run a mutation between a pull and a push.
   *
   * `committed` says whether the operation actually produced a commit: a plan
   * that turned out to be a no-op has nothing to push, and reporting it as
   * pushed would be a lie.
   */
  write<T>(body: () => T, committed: (result: T) => boolean): Promise<WriteResult<T>> {
    return this.lock.run(() => {
      this.pull({ force: true, keptLocalCommit: false });
      const result = body();
      const pushed = committed(result) ? this.pushWithRetry() : false;
      return { result, pushed };
    });
  }

  /** Wait for in-flight work to finish, so shutdown never cuts one in half. */
  drain(): Promise<void> {
    return this.lock.drain();
  }

  /**
   * Bring the clone up to date with the remote.
   *
   * A read may reuse a recent fetch — `pullIntervalMs` says how recent — because
   * asking the network on every request would make the server's latency the
   * network's. A mutation always fetches: it is about to write, and writing on a
   * stale tree is how avoidable conflicts are made.
   */
  private pull(opts: { force: boolean; keptLocalCommit: boolean }): void {
    const remote = this.opts.remote;
    if (remote === null) return;
    if (!opts.force && this.now() - this.lastFetch < this.opts.pullIntervalMs) return;

    this.git.fetchRemote(this.opts.repoRoot, remote);
    this.lastFetch = this.now();
    try {
      this.merge(remote);
    } catch (error) {
      if (error instanceof MergeConflict) throw syncConflict(error.paths, opts.keptLocalCommit);
      throw error;
    }
  }

  /** Merge the remote-tracking branch into HEAD. Throws {@link MergeConflict}. */
  private merge(remote: string): void {
    const root = this.opts.repoRoot;
    const branch = this.git.currentBranch(root);
    if (branch === null) return;
    const upstream = `${remote}/${branch}`;
    // Nothing to merge: the remote has no such branch yet, or holds nothing new.
    if (this.git.resolveSha(root, upstream) === null) return;
    if (this.git.isAlreadyMerged(root, upstream)) return;

    if (this.git.canFastForward(root, upstream)) {
      this.git.fastForward(root, upstream);
      return;
    }
    if (this.git.mergeNoCommit(root, upstream) === "conflict") {
      const paths = this.git.conflictedPaths(root);
      // Abort before reporting: leaving a half-merged tree behind would fail
      // every later operation for a reason unrelated to what it asked for.
      this.git.abortMerge(root);
      throw new MergeConflict(paths);
    }
    this.git.commitMerge(root, `Merge remote-tracking branch '${upstream}'`);
  }

  /**
   * Push, and on a refusal merge what arrived and push once more.
   *
   * One retry, not a loop: a second refusal means the remote is moving faster
   * than the server can win by racing it, and saying so is more useful than
   * spinning. The change is safe either way — it is in the clone's history, and
   * the error says so.
   */
  private pushWithRetry(): boolean {
    const remote = this.opts.remote;
    if (remote === null) return false;
    const root = this.opts.repoRoot;
    const branch = this.git.currentBranch(root);
    if (branch === null) return false;

    if (this.git.pushBranch(root, remote, branch) === "ok") return true;
    // Rejected: somebody pushed first. Merge what they pushed and try again —
    // and if that merge conflicts, the commit stays local, which the error says.
    this.pull({ force: true, keptLocalCommit: true });
    if (this.git.pushBranch(root, remote, branch) === "ok") return true;
    throw syncPushRejected();
  }
}
