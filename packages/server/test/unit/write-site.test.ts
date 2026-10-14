/**
 * Opening and closing the temporary worktree a write on another branch runs in.
 *
 * Driven directly rather than through a request, because what is asserted is
 * what happens when tidying up goes wrong — a worktree git will not remove, a
 * directory that cannot be made — and nothing a client sends provokes either.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeWsCtx } from "@navbook/core";
import type { GraphQLCtx } from "../../src/context.ts";
import {
  closeWriteSite,
  openWriteSite,
  sweepTemporaryWorktrees,
  type WriteSite,
} from "../../src/write-site.ts";
import { type Fixture, makeFixture, real, worktrees } from "../helpers/temprepo.ts";

/** A git call that has to work, for arranging a fixture. */
function must(result: { code: number; stderr: string }): void {
  assert.equal(result.code, 0, result.stderr);
}

describe("a write site on another branch", () => {
  let fixture: Fixture;
  const reported: string[] = [];
  let ctx: GraphQLCtx;

  before(() => {
    fixture = makeFixture();
    // As much of a request's context as the site reads: the clone and its
    // marker, which remote it pushes to, and where to say what went wrong.
    ctx = {
      ws: makeWsCtx({ cwd: fixture.server.dir, env: fixture.env }),
      sync: { remote: "origin" },
      report: (line: string) => reported.push(line),
    } as unknown as GraphQLCtx;
  });

  after(() => {
    fixture.cleanup();
  });

  function pushed(name: string): void {
    fixture.peer.branch(name);
    must(fixture.peer.git(["push", "--quiet", "origin", `${name}:${name}`]));
    must(fixture.server.git(["fetch", "--quiet", "origin"]));
  }

  const copy = (name: string): string =>
    fixture.server.git(["branch", "--list", `nav-server/${name}`]).stdout.trim();

  /**
   * Make the worktree at `site` one git will not remove, and say how to undo it.
   *
   * Locked, as an operator might lock it: git then refuses `worktree remove`
   * and `worktree prune` alike, so it stays registered — on the copy — even
   * once its directory has been deleted.
   */
  function wedge(site: WriteSite): () => void {
    must(fixture.server.git(["worktree", "lock", site.root]));
    return () => must(fixture.server.git(["worktree", "unlock", site.root]));
  }

  it("keeps the copy while its worktree could not be removed, and takes it over next time", () => {
    pushed("wedged");
    const site = openWriteSite(ctx, "wedged");
    assert.equal(site.local, "nav-server/wedged");
    const unwedge = wedge(site);

    reported.length = 0;
    closeWriteSite(ctx, site, ctx.report);
    // The worktree still stands on the copy, so the copy stays.
    assert.match(reported.join("\n"), /could not remove the temporary worktree/);
    assert.notEqual(copy("wedged"), "");
    assert.ok(worktrees(fixture.server.dir).includes(real(site.root)));

    // Whatever wedged it is cleared; the next write is not refused over it.
    unwedge();
    const again = openWriteSite(ctx, "wedged");
    closeWriteSite(ctx, again, ctx.report);
    assert.deepEqual(worktrees(fixture.server.dir), [real(fixture.server.dir)]);
    assert.equal(copy("wedged"), "");
  });

  it("takes away the copy it made when the worktree cannot be made", () => {
    pushed("no-room");
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = join(fixture.home, "does-not-exist");
    try {
      assert.throws(() => openWriteSite(ctx, "no-room"), /ENOENT/);
    } finally {
      // Unset is not the same as `undefined`: assigned, that is the string
      // "undefined", and every later `tmpdir()` in this process lands there.
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    assert.equal(copy("no-room"), "");
    assert.deepEqual(worktrees(fixture.server.dir), [real(fixture.server.dir)]);
  });

  it("refuses a name git would not take for a branch as bad input", () => {
    assert.throws(
      () => openWriteSite(ctx, "a..b"),
      (error: unknown) =>
        (error as { extensions?: { code?: string } }).extensions?.code === "INVALID_INPUT",
    );
  });

  it("says a leftover it could not remove was not removed", () => {
    pushed("left");
    const site = openWriteSite(ctx, "left");
    const unwedge = wedge(site);
    try {
      reported.length = 0;
      sweepTemporaryWorktrees(fixture.server.dir, ctx.report);
      assert.match(reported.join("\n"), /could not remove the temporary worktree/);
      assert.doesNotMatch(reported.join("\n"), /removed a temporary worktree/);
      assert.ok(worktrees(fixture.server.dir).includes(real(site.root)));
    } finally {
      unwedge();
      closeWriteSite(ctx, site, ctx.report);
    }
    assert.deepEqual(worktrees(fixture.server.dir), [real(fixture.server.dir)]);
  });

  /** Set the served clone's marker for `body`, as an operator editing it would, then restore it. */
  function withMarker(text: string, body: () => void): void {
    const file = join(fixture.server.dir, ".navbook", "navbook.json");
    const saved = readFileSync(file, "utf8");
    writeFileSync(file, text);
    try {
      body();
    } finally {
      writeFileSync(file, saved);
    }
  }

  it("checks out the Navbook directory and the files at the root, and nothing else", () => {
    pushed("sparse");
    const site = openWriteSite(ctx, "sparse");
    const patterns = (dir: string): string =>
      fixture.server
        .git([
          "-C",
          dir,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "info/sparse-checkout",
        ])
        .stdout.trim();
    const own = patterns(site.root);
    try {
      assert.ok(existsSync(join(site.root, ".navbook", "navbook.json")));
      // The branch's own commit, a file at the root.
      assert.ok(existsSync(join(site.root, "sparse.txt")));
      assert.equal(existsSync(join(site.root, "src")), false);
      assert.equal(fixture.server.git(["-C", site.root, "status", "--porcelain"]).stdout, "");
      assert.ok(existsSync(own));
      // Nothing of it in the clone's own config, or in its own git directory.
      assert.doesNotMatch(
        fixture.server.git(["config", "--list", "--local"]).stdout,
        /sparse|worktreeconfig/i,
      );
      assert.equal(existsSync(patterns(fixture.server.dir)), false);
    } finally {
      closeWriteSite(ctx, site, ctx.report);
    }
    assert.equal(existsSync(own), false);
    assert.deepEqual(worktrees(fixture.server.dir), [fixture.server.dir]);
  });

  it("checks out everything when the served clone's marker says so, without a restart", () => {
    pushed("whole");
    withMarker('{ "version": 1, "worktrees": { "sparse": false } }\n', () => {
      const site = openWriteSite(ctx, "whole");
      try {
        assert.ok(existsSync(join(site.root, "src", "deep", "code.ts")));
      } finally {
        closeWriteSite(ctx, site, ctx.report);
      }
    });
    const site = openWriteSite(ctx, "whole");
    try {
      assert.equal(existsSync(join(site.root, "src")), false);
    } finally {
      closeWriteSite(ctx, site, ctx.report);
    }
  });

  it("logs a policy it cannot read once, and stays sparse", () => {
    pushed("garbled");
    reported.length = 0;
    withMarker('{ "version": 1, "worktrees": { "sparse": "no" } }\n', () => {
      for (let write = 0; write < 2; write++) {
        const site = openWriteSite(ctx, "garbled");
        try {
          assert.equal(existsSync(join(site.root, "src")), false);
        } finally {
          closeWriteSite(ctx, site, ctx.report);
        }
      }
    });
    assert.deepEqual(
      reported.filter((line) => line.includes("worktrees")),
      [
        "nav-server: warning: .navbook/navbook.json: 'worktrees.sparse' must be true or false; using the default",
      ],
    );
  });
});
