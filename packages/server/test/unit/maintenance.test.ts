/**
 * The server's own housekeeping: when it runs, how it is stopped, what it says.
 *
 * The run is injected, as the sync engine's git is: a cooldown, a run that
 * outlives its welcome and a shutdown mid-run are timings, and there is no
 * reliable way to make a real repack take exactly as long as a test needs.
 * One test at the end runs the real command, to hold its arguments to git.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { type GitResult, GitStoppedError, GitTimeoutError } from "@navbook/core";
import { MAINTENANCE_ARGS, Maintenance, type MaintenanceOptions } from "../../src/maintenance.ts";

const OK: GitResult = { code: 0, stdout: "", stderr: "" };

/** Where the wall clock stands against the monotonic one: anywhere else. */
const WALL_OFFSET = 1_700_000_000_000;

/** A run that finishes when the test says, or when it is stopped. */
interface PendingRun {
  signal: AbortSignal;
  timeoutMs: number;
  finish(result?: GitResult): void;
  fail(error: Error): void;
}

function harness(opts: Partial<MaintenanceOptions> = {}) {
  let clock = 1_000_000;
  const runs: PendingRun[] = [];
  const reported: string[] = [];
  const tidied: number[] = [];
  const maintenance = new Maintenance({
    repoRoot: "/clone",
    intervalMs: 60_000,
    now: () => clock,
    wallClock: () => clock + WALL_OFFSET,
    report: (line) => reported.push(line),
    run: ({ signal, timeoutMs }) =>
      new Promise<GitResult>((resolve, reject) => {
        const run: PendingRun = {
          signal,
          timeoutMs,
          finish: (result = OK) => resolve(result),
          fail: reject,
        };
        // As gitRunAsync does: an abort stops the run and rejects it.
        signal.addEventListener("abort", () => reject(new GitStoppedError(["maintenance"])), {
          once: true,
        });
        runs.push(run);
      }),
    tidy: async (since) => {
      tidied.push(since);
    },
    stopBudgetMs: 200,
    ...opts,
  });
  return {
    maintenance,
    runs,
    reported,
    tidied,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

/** Enough turns of the event loop for anything that is going to run to have run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("Maintenance.request", () => {
  it("runs at once the first time, with the run limit", async () => {
    const { maintenance, runs } = harness();
    maintenance.request();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.timeoutMs, 30 * 60_000);
    runs[0]?.finish();
    await settle();
  });

  it("drops a request while a run is going, however long ago it started", async () => {
    const { maintenance, runs, advance } = harness();
    maintenance.request();
    advance(10 * 60_000);
    maintenance.request();
    assert.equal(runs.length, 1);
    runs[0]?.finish();
    await settle();
    // Over, and the interval long past: the next request runs.
    maintenance.request();
    assert.equal(runs.length, 2);
    runs[1]?.finish();
    await settle();
  });

  it("drops a request within the interval of the last run's start", async () => {
    const { maintenance, runs, advance } = harness({ intervalMs: 60_000 });
    maintenance.request();
    advance(40_000);
    runs[0]?.finish();
    await settle();
    advance(19_999);
    maintenance.request();
    assert.equal(runs.length, 1, "59.999 s after the last start is too soon");
    advance(1);
    maintenance.request();
    assert.equal(runs.length, 2, "60 s after the last start is not");
    runs[1]?.finish();
    await settle();
  });

  it("keeps to the interval by a clock that only moves forward", async () => {
    // The wall clock set back an hour between two runs: by it, the second
    // would be an hour early; by the time that passed, it is due.
    let wall = WALL_OFFSET;
    const { maintenance, runs, advance } = harness({ wallClock: () => wall });
    maintenance.request();
    runs[0]?.finish();
    await settle();
    advance(60_000);
    wall -= 60 * 60_000;
    maintenance.request();
    assert.equal(runs.length, 2);
    runs[1]?.finish();
    await settle();
  });

  it("never runs with an interval of 0", () => {
    const { maintenance, runs } = harness({ intervalMs: 0 });
    assert.equal(maintenance.enabled, false);
    maintenance.request();
    assert.equal(runs.length, 0);
  });
});

describe("Maintenance reporting", () => {
  it("says a failing run once, and says when it recovers", async () => {
    const { maintenance, runs, reported, advance } = harness();
    for (const result of [
      { code: 1, stdout: "", stderr: "error: could not write commit-graph\n" },
      { code: 1, stdout: "", stderr: "error: could not write commit-graph\n" },
      OK,
      OK,
    ]) {
      maintenance.request();
      runs.at(-1)?.finish(result);
      await settle();
      advance(60_000);
    }
    assert.deepEqual(reported, [
      "nav-server: git maintenance failed (exit 1): error: could not write commit-graph",
      "nav-server: git maintenance recovered",
    ]);
  });

  it("says a failing streak once, whatever each run failed of", async () => {
    const { maintenance, runs, reported, tidied, advance } = harness();
    const failures: ((run: PendingRun) => void)[] = [
      (run) => run.fail(new Error("git was not found on PATH")),
      (run) => run.fail(new Error("git was not found on PATH")),
      (run) => run.fail(new GitTimeoutError(["maintenance"], 30 * 60_000)),
      (run) => run.finish({ code: 128, stdout: "", stderr: "fatal: bad object\n" }),
      (run) => run.finish(),
      (run) => run.fail(new GitTimeoutError(["maintenance"], 30 * 60_000)),
    ];
    for (const fail of failures) {
      maintenance.request();
      fail(runs.at(-1) as PendingRun);
      await settle();
      advance(60_000);
    }
    assert.equal(runs.length, failures.length, "a failure never stops the next run");
    assert.deepEqual(reported, [
      "nav-server: git maintenance could not run: git was not found on PATH",
      "nav-server: git maintenance recovered",
      "nav-server: git maintenance ran past 1800000 ms and was stopped",
    ]);
    // Every run that ran out of time is cleared up after, said or not.
    assert.equal(tidied.length, 2);
  });

  it("clears up after a run that ran out of time, from when it started", async () => {
    const { maintenance, runs, reported, tidied, advance, now } = harness();
    // As file times read it: the wall clock, not the one the interval runs on.
    const started = now() + WALL_OFFSET;
    maintenance.request();
    advance(30 * 60_000);
    runs[0]?.fail(new GitTimeoutError(["maintenance"], 30 * 60_000));
    await settle();
    assert.deepEqual(tidied, [started]);
    assert.deepEqual(reported, ["nav-server: git maintenance ran past 1800000 ms and was stopped"]);
  });

  it("says so when clearing up fails, and does not throw", async () => {
    const { maintenance, runs, reported } = harness({
      tidy: async () => {
        throw new Error("EACCES");
      },
    });
    maintenance.request();
    runs[0]?.fail(new GitTimeoutError(["maintenance"], 30 * 60_000));
    await settle();
    assert.equal(reported.at(-1), "nav-server: could not clear up after git maintenance: EACCES");
  });
});

describe("Maintenance.stop", () => {
  it("returns at once when nothing is running", async () => {
    const { maintenance } = harness();
    const started = Date.now();
    await maintenance.stop();
    assert.ok(Date.now() - started < 100);
  });

  it("waits for a run that finishes within the budget, and stops nothing", async () => {
    const { maintenance, runs, reported, tidied } = harness({ stopBudgetMs: 1000 });
    maintenance.request();
    const stopped = maintenance.stop();
    setTimeout(() => runs[0]?.finish(), 50);
    await stopped;
    assert.equal(runs[0]?.signal.aborted, false);
    assert.deepEqual(reported, []);
    assert.deepEqual(tidied, []);
  });

  it("stops a run that outlasts the budget, and leaves clearing up to the next start", async () => {
    const { maintenance, runs, reported, tidied } = harness({ stopBudgetMs: 100 });
    maintenance.request();
    const started = Date.now();
    await maintenance.stop();
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 90 && elapsed < 1000, `stopped after ${elapsed} ms`);
    assert.equal(runs[0]?.signal.aborted, true);
    assert.deepEqual(reported, ["nav-server: stopping git maintenance to shut down"]);
    assert.deepEqual(tidied, [], "a shutdown must not race whatever else is still finishing");
  });

  it("starts nothing once stopping has begun", async () => {
    const { maintenance, runs, advance } = harness();
    await maintenance.stop();
    advance(60 * 60_000);
    maintenance.request();
    assert.equal(runs.length, 0);
  });
});

describe("Maintenance against git", () => {
  it("packs what it finds, in the foreground, whatever git would otherwise do", async () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-maintenance-"));
    // Configuration as the server's own git sees it: auto maintenance off,
    // and detaching on, which the run has to override to stay a child.
    const env = {
      ...process.env,
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "maintenance.auto",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "maintenance.autoDetach",
      GIT_CONFIG_VALUE_1: "true",
      GIT_CONFIG_KEY_2: "gc.autoDetach",
      GIT_CONFIG_VALUE_2: "true",
    };
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    try {
      git("init", "--quiet", "-b", "main");
      mkdirSync(join(dir, "files"));
      // Enough that git's estimate — it samples one of the 256 object
      // directories — clears its threshold whichever it samples.
      for (let i = 0; i < 3000; i++) writeFileSync(join(dir, "files", String(i)), `blob ${i}\n`);
      git("add", "files");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "many");
      const loose = (): number => Number(git("count-objects").stdout.split(" ")[0]);
      assert.ok(loose() > 3000, "the commit left its objects loose");

      const saved = { ...process.env };
      Object.assign(process.env, env);
      try {
        const maintenance = new Maintenance({ repoRoot: dir, intervalMs: 1 });
        maintenance.request();
        await maintenance.stop();
      } finally {
        for (const key of Object.keys(env)) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
      // Waited for, not detached: by the time stop() returns, it is packed.
      assert.equal(loose(), 0);
      assert.deepEqual(MAINTENANCE_ARGS.slice(2), ["maintenance", "run", "--auto", "--quiet"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
