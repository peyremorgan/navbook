/**
 * Git's housekeeping, run by the server where a shutdown can wait for it (#cvb57nhm).
 *
 * The first test is the issue's own: a `packed-refs.lock` that a SIGKILLed
 * maintenance run left behind fails every `fetch --prune` once a branch is
 * deleted on the remote, and with it every request. The rest hold the server
 * to how it avoids leaving one: nothing detached, and a stop that waits for
 * its own run a little, then stops it whole.
 *
 * A run's length is set with a `git` on PATH that stands in for `git
 * maintenance run` and hands everything else to the real one: a real repack
 * of a fixture takes milliseconds, which is too short to stop anything in.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

const LIST = "{ issues { id title } }";
const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id } commit { pushed } }
}`;

interface OpenResult {
  openIssue: { issue: { id: string }; commit: { pushed: boolean } };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A scratch directory for what a test puts beside the fixture, removed afterwards. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "navbook-maintenance-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The real git, which the stand-in hands everything but maintenance to. */
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

/**
 * A `git` that, asked to run maintenance, writes its pid down and does `body`
 * instead; the whole group it leads is the server's run.
 */
function standIn(dir: string, body: string): { path: string; pidFile: string } {
  const pidFile = join(dir, "maintenance.pid");
  const bin = join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh
case " $* " in
  *" maintenance run "*) echo $$ > '${pidFile}'; ${body} ;;
