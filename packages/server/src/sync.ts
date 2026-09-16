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
 *
 * The git calls are awaited, not blocked on. A fetch or a push takes as long
 * as the network takes, and a server that blocked its event loop for that
 * would make one person's slow push everybody's latency — including requests
 * that never touch the clone. So the network calls yield, and the operation
 * they belong to holds the {@link Mutex} while they do; the tree stays still
 * for it, and the process stays answerable for everyone else. The operation's
 * own body — composing files, validating them, committing — stays synchronous:
 * it is local disk work measured in milliseconds, and the boundary belongs
 * where the network is.
 */

import {
  abortMergeAsync,
  canFastForwardAsync,
  commitMergeAsync,
  conflictedPathsAsync,
  currentBranchAsync,
  fastForwardAsync,
  fetchRemoteAsync,
  GitTimeoutError,
  isAlreadyMergedAsync,
  type MergeOutcome,
  mergeNoCommitAsync,
  type NetworkOptions,
  type PushOutcome,
  pushBranchAsync,
  resolveShaAsync,
} from "@navbook/core";
import { apiError } from "./errors.ts";
import { Mutex } from "./lock.ts";

/** The git operations the engine needs, injectable so the matrix is testable. */
export interface SyncGit {
  fetchRemote(cwd: string, remote: string, opts?: NetworkOptions): Promise<void>;
  pushBranch(
    cwd: string,
    remote: string,
    branch: string,
    opts?: NetworkOptions,
  ): Promise<PushOutcome>;
  resolveSha(cwd: string, rev: string): Promise<string | null>;
  isAlreadyMerged(cwd: string, source: string): Promise<boolean>;
  canFastForward(cwd: string, source: string): Promise<boolean>;
  fastForward(cwd: string, source: string): Promise<void>;
  mergeNoCommit(cwd: string, source: string): Promise<MergeOutcome>;
  commitMerge(cwd: string, message: string): Promise<string>;
  abortMerge(cwd: string): Promise<void>;
  conflictedPaths(cwd: string): Promise<string[]>;
  currentBranch(cwd: string): Promise<string | null>;
}

export const REAL_GIT: SyncGit = {
  fetchRemote: fetchRemoteAsync,
  pushBranch: pushBranchAsync,
  resolveSha: resolveShaAsync,
  isAlreadyMerged: isAlreadyMergedAsync,
  canFastForward: canFastForwardAsync,
  fastForward: fastForwardAsync,
  mergeNoCommit: mergeNoCommitAsync,
  commitMerge: commitMergeAsync,
  abortMerge: abortMergeAsync,
  conflictedPaths: conflictedPathsAsync,
  currentBranch: currentBranchAsync,
};

export interface SyncOptions {
  repoRoot: string;
  /** The remote to synchronise with, or null to work offline. */
  remote: string | null;
  /** How stale a read may let its view of the remote become. */
  pullIntervalMs: number;
  /**
   * How long a fetch or a push may take before it is stopped.
   *
   * A stopped call fails its own request with `SYNC_FAILED` and releases the
   * clone to the next one. Unset or 0 waits as long as git does, which on a
   * remote that accepts the connection and never answers can be forever.
   */
  gitTimeoutMs?: number;
  git?: SyncGit;
  now?: () => number;
  /** Where to say what happened to a call that was stopped: the log, in a server. */
  report?: (line: string) => void;
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

/**
 * A merge git would not even attempt.
 *
 * Distinct from a conflict, because the operator's move is different: nothing
 * in the tree needs resolving, something about the clone or the histories does.
 */
export function mergeRefused(upstream: string): Error {
  return apiError(`git refused to merge '${upstream}' into the server's clone`, "SYNC_FAILED", {
    details: [
      "no files conflicted, so the clone itself needs attention",
      "the server's log carries what git said",
    ],
  });
}

/** A push the remote kept refusing, with no conflict to explain it. */
export function syncPushRejected(): Error {
  return apiError(
    "the change was committed locally but the remote refused the push",
    "SYNC_PUSH_REJECTED",
    { details: ["the remote moved again during the retry; try the operation again"] },
  );
}

/**
 * A fetch or push that ran out of time and was stopped.
 *
 * Nothing needs reconciling, which is what sets it apart from a conflict: a
 * commit left behind by a stopped push is in the clone's history, and the next
 * push carries it along with whatever that request adds. Whether the stopped
 * push landed anyway is the remote's to know; either way the next one is a
 * no-op or a fast-forward, never a conflict of this request's making.
 */
export function syncTimedOut(error: GitTimeoutError, keptLocalCommit: boolean): Error {
  const call = error.args[0] === "push" ? "push" : "fetch";
  return apiError(
    `the server's ${call} did not finish within ${error.timeoutMs} ms and was stopped`,
    "SYNC_FAILED",
    {
      keptLocalCommit,
      details: keptLocalCommit
        ? [
            "the change is committed in the clone but may not have reached the remote",
            "the next mutation that pushes carries it; try again once the remote answers",
          ]
        : ["the remote is slow or unreachable; try again"],
    },
  );
}

export class RepoSync {
  private readonly lock = new Mutex();
  private readonly opts: SyncOptions;
  private readonly git: SyncGit;
  private readonly now: () => number;
  private readonly report: (line: string) => void;
  private lastFetch = Number.NEGATIVE_INFINITY;

