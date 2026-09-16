/**
 * The sync engine's decision matrix, driven directly.
 *
 * Every branch here is a race: a push refused between one server's pull and its
 * push, a merge that conflicts on the retry, a remote that keeps moving. None
 * of them can be provoked reliably from outside the process, which is why the
 * git calls are injected — what is asserted is the sequence of git commands the
 * engine issues, and there is no other way to pin that down.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GitTimeoutError } from "@navbook/core";
import { RepoSync, type SyncGit } from "../../src/sync.ts";

const ROOT = "/clone";

/**
 * What git says, one call at a time.
 *
 * Each sequence is taken in order and its last entry repeats, which is what
 * lets a retry see a different world from the pull that preceded it — the
 * difference the interesting branches turn on.
 */
interface Scripted {
  pushes?: ("ok" | "rejected")[];
  merges?: ("staged" | "conflict")[];
  /** Whether the remote holds something HEAD does not, per pull. */
  behind?: boolean[];
  /** Paths git reports as conflicted; empty means it refused the merge outright. */
  conflicted?: string[];
  /** Throw from commitMerge, as a rejecting hook would. */
  commitMergeFails?: boolean;
  /** True when the merge would only move the branch pointer. */
  fastForwardable?: boolean;
  /** No such branch on the remote yet. */
  noUpstream?: boolean;
  /** What the fetch raises instead of returning, as a stopped one would. */
  fetchThrows?: Error;
  /** What the push raises instead of returning. */
  pushThrows?: Error;
  /** Hold every push until this resolves, so something can be queued behind it. */
  pushGate?: Promise<void>;
}

interface Recorder {
  git: SyncGit;
  calls: string[];
  /** The timeout each network call was given, in the order they were made. */
  timeouts: (number | undefined)[];
}

function recorder(script: Scripted = {}): Recorder {
  const calls: string[] = [];
  const timeouts: (number | undefined)[] = [];
  const next = <T>(queue: T[]): T => (queue.length > 1 ? (queue.shift() as T) : (queue[0] as T));
  const pushes = [...(script.pushes ?? ["ok"])];
  const merges = [...(script.merges ?? ["staged"])];
  const behind = [...(script.behind ?? [false])];

  const git: SyncGit = {
    fetchRemote: async (_cwd, remote, opts) => {
      timeouts.push(opts?.timeoutMs);
      calls.push(`fetch ${remote}`);
      if (script.fetchThrows) throw script.fetchThrows;
    },
    pushBranch: async (_cwd, remote, branch, opts) => {
      timeouts.push(opts?.timeoutMs);
      await script.pushGate;
      if (script.pushThrows) {
        calls.push(`push ${remote} ${branch} -> stopped`);
        throw script.pushThrows;
      }
      const outcome = next(pushes);
      calls.push(`push ${remote} ${branch} -> ${outcome}`);
      return outcome;
    },
    resolveSha: async () => (script.noUpstream ? null : "a".repeat(40)),
    isAlreadyMerged: async () => !next(behind),
    canFastForward: async () => script.fastForwardable === true,
    fastForward: async () => {
      calls.push("fast-forward");
    },
    mergeNoCommit: async () => {
      const outcome = next(merges);
      calls.push(`merge -> ${outcome}`);
      return outcome;
    },
    commitMerge: async () => {
      calls.push("commit-merge");
      if (script.commitMergeFails) throw new Error("hook refused the merge commit");
      return "b".repeat(40);
    },
    abortMerge: async () => {
      calls.push("abort-merge");
    },
    conflictedPaths: async () => script.conflicted ?? [".navbook/issues/open/aa111111-x/issue.md"],
    currentBranch: async () => "main",
  };
  return { git, calls, timeouts };
}

function makeSync(
  script: Scripted = {},
  opts: { remote?: string | null; ttl?: number; timeout?: number } = {},
) {
  const rec = recorder(script);
  const reported: string[] = [];
  let clock = 1_000_000;
  const sync = new RepoSync({
    repoRoot: ROOT,
    remote: opts.remote === undefined ? "origin" : opts.remote,
    pullIntervalMs: opts.ttl ?? 0,
    ...(opts.timeout === undefined ? {} : { gitTimeoutMs: opts.timeout }),
    git: rec.git,
    now: () => clock,
    report: (line) => {
      reported.push(line);
    },
  });
  return {
    sync,
    calls: rec.calls,
    timeouts: rec.timeouts,
    reported,
    advance: (ms: number) => (clock += ms),
  };
}