esac
exec '${REAL_GIT}' "$@"
`,
    { mode: 0o755 },
  );
  return { path: `${bin}:${process.env.PATH ?? ""}`, pidFile };
}

async function waitFor(what: string, check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A clone whose remote-tracking refs are packed, with the lock a killed pack-refs leaves. */
function plantStaleLock(h: { fixture: Harness["fixture"] }): void {
  const { fixture } = h;
  for (const branch of ["feat/a", "fix/b"]) {
    spawnSync("git", ["-C", fixture.origin, "branch", branch, "main"], { env: fixture.env });
  }
  fixture.server.git(["fetch", "--quiet", "origin"]);
  fixture.server.git(["pack-refs", "--all"]);
  const git = join(fixture.server.dir, ".git");
  copyFileSync(join(git, "packed-refs"), join(git, "packed-refs.lock"));
}

describe("an interrupted maintenance run's leftovers", () => {
  it("are cleared at startup, so the API answers once a branch is deleted", async () => {
    const h = await startHarness({
      pullIntervalMs: 0,
      prepare: (fixture) => plantStaleLock({ fixture }),
    });
    try {
      const lock = join(h.fixture.server.dir, ".git", "packed-refs.lock");
      assert.equal(existsSync(lock), false, "the lock survived the start");
      assert.match(
        h.stderr(),
        /nav-server: removed \.git\/packed-refs\.lock \(a lock an interrupted git left behind\)/,
      );

      // A merged pull request's branch, deleted on the remote: the prune that
      // failed on the lock (#cvb57nhm) now goes through, for reads and writes.
      spawnSync("git", ["-C", h.fixture.origin, "branch", "-D", "fix/b"], { env: h.fixture.env });
      ok(await h.gql(LIST));
      const opened = ok<OpenResult>(await h.gql(OPEN, { input: { title: "After", body: "x" } }));
      assert.equal(opened.openIssue.commit.pushed, true);
      const pruned = h.fixture.server.git(["rev-parse", "--verify", "-q", "origin/fix/b"]);
      assert.notEqual(pruned.code, 0, "the deleted branch was never pruned");
    } finally {
      await h.stop();
    }
  });

  it("are only warned about when maintenance is somebody else's", async () => {
    const h = await startHarness({
      pullIntervalMs: 0,
      env: { NAV_SERVER_MAINTENANCE_INTERVAL_MS: "0" },
      prepare: (fixture) => plantStaleLock({ fixture }),
    });
    try {
      assert.ok(existsSync(join(h.fixture.server.dir, ".git", "packed-refs.lock")));
      assert.match(
        h.stderr(),
        /warning: \.git\/packed-refs\.lock \(a lock an interrupted git left behind\) is left in place/,
      );
      // Which is exactly the failure the warning is about.
      spawnSync("git", ["-C", h.fixture.origin, "branch", "-D", "fix/b"], { env: h.fixture.env });
      assert.equal(errorCode(await h.gql(LIST)), "GIT_ERROR");
    } finally {
      await h.stop();
    }
  });
});

describe("the server's own maintenance", () => {
  it("replaces git's detached one: nothing it runs in the clone detaches", async () => {
    const dir = scratch();
    const trace = join(dir, "trace.json");
    const h = await startHarness({ pullIntervalMs: 0, env: { GIT_TRACE2_EVENT: trace } });
    try {
      ok(await h.gql(OPEN, { input: { title: "Something to pack", body: "x" } }));
      const clone = realpathSync(h.fixture.server.dir);
      /** Every maintenance run started in the clone, by its arguments. */
      const inClone = (): string[][] => {
        const events = (existsSync(trace) ? readFileSync(trace, "utf8") : "")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map(
            (line) =>
              JSON.parse(line) as {
                event: string;
                sid: string;
                argv?: string[];
                worktree?: string;
              },
          );
        // Which repository each git ran in. The fixture's origin is a local
        // bare repository, whose receive-pack follows a push with its own
        // maintenance — git clears the pusher's configuration for it, and
        // it is the remote's housekeeping, not the clone's.
        const repo = new Map(
          events.filter((e) => e.event === "def_repo").map((e) => [e.sid, e.worktree]),
        );
        return events
          .filter((e) => e.event === "start" && e.argv?.includes("maintenance"))
          .filter((e) => repo.get(e.sid) === clone)
          .map((e) => e.argv as string[]);
      };
      await waitFor("the server's maintenance run", () => inClone().length > 0);

      // Git's own would be `maintenance run --auto --quiet --detach` (or
      // `--no-detach`); the server's names neither, and is the only one.
      assert.deepEqual(
        inClone().map((argv) => argv.slice(1)),
        [["-c", "gc.autoDetach=false", "maintenance", "run", "--auto", "--quiet"]],
      );
    } finally {
      await h.stop();
    }
  });

  it("is waited for by a stop, when it finishes within the budget", async () => {
    const dir = scratch();
    const git = standIn(dir, "sleep 1");
    const h = await startHarness({ pullIntervalMs: 0, env: { PATH: git.path } });
    try {
      ok(await h.gql(OPEN, { input: { title: "Something to pack", body: "x" } }));
      await waitFor("the maintenance run", () => existsSync(git.pidFile));
      const pid = Number(readFileSync(git.pidFile, "utf8"));

      const started = Date.now();
      process.kill(h.pid, "SIGTERM");
      assert.equal(await h.exited, 0);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 500, `exited after ${elapsed} ms, not waiting for the run`);
      assert.ok(elapsed < 4000, `exited after ${elapsed} ms`);
      assert.doesNotMatch(h.stderr(), /stopping git maintenance/);
      assert.equal(alive(pid), false);
    } finally {
      await h.stop();
    }
  });

  it("is stopped whole by a stop, once the budget runs out, and the server still exits cleanly", async () => {
    const dir = scratch();
    // A `sleep` in the background stands in for the repack maintenance waits on.
    const sleeper = join(dir, "sleeper.pid");
    const git = standIn(dir, `sleep 60 & echo $! > '${sleeper}'; wait; exit 0`);
    const h = await startHarness({ pullIntervalMs: 0, env: { PATH: git.path } });
    try {
      ok(await h.gql(OPEN, { input: { title: "Something to pack", body: "x" } }));
      await waitFor(
        "the maintenance run",
        () => existsSync(sleeper) && readFileSync(sleeper, "utf8").trim() !== "",
      );
      const pids = [git.pidFile, sleeper].map((file) => Number(readFileSync(file, "utf8")));

      const started = Date.now();
      process.kill(h.pid, "SIGTERM");
      assert.equal(await h.exited, 0);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 4900, `exited after ${elapsed} ms, before the budget ran out`);
      assert.ok(elapsed < 8000, `exited after ${elapsed} ms`);
      assert.match(h.stderr(), /nav-server: stopping git maintenance to shut down/);
      for (const pid of pids) assert.equal(alive(pid), false, `${pid} outlived the server`);
    } finally {
      await h.stop();
    }
  });
});
