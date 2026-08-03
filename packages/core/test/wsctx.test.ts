/**
 * The workspace context: the conformance hooks it honors, the errors it
 * raises, and the identity it acts under.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gitRun } from "../src/git/exec.ts";
import {
  currentAuthor,
  makeWsCtx,
  nowIso,
  WorkspaceError,
  wsFail,
} from "../src/workspace/index.ts";

/**
 * A directory outside any repository, so discovery has a known answer.
 *
 * The assumption that the temporary directory is not itself inside a checkout
 * is checked rather than trusted: if it ever fails, the tests below would
 * report a confusing discovery result instead of a broken environment.
 */
function outsideAnyRepo<T>(use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "navbook-wsctx-"));
  try {
    assert.equal(
      gitRun(["rev-parse", "--show-toplevel"], { cwd: dir }).code === 0,
      false,
      `${tmpdir()} is inside a git repository, so this suite cannot test discovery failure`,
    );
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ctx(env: NodeJS.ProcessEnv, dir: string) {
  return makeWsCtx({ cwd: dir, env, requireRepo: false });
}

describe("WorkspaceError", () => {
  it("carries a machine-readable code and no exit code", () => {
    const error = new WorkspaceError("not-found", "no issue matches 'abcd'");
    assert.equal(error.code, "not-found");
    assert.equal(error.name, "WorkspaceError");
    assert.deepEqual(error.details, []);
    assert.ok(!("exitCode" in error));
  });

  it("keeps the detail lines a front end may show under the message", () => {
    const error = new WorkspaceError("ambiguous", "'ab' is ambiguous", ["#abcd1234", "#abce5678"]);
    assert.deepEqual(error.details, ["#abcd1234", "#abce5678"]);
  });

  it("wsFail throws it", () => {
    assert.throws(
      () => wsFail("precondition", "#abcd1234 is already closed"),
      (error: unknown) =>
        error instanceof WorkspaceError &&
        error.code === "precondition" &&
        error.message === "#abcd1234 is already closed",
    );
  });
});

describe("makeWsCtx", () => {
  it("tolerates being outside a repository when requireRepo is false", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({}, dir);
      assert.equal(ws.hasNavbook, false);
      assert.equal(ws.navRoot, "");
    });
  });

  it("reports being outside a repository as a typed error otherwise", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => makeWsCtx({ cwd: dir, env: {} }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-a-git-repo",
      );
    });
  });

  it("fixes the clock to NAV_NOW", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({ NAV_NOW: "2026-08-04T16:40:00Z" }, dir);
      assert.equal(nowIso(ws), "2026-08-04T16:40:00Z");
      assert.equal(nowIso(ws), "2026-08-04T16:40:00Z", "the same instant on every read");
    });
  });

  it("rejects an unparseable NAV_NOW", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => ctx({ NAV_NOW: "not a date" }, dir),
        (error: unknown) => error instanceof WorkspaceError && error.code === "bad-env",
      );
    });
  });

  it("hands out NAV_IDS in order, then reports exhaustion", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({ NAV_IDS: "aaa11111, bbb22222" }, dir);
      assert.equal(ws.mintId(), "aaa11111");
      assert.equal(ws.mintId(), "bbb22222");
      assert.throws(
        () => ws.mintId(),
        (error: unknown) => error instanceof WorkspaceError && error.code === "ids-exhausted",
      );
    });
  });

  it("rejects a malformed NAV_IDS", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => ctx({ NAV_IDS: "not-an-id" }, dir),
        (error: unknown) => error instanceof WorkspaceError && error.code === "bad-env",
      );
    });
  });

  it("mints an id that avoids the ones already taken", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({}, dir);
      const first = ws.mintId();
      assert.match(first, /^[a-z][a-z0-9]{7}$/);
      assert.notEqual(ws.mintId(new Set([first])), first);
    });
  });

  it("acts under a supplied identity without consulting git", () => {
    outsideAnyRepo((dir) => {
      const ws = makeWsCtx({
        cwd: dir,
        env: {},
        requireRepo: false,
        identity: { name: "Web User", email: "web@example.com" },
      });
      assert.deepEqual(ws.identity(), { name: "Web User", email: "web@example.com" });
      assert.equal(currentAuthor(ws), "Web User <web@example.com>");
    });
  });

  it("formats an identity with no name as the bare address", () => {
    outsideAnyRepo((dir) => {
      const ws = makeWsCtx({
        cwd: dir,
        env: {},
        requireRepo: false,
        identity: { email: "web@example.com" },
      });
      assert.equal(currentAuthor(ws), "web@example.com");
    });
  });
});