/** A push that will not return until the test says so. */
function gate(): { open: () => void; closed: Promise<void> } {
  let open: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
}

/** Enough turns of the event loop for anything that is going to run to have run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** The extensions of a thrown API error, for asserting on its code. */
function extensionsOf(error: unknown): Record<string, unknown> {
  const value = (error as { extensions?: Record<string, unknown> }).extensions;
  return value ?? {};
}

describe("RepoSync.read", () => {
  it("fetches before reading, and returns what the body produced", async () => {
    const { sync, calls } = makeSync();
    assert.equal(await sync.read(() => "answer"), "answer");
    assert.deepEqual(calls, ["fetch origin"]);
  });

  it("does nothing when the remote branch does not exist yet", async () => {
    const { sync, calls } = makeSync({ noUpstream: true, behind: [true] });
    await sync.read(() => undefined);
    assert.deepEqual(calls, ["fetch origin"]);
  });

  it("fast-forwards when the remote is simply ahead", async () => {
    const { sync, calls } = makeSync({ behind: [true], fastForwardable: true });
    await sync.read(() => undefined);
    assert.deepEqual(calls, ["fetch origin", "fast-forward"]);
  });

  it("makes a merge commit when the histories diverged", async () => {
    const { sync, calls } = makeSync({ behind: [true], fastForwardable: false });
    await sync.read(() => undefined);
    assert.deepEqual(calls, ["fetch origin", "merge -> staged", "commit-merge"]);
  });

  it("aborts a conflicting merge and reports it, without running the body", async () => {
    const { sync, calls } = makeSync({ behind: [true], merges: ["conflict"] });
    let ran = false;

    await assert.rejects(
      sync.read(() => {
        ran = true;
      }),
      (error: unknown) => {
        const extensions = extensionsOf(error);
        assert.equal(extensions.code, "SYNC_CONFLICT");
        // Nothing was written, so nothing was left behind.
        assert.equal(extensions.keptLocalCommit, false);
        assert.deepEqual(extensions.paths, [".navbook/issues/open/aa111111-x/issue.md"]);
        return true;
      },
    );

    assert.equal(ran, false);
    // Aborted, so the next operation does not inherit a half-merged tree.
    assert.deepEqual(calls, ["fetch origin", "merge -> conflict", "abort-merge"]);
  });

  it("tells a merge git refused apart from one that conflicted", async () => {
    // `git merge` exits non-zero for unrelated histories, a busy index, or a
    // working tree it would overwrite — none of which is a conflict, and none
    // of which an operator fixes by resolving files.
    const { sync, calls } = makeSync({ behind: [true], merges: ["conflict"], conflicted: [] });

    await assert.rejects(
      sync.read(() => undefined),
      (error: unknown) => {
        assert.equal(extensionsOf(error).code, "SYNC_FAILED");
        return true;
      },
    );
    assert.deepEqual(calls, ["fetch origin", "merge -> conflict", "abort-merge"]);
  });

  it("abandons a merge it staged but could not commit", async () => {
    // Staged-but-uncommitted is the one state that would fail every later
    // request, so it must not survive the failure that produced it.
    const { sync, calls } = makeSync({
      behind: [true],
      merges: ["staged"],
      commitMergeFails: true,
    });

    await assert.rejects(
      sync.read(() => undefined),
      /hook refused the merge commit/,
    );
    assert.deepEqual(calls, ["fetch origin", "merge -> staged", "commit-merge", "abort-merge"]);
  });

  it("reuses a recent fetch, and fetches again once it is stale", async () => {
    const { sync, calls, advance } = makeSync({}, { ttl: 10_000 });
    await sync.read(() => undefined);
    await sync.read(() => undefined);
    assert.deepEqual(calls, ["fetch origin"]);

    advance(10_001);
    await sync.read(() => undefined);
    assert.deepEqual(calls, ["fetch origin", "fetch origin"]);
  });

  it("never touches the network without a remote", async () => {
    const { sync, calls } = makeSync({}, { remote: null });
    assert.equal(await sync.read(() => "offline"), "offline");
    assert.deepEqual(calls, []);
  });
});