  constructor(opts: SyncOptions) {
    this.opts = opts;
    this.git = opts.git ?? REAL_GIT;
    this.now = opts.now ?? Date.now;
    this.report = opts.report ?? (() => undefined);
  }

  /** True when there is no remote to synchronise with. */
  get localOnly(): boolean {
    return this.opts.remote === null;
  }

  /** Run a read, having brought the clone up to date first. */
  read<T>(body: () => T): Promise<T> {
    return this.lock.run(async () => {
      await this.pull({ force: false, keptLocalCommit: false });
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
    return this.lock.run(async () => {
      await this.pull({ force: true, keptLocalCommit: false });
      const result = body();
      const pushed = committed(result) ? await this.pushWithRetry() : false;
      return { result, pushed };
    });
  }

  /** Wait for in-flight work to finish, so shutdown never cuts one in half. */
  drain(): Promise<void> {
    return this.lock.drain();
  }

  /** What the calls that reach the network are told. */
  private network(): NetworkOptions {
    return this.opts.gitTimeoutMs ? { timeoutMs: this.opts.gitTimeoutMs } : {};
  }

  /**
   * What a network call that was stopped becomes: a line in the log, and a
   * `SYNC_FAILED` for the client. Anything else is passed through as it came.
   */
  private stopped(error: unknown, keptLocalCommit: boolean): unknown {
    if (!(error instanceof GitTimeoutError)) return error;
    this.report(`nav-server: ${error.message}`);
    return syncTimedOut(error, keptLocalCommit);
  }

  /**
   * Bring the clone up to date with the remote.
   *
   * A read may reuse a recent fetch — `pullIntervalMs` says how recent — because
   * asking the network on every request would make the server's latency the
   * network's. A mutation always fetches: it is about to write, and writing on a
   * stale tree is how avoidable conflicts are made.
   */
  private async pull(opts: { force: boolean; keptLocalCommit: boolean }): Promise<void> {
    const remote = this.opts.remote;
    if (remote === null) return;
    if (!opts.force && this.now() - this.lastFetch < this.opts.pullIntervalMs) return;

    try {
      await this.git.fetchRemote(this.opts.repoRoot, remote, this.network());
    } catch (error) {
      throw this.stopped(error, opts.keptLocalCommit);
    }
    this.lastFetch = this.now();
    try {
      await this.merge(remote);
    } catch (error) {
      if (error instanceof MergeConflict) throw syncConflict(error.paths, opts.keptLocalCommit);
      throw error;
    }
  }

  /** Merge the remote-tracking branch into HEAD. Throws {@link MergeConflict}. */
  private async merge(remote: string): Promise<void> {
    const root = this.opts.repoRoot;
    const branch = await this.git.currentBranch(root);
    if (branch === null) return;
    const upstream = `${remote}/${branch}`;
    // Nothing to merge: the remote has no such branch yet, or holds nothing new.
    if ((await this.git.resolveSha(root, upstream)) === null) return;
    if (await this.git.isAlreadyMerged(root, upstream)) return;

    if (await this.git.canFastForward(root, upstream)) {
      await this.git.fastForward(root, upstream);
      return;
    }
    if ((await this.git.mergeNoCommit(root, upstream)) === "conflict") {
      // "conflict" is every non-zero exit, not only a content conflict: git
      // also refuses outright over unrelated histories, a busy index, or a
      // working tree the merge would overwrite. Which it was decides what the
      // operator has to do, and only the conflicted paths tell them apart.
      const paths = await this.git.conflictedPaths(root);
      // Abort before reporting: leaving a half-merged tree behind would fail
      // every later operation for a reason unrelated to what it asked for.
      await this.git.abortMerge(root);
      if (paths.length === 0) throw mergeRefused(upstream);
      throw new MergeConflict(paths);
    }
    try {
      await this.git.commitMerge(root, `Merge remote-tracking branch '${upstream}'`);
    } catch (error) {
      // The merge is staged but uncommitted, which is the one state this
      // module must never leave behind — every later request would fail in it.
      await this.git.abortMerge(root);
      throw error;
    }
  }

  /** One push, with a stopped one reported as the commit it leaves behind. */
  private async push(root: string, remote: string, branch: string): Promise<PushOutcome> {
    try {
      return await this.git.pushBranch(root, remote, branch, this.network());
    } catch (error) {
      throw this.stopped(error, true);
    }
  }

  /**
   * Push, and on a refusal merge what arrived and push once more.
   *
   * One retry, not a loop: a second refusal means the remote is moving faster
   * than the server can win by racing it, and saying so is more useful than
   * spinning. The change is safe either way — it is in the clone's history, and
   * the error says so.
   */
  private async pushWithRetry(): Promise<boolean> {
    const remote = this.opts.remote;
    if (remote === null) return false;
    const root = this.opts.repoRoot;
    const branch = await this.git.currentBranch(root);
    if (branch === null) return false;

    if ((await this.push(root, remote, branch)) === "ok") return true;
    // Rejected: somebody pushed first. Merge what they pushed and try again —
    // and if that merge conflicts, the commit stays local, which the error says.
    await this.pull({ force: true, keptLocalCommit: true });
    if ((await this.push(root, remote, branch)) === "ok") return true;
    throw syncPushRejected();
  }
}
