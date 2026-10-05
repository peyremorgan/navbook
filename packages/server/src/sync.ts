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
 *
 * Reads go further and keep off the network altogether, once {@link
 * RepoSync.start} is called: a background pull fetches every
 * `pullIntervalMs`, outside the lock, and takes the lock only to merge what
 * arrived. A read that holds the clone while a fetch crosses the network makes
 * everyone queued behind it wait for the remote, which on a deployment whose
 * fetch takes seconds was most of the time an issue page took (#esqpmn7i).
 * When the background pull is not keeping up — before its first success, or
 * after it failed or met a conflict — reads pull for themselves as they
 * otherwise would, so the freshness `pullIntervalMs` promises, and the errors a
 * read reports, are the same either way.
 */

import {
  abortMergeAsync,
  canFastForwardAsync,
  commitMergeAsync,
  conflictedPathsAsync,
  currentBranchAsync,
  fastForwardAsync,
  fetchRemoteAsync,
  GitStoppedError,
  GitTimeoutError,
  isAlreadyMergedAsync,
  type MergeOutcome,
  mergeNoCommitAsync,
  type NetworkOptions,
  type PushOptions,
  type PushOutcome,
  type PushTarget,
  pushBranchAsync,
  resolveShaAsync,
} from "@navbook/core";
import { apiError } from "./errors.ts";
import { Mutex } from "./lock.ts";

/** The git operations the engine needs, injectable so the matrix is testable. */
export interface SyncGit {
  fetchRemote(cwd: string, remote: string, opts?: NetworkOptions): Promise<void>;
  pushBranch(cwd: string, remote: string, branch: string, opts?: PushOptions): Promise<PushOutcome>;
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
  /**
   * Told as a mutation's body starts, and again if it throws: whatever it
   * leaves in the working tree, anything remembered about the tree is stale.
   * Once at the start, so the body's own reads see the files as it leaves them;
   * again on failure, because a body that throws may have written first.
   */
  onWrite?: () => void;
  /**
   * Told once git has written objects to the clone: after any fetch that
   * succeeded — a background pull's, a read's own, a mutation's — whatever
   * the merge after it made of them, and after a mutation that committed,
   * whether or not its push landed. Called synchronously, so it must return
   * at once and must not throw.
   */
  afterSync?: () => void;
}

/** What a mutation's write did, and whether the commit reached the remote. */
export interface WriteResult<T> {
  result: T;
  pushed: boolean;
}

/** Where a write happens: the clone itself, or a worktree of it on another branch. */
export interface WriteRoot {
  root: string;
  /**
   * The remote's branch that {@link root}'s checked-out branch is a copy of,
   * when the copy goes by another name; unset, it is the branch of the same
   * name. Merged from before the write and pushed to after it — under a lease,
   * so that a branch somebody deleted or moved since the fetch is refused
   * rather than written over or made again.
   */
  upstream?: string;
}

/** How a write went, as the site it ran in is told when it is closed. */
export interface WriteOutcome {
  /** True when anything threw: the merge, the body, or the push. */
  failed: boolean;
  pushed: boolean;
}

/**
 * A write made somewhere other than the clone's checked-out branch.
 *
 * {@link RepoSync.writeOn} runs it: `open` picks the site once the clone is
 * up to date, `body` writes there, and `close` is told how it went. The
 * site's branch is merged with its remote-tracking branch before the body and
 * pushed after it, by exactly the rules the clone's own branch follows.
 */
export interface WriteOn<T, S extends WriteRoot> {
  /**
   * Choose where to write. Runs under the lock, after the pull, and
   * synchronously; it may throw, and then there is nothing to close.
   */
  open(): S;
  body(site: S): T;
  /** Whether the body produced a commit: one that did not has nothing to push. */
  committed(result: T): boolean;
  /** Called once for every site `open` returned, after the push or the failure. Must not throw. */
  close(site: S, outcome: WriteOutcome): void;
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

/**
 * A branch the remote no longer has, found when pushing the copy of it a write
 * committed on.
 *
 * Refused rather than pushed: pushing would create the branch again, and the
 * server never creates one anybody would see (spec 06 §6.3). Whoever deleted
 * it may have meant to.
 */
export function syncBranchGone(branch: string, remote: string): Error {
  return apiError(`'${branch}' is no longer on '${remote}'`, "PRECONDITION", {
    branch,
    remote,
    keptLocalCommit: true,
    details: [
      "the change was committed in the server's copy of the branch but not pushed",
      "the server does not create a branch on the remote; push it again to write there",
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

/** The background pull's state while it runs. */
interface Background {
  timer: NodeJS.Timeout | null;
  inFlight: Promise<void> | null;
  stopped: boolean;
  /** Aborted by {@link RepoSync.stop}: stops the fetch in flight, and any merge not yet begun. */
  stopper: AbortController;
}

export class RepoSync {
  private readonly lock = new Mutex();
  /**
   * One network call at a time.
   *
   * The background fetch runs outside {@link lock}, so it could otherwise meet
   * a mutation's fetch or push on the way out, and two git processes updating
   * the same remote-tracking ref make one of them fail on the ref's lock file.
   * Nothing holding this ever waits for {@link lock}, so the two cannot deadlock.
   */
  private readonly net = new Mutex();
  private readonly opts: SyncOptions;
  private readonly git: SyncGit;
  private readonly now: () => number;
  private readonly report: (line: string) => void;
  private lastFetch = Number.NEGATIVE_INFINITY;
  private background: Background | null = null;
  /** How the background pull's latest attempt went; null before its first. */
  private lastRefresh: "ok" | "failed" | null = null;

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

  /** The remote this clone synchronises with, or null when it works offline. */
  get remote(): string | null {
    return this.opts.remote;
  }

  /**
   * True in code running under the clone's lock — inside `read`, `write`,
   * `writeOn`, `locked` or `exclusive`, or anything their bodies awaited.
   *
   * The lock is not re-entrant, so code that queues an operation of its own
   * asks this first: from under the lock, that operation would wait for the
   * very one holding it, and so would everything after it.
   */
  get underLock(): boolean {
    return this.lock.held;
  }

  /** Run a read, having brought the clone up to date first. */
  read<T>(body: () => T): Promise<T> {
    return this.lock.run(async () => {
      // While the background pull keeps up, the clone is already as fresh as
      // a read may ask for, and fetching again would only make it wait.
      if (this.lastRefresh !== "ok") {
        await this.pull(this.served(), { force: false, keptLocalCommit: false });
      }
      return body();
    });
  }

  /**
   * Start pulling in the background, every `pullIntervalMs`, beginning now.
   *
   * Nothing to do without a remote, or with an interval of 0: that asks for
   * every read to fetch first, which only the read itself can do.
   */
  start(): void {
    if (this.opts.remote === null || this.opts.pullIntervalMs <= 0 || this.background) return;
    this.background = {
      timer: null,
      inFlight: null,
      stopped: false,
      stopper: new AbortController(),
    };
    this.schedule(0);
  }

  /**
   * Stop the background pull, stopping its fetch if one is on the network.
   *
   * A fetch is not worth waiting for on the way out: nothing reads what it
   * brings once the server has stopped, and a slow remote could keep it going
   * past the few seconds a container is given to stop — after which it is
   * killed outright, with its ref locks still on disk for the next start to
   * trip over. Told to stop, git removes those itself. A merge already under
   * way is local and quick, and is waited for, since cutting it in half is the
   * one thing this module must never do; one not yet begun never begins.
   */
  async stop(): Promise<void> {
    const background = this.background;
    if (!background) return;
    background.stopped = true;
    if (background.timer) clearTimeout(background.timer);
    background.stopper.abort();
    await background.inFlight;
    this.background = null;
    this.lastRefresh = null;
  }

  private schedule(delayMs: number): void {
    const background = this.background;
    if (!background || background.stopped) return;
    background.timer = setTimeout(() => {
      background.timer = null;
      background.inFlight = this.refresh(background.stopper.signal).finally(() => {
        background.inFlight = null;
        // From the end of one pull to the start of the next, so a fetch
        // slower than the interval never has a second one queued behind it.
        this.schedule(this.opts.pullIntervalMs);
      });
    }, delayMs);
    // A pending pull is no reason to keep the process alive.
    background.timer.unref();
  }

  /**
   * One background pull: fetch without holding the clone, then merge under it.
   *
   * Never throws. What went wrong is the operator's to read in the log, once
   * when it starts going wrong and once when it recovers; meanwhile reads pull
   * for themselves and tell their own callers.
   *
   * `signal` is how {@link stop} ends it early: the fetch is stopped, and a
   * merge that has not begun is skipped — including one still queued for the
   * clone behind a mutation, which may finish long after the stop was asked
   * for. A pull ended that way says nothing: it failed at nobody's request.
   */
  async refresh(signal?: AbortSignal): Promise<void> {
    const remote = this.opts.remote;
    if (remote === null) return;
    // What the clone is then as fresh as: the remote as it stood when asked.
    const asked = this.now();
    try {
      await this.net.run(() =>
        this.git.fetchRemote(this.opts.repoRoot, remote, this.network(signal)),
      );
      this.opts.afterSync?.();
      await this.lock.run(() => this.merge(this.served(), remote, signal));
      if (signal?.aborted) return;
    } catch (error) {
      if (error instanceof GitStoppedError && signal?.aborted) return;
      if (this.lastRefresh !== "failed") {
        const why =
          error instanceof MergeConflict
            ? `the clone conflicts with the remote in ${error.paths.join(", ")}`
            : error instanceof Error
              ? error.message
              : String(error);
        this.report(`nav-server: background pull failed, reads will pull for themselves: ${why}`);
      }
      this.lastRefresh = "failed";
      return;
    }
    if (this.lastRefresh === "failed") this.report("nav-server: background pull recovered");
    this.lastFetch = asked;
    this.lastRefresh = "ok";
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
    return this.writeOn({
      open: () => this.served(),
      body: () => body(),
      committed,
      close: () => undefined,
    });
  }

  /**
   * Run a mutation on a site `op` chooses, between a pull and a push.
   *
   * The clone is pulled first, as for any write, so the choice is made
   * against the remote as it stands. A site in a worktree of its own is then
   * merged with its branch's remote-tracking branch — fast-forward, merge, or
   * a conflict reported and aborted — and the push after the body is of that
   * branch. That is the served branch's whole transaction, moved: spec 06 §6.3
   * gives no branch a privileged path. One thing is added: a site's push is
   * leased on the commit it merged, because a branch the server does not
   * serve is one it must never create or write over.
   */
  writeOn<T, S extends WriteRoot>(op: WriteOn<T, S>): Promise<WriteResult<T>> {
    return this.lock.run(async () => {
      await this.pull(this.served(), { force: true, keptLocalCommit: false });
      const site = op.open();
      const outcome: WriteOutcome = { failed: true, pushed: false };
      try {
        const remote = this.opts.remote;
        // The remote's tip the site was merged with: what its push is leased on.
        let merged: string | null = null;
        if (site.root !== this.opts.repoRoot && remote !== null) {
          merged = await this.mergeReporting(site, remote, false);
        }
        this.opts.onWrite?.();
        let result: T;
        try {
          result = op.body(site);
        } catch (error) {
          this.opts.onWrite?.();
          throw error;
        }
        if (op.committed(result)) {
          try {
            outcome.pushed = await this.pushWithRetry(site, merged);
          } finally {
            this.opts.afterSync?.();
          }
        }
        outcome.failed = false;
        return { result, pushed: outcome.pushed };
      } finally {
        op.close(site, outcome);
      }
    });
  }

  /**
   * Run `body` while no git of this server's can be running.
   *
   * It waits for the clone, then for the network, which is the order a
   * mutation takes them in — so the two can never wait on each other. For
   * work that must not meet another git: removing the files one left behind
   * is only safe when none is writing the same kind of file.
   */
  exclusive<T>(body: () => Promise<T> | T): Promise<T> {
    return this.lock.run(() => this.net.run(body));
  }

  /** Wait for in-flight work to finish, so shutdown never cuts one in half. */
  drain(): Promise<void> {
    return this.lock.drain();
  }

  /** The clone itself, as a site: its own branch, pushed to the same name. */
  private served(): WriteRoot {
    return { root: this.opts.repoRoot };
  }

  /** What the calls that reach the network are told. */
  private network(signal?: AbortSignal): NetworkOptions {
    return {
      ...(this.opts.gitTimeoutMs ? { timeoutMs: this.opts.gitTimeoutMs } : {}),
      ...(signal === undefined ? {} : { signal }),
    };
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
   *
   * Resolves to what {@link merge} does: the remote's tip now merged, or null
   * — including when nothing was fetched.
   */
  private async pull(
    site: WriteRoot,
    opts: { force: boolean; keptLocalCommit: boolean },
  ): Promise<string | null> {
    const remote = this.opts.remote;
    if (remote === null) return null;
    if (!opts.force && this.now() - this.lastFetch < this.opts.pullIntervalMs) return null;

    try {
      // One fetch serves every worktree: they share the clone's refs.
      await this.net.run(() => this.git.fetchRemote(this.opts.repoRoot, remote, this.network()));
    } catch (error) {
      throw this.stopped(error, opts.keptLocalCommit);
    }
    this.lastFetch = this.now();
    this.opts.afterSync?.();
    return this.mergeReporting(site, remote, opts.keptLocalCommit);
  }

  /** {@link merge}, with a conflict turned into the error a client is told. */
  private async mergeReporting(
    site: WriteRoot,
    remote: string,
    keptLocalCommit: boolean,
  ): Promise<string | null> {
    try {
      return await this.merge(site, remote);
    } catch (error) {
      if (error instanceof MergeConflict) throw syncConflict(error.paths, keptLocalCommit);
      throw error;
    }
  }

  /**
   * Merge the remote-tracking branch into the site's HEAD. Throws {@link MergeConflict}.
   *
   * Resolves to the remote's tip, which HEAD then contains, or null when the
   * remote has no such branch. The tip is read once and merged by its SHA, so
   * a fetch landing meanwhile — the background one does not wait for the
   * clone — cannot make what was merged differ from what is reported.
   *
   * Does nothing once `signal` has aborted, however far it got with looking:
   * the questions it asks first change nothing, and the last moment to decide
   * against moving the branch is just before it moves.
   */
  private async merge(
    site: WriteRoot,
    remote: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (signal?.aborted) return null;
    const root = site.root;
    const branch = site.upstream ?? (await this.git.currentBranch(root));
    if (branch === null) return null;
    const upstream = `${remote}/${branch}`;
    // Nothing to merge: the remote has no such branch yet, or holds nothing new.
    const tip = await this.git.resolveSha(root, `refs/remotes/${upstream}`);
    if (tip === null) return null;
    if (await this.git.isAlreadyMerged(root, tip)) return tip;

    const fastForward = await this.git.canFastForward(root, tip);
    if (signal?.aborted) return null;
    if (fastForward) {
      await this.git.fastForward(root, tip);
      return tip;
    }
    if ((await this.git.mergeNoCommit(root, tip)) === "conflict") {
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
    return tip;
  }

  /** One push, with a stopped one reported as the commit it leaves behind. */
  private async push(
    root: string,
    remote: string,
    branch: string,
    target: PushTarget = {},
  ): Promise<PushOutcome> {
    try {
      return await this.net.run(() =>
        this.git.pushBranch(root, remote, branch, { ...this.network(), ...target }),
      );
    } catch (error) {
      throw this.stopped(error, true);
    }
  }

  /**
   * Push a site's copy of its branch, leased on `merged`, the remote's tip it
   * contains.
   *
   * With nothing to lease on, the branch has gone from the remote since the
   * site was opened, and a push would make it again. A lease that fails —
   * the branch moved, or went, since the fetch — comes back as a rejection,
   * which {@link pushWithRetry} answers as it answers any other.
   */
  private async pushCopy(
    site: WriteRoot & { upstream: string },
    remote: string,
    branch: string,
    merged: string | null,
  ): Promise<PushOutcome> {
    if (merged === null) throw syncBranchGone(site.upstream, remote);
    return this.push(site.root, remote, branch, { to: site.upstream, expect: merged });
  }

  /**
   * Push, and on a refusal merge what arrived and push once more.
   *
   * One retry, not a loop: a second refusal means the remote is moving faster
   * than the server can win by racing it, and saying so is more useful than
   * spinning. The change is safe either way — it is in the clone's history, and
   * the error says so.
   */
  private async pushWithRetry(site: WriteRoot, merged: string | null): Promise<boolean> {
    const remote = this.opts.remote;
    if (remote === null) return false;
    const branch = await this.git.currentBranch(site.root);
    if (branch === null) return false;

    const { upstream } = site;
    if (upstream === undefined) {
      if ((await this.push(site.root, remote, branch)) === "ok") return true;
      // Rejected: somebody pushed first. Merge what they pushed and try again —
      // and if that merge conflicts, the commit stays local, which the error says.
      await this.pull(site, { force: true, keptLocalCommit: true });
      if ((await this.push(site.root, remote, branch)) === "ok") return true;
      throw syncPushRejected();
    }

    const copy = { ...site, upstream };
    if ((await this.pushCopy(copy, remote, branch, merged)) === "ok") return true;
    const again = await this.pull(site, { force: true, keptLocalCommit: true });
    if ((await this.pushCopy(copy, remote, branch, again)) === "ok") return true;
    throw syncPushRejected();
  }
}