describe("RepoSync.write", () => {
  const committed = () => true;

  it("pulls, runs the body, and pushes", async () => {
    const { sync, calls } = makeSync();
    const { result, pushed } = await sync.write(() => "done", committed);
    assert.equal(result, "done");
    assert.equal(pushed, true);
    assert.deepEqual(calls, ["fetch origin", "push origin main -> ok"]);
  });

  it("always fetches, however recent the last one was", async () => {
    const { sync, calls } = makeSync({}, { ttl: 10_000 });
    await sync.read(() => undefined);
    await sync.write(() => undefined, committed);
    // Two fetches: a write must not plan against a tree it knows is stale.
    assert.deepEqual(calls, ["fetch origin", "fetch origin", "push origin main -> ok"]);
  });

  it("does not push when the operation committed nothing", async () => {
    const { sync, calls } = makeSync();
    const { pushed } = await sync.write(
      () => "no-op",
      () => false,
    );
    assert.equal(pushed, false);
    assert.deepEqual(calls, ["fetch origin"]);
  });

  it("merges what arrived and pushes again when the first push is refused", async () => {
    const { sync, calls } = makeSync({
      pushes: ["rejected", "ok"],
      behind: [false, true],
      fastForwardable: true,
    });
    const { pushed } = await sync.write(() => undefined, committed);
    assert.equal(pushed, true);
    assert.deepEqual(calls, [
      "fetch origin",
      "push origin main -> rejected",
      "fetch origin",
      "fast-forward",
      "push origin main -> ok",
    ]);
  });

  it("keeps the local commit and says so when the retry's merge conflicts", async () => {
    const { sync, calls } = makeSync({
      pushes: ["rejected"],
      behind: [false, true],
      merges: ["conflict"],
    });

    await assert.rejects(
      sync.write(() => undefined, committed),
      (error: unknown) => {
        const extensions = extensionsOf(error);
        assert.equal(extensions.code, "SYNC_CONFLICT");
        // The change was committed before the push was tried, so it is still
        // in the clone's history — and the client is told exactly that.
        assert.equal(extensions.keptLocalCommit, true);
        return true;
      },
    );
    assert.deepEqual(calls, [
      "fetch origin",
      "push origin main -> rejected",
      "fetch origin",
      "merge -> conflict",
      "abort-merge",
    ]);
  });

  it("gives up after one retry when the remote keeps moving", async () => {
    const { sync, calls } = makeSync({
      pushes: ["rejected"],
      behind: [false, true],
      fastForwardable: true,
    });

    await assert.rejects(
      sync.write(() => undefined, committed),
      (error: unknown) => {
        assert.equal(extensionsOf(error).code, "SYNC_PUSH_REJECTED");
        return true;
      },
    );
    // One retry, not a loop.
    assert.equal(calls.filter((call) => call.startsWith("push")).length, 2);
  });

  it("commits without pushing when there is no remote", async () => {
    const { sync, calls } = makeSync({}, { remote: null });
    const { pushed } = await sync.write(() => "local", committed);
    assert.equal(pushed, false);
    assert.deepEqual(calls, []);
  });
});

