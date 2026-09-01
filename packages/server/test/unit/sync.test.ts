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
  /** True when the merge would only move the branch pointer. */
  fastForwardable?: boolean;
  /** No such branch on the remote yet. */
  noUpstream?: boolean;
}

interface Recorder {
  git: SyncGit;
  calls: string[];
}

function recorder(script: Scripted = {}): Recorder {
  const calls: string[] = [];
  const next = <T>(queue: T[]): T => (queue.length > 1 ? (queue.shift() as T) : (queue[0] as T));
  const pushes = [...(script.pushes ?? ["ok"])];
  const merges = [...(script.merges ?? ["staged"])];
  const behind = [...(script.behind ?? [false])];

  const git: SyncGit = {
    fetchRemote: (_cwd, remote) => {
      calls.push(`fetch ${remote}`);
    },
    pushBranch: (_cwd, remote, branch) => {
      const outcome = next(pushes);
      calls.push(`push ${remote} ${branch} -> ${outcome}`);
      return outcome;
    },
    resolveSha: () => (script.noUpstream ? null : "a".repeat(40)),
    isAlreadyMerged: () => !next(behind),
    canFastForward: () => script.fastForwardable === true,
    fastForward: () => {
      calls.push("fast-forward");
    },
    mergeNoCommit: () => {
      const outcome = next(merges);
      calls.push(`merge -> ${outcome}`);
      return outcome;
    },
    commitMerge: () => {
      calls.push("commit-merge");
      return "b".repeat(40);
    },
    abortMerge: () => {
      calls.push("abort-merge");
    },
    conflictedPaths: () => [".navbook/issues/open/aa111111-x/issue.md"],
    currentBranch: () => "main",
  };
  return { git, calls };
}

function makeSync(script: Scripted = {}, opts: { remote?: string | null; ttl?: number } = {}) {
  const rec = recorder(script);
  let clock = 1_000_000;
  const sync = new RepoSync({
    repoRoot: ROOT,
    remote: opts.remote === undefined ? "origin" : opts.remote,
    pullIntervalMs: opts.ttl ?? 0,
    git: rec.git,
    now: () => clock,
  });
  return { sync, calls: rec.calls, advance: (ms: number) => (clock += ms) };
}

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

  it("drains, so a shutdown never cuts an operation in half", async () => {
    const { sync } = makeSync();
    let finished = false;
    void sync.write(
      () => {
        finished = true;
      },
      () => true,
    );

    await sync.drain();
    assert.equal(finished, true);
  });
});