describe("RepoSync ordering", () => {
  it("runs operations one at a time, in the order they arrived", async () => {
    const { sync } = makeSync();
    const order: string[] = [];

    const slow = sync.write(
      () => {
        order.push("first");
        return 1;
      },
      () => true,
    );
    const fast = sync.read(() => {
      order.push("second");
      return 2;
    });

    await Promise.all([slow, fast]);
    assert.deepEqual(order, ["first", "second"]);
  });

  it("lets the queue continue after an operation fails", async () => {
    const { sync } = makeSync();
    await assert.rejects(
      sync.read(() => {
        throw new Error("boom");
      }),
    );
    // A rejection is the caller's; whoever is queued behind must still run.
    assert.equal(await sync.read(() => "after"), "after");
  });

  it("holds the tree still while a push is in flight, and runs the read after it", async () => {
    // The case the lock exists for: the write's body has run and its push is
    // out on the network, and a read arrives. Nothing may touch the tree until
    // the push has returned — the read runs after, not in the gap.
    const push = gate();
    const { sync, calls } = makeSync({ pushGate: push.closed });
    const order: string[] = [];

    const write = sync.write(
      () => {
        order.push("write");
        return 1;
      },
      () => true,
    );
    const read = sync.read(() => {
      order.push("read");
      return 2;
    });

    await settle();
    assert.deepEqual(order, ["write"]);
    assert.deepEqual(calls, ["fetch origin"]);

    push.open();
    await Promise.all([write, read]);
    assert.deepEqual(order, ["write", "read"]);
    assert.deepEqual(calls, ["fetch origin", "push origin main -> ok", "fetch origin"]);
  });

  it("drains, so a shutdown never cuts an operation in half", async () => {
    const push = gate();
    const { sync, calls } = makeSync({ pushGate: push.closed });
    let finished = false;
    void sync.write(
      () => undefined,
      () => true,
    );

    // The write is between its commit and its push: the one moment the
    // clone's state depends on finishing.
    const drained = sync.drain().then(() => {
      finished = true;
    });
    await settle();
    assert.equal(finished, false);

    push.open();
    await drained;
    assert.deepEqual(calls, ["fetch origin", "push origin main -> ok"]);
  });
});

describe("RepoSync timeouts", () => {
  const committed = () => true;
  const stoppedFetch = new GitTimeoutError(["fetch", "--quiet", "--prune", "origin"], 500);
  const stoppedPush = new GitTimeoutError(["push", "--quiet", "origin", "main:main"], 500);

  it("gives the network calls the timeout, and only when one is configured", async () => {
    const { sync, timeouts } = makeSync({}, { timeout: 500 });
    await sync.write(() => undefined, committed);
    assert.deepEqual(timeouts, [500, 500]);

    const unbounded = makeSync({}, { timeout: 0 });
    await unbounded.sync.write(() => undefined, committed);
    assert.deepEqual(unbounded.timeouts, [undefined, undefined]);
  });

  it("fails the request whose fetch was stopped, having written nothing", async () => {
    const { sync, reported } = makeSync({ fetchThrows: stoppedFetch }, { timeout: 500 });
    let ran = false;

    await assert.rejects(
      sync.write(() => {
        ran = true;
      }, committed),
      (error: unknown) => {
        const extensions = extensionsOf(error);
        assert.equal(extensions.code, "SYNC_FAILED");
        assert.equal(extensions.keptLocalCommit, false);
        assert.match((error as Error).message, /fetch did not finish within 500 ms/);
        return true;
      },
    );
    assert.equal(ran, false);
    // The operator hears about it too, with what git was running.
    assert.equal(reported.length, 1);
    assert.match(reported[0] as string, /git fetch --quiet --prune origin/);
  });

  it("keeps the commit whose push was stopped, and says so", async () => {
    const { sync, calls } = makeSync({ pushThrows: stoppedPush }, { timeout: 500 });

    await assert.rejects(
      sync.write(() => undefined, committed),
      (error: unknown) => {
        const extensions = extensionsOf(error);
        assert.equal(extensions.code, "SYNC_FAILED");
        // Committed before the push was tried, so it is in the clone's history
        // and the next push carries it — nothing for an operator to do.
        assert.equal(extensions.keptLocalCommit, true);
        assert.match((error as Error).message, /push did not finish within 500 ms/);
        return true;
      },
    );
    // Stopped once, not retried: a retry would only wait the timeout out again.
    assert.deepEqual(calls, ["fetch origin", "push origin main -> stopped"]);
  });

  it("hands the clone to the next operation once a call is stopped", async () => {
    const { sync } = makeSync({ fetchThrows: stoppedFetch }, { timeout: 500 });
    await assert.rejects(sync.read(() => undefined));
    // Offline work is unaffected by a remote that stopped answering.
    assert.equal(await sync.locked(() => "still here"), "still here");
  });
});
