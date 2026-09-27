/**
 * How a request's context shares one parse of the tree.
 *
 * A root resolver that parses the tree hands it to its fields, which would
 * otherwise parse it again after the lock has let go (#esqpmn7i). What is
 * asserted is identity: the same object, not an equal one, is what proves the
 * second parse never happened.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { EntityRecord, Repo } from "@navbook/core";
import type { Config } from "../../src/config.ts";
import { makeGraphQLCtx } from "../../src/context.ts";
import { RepoSync } from "../../src/sync.ts";
import { TreeCache } from "../../src/trees.ts";
import { makeFixture } from "../helpers/temprepo.ts";

const fixture = makeFixture({ noRemote: true });
after(() => fixture.cleanup());

// One issue with a comment, so there is something for a read without comments to leave out.
fixture.server.fileIssue("Commented on", "Body.", "cmntd001");
fixture.server.write(
  ".navbook/issues/open/cmntd001-commented-on/comments/2026-08-03T141207Z-rply0001.md",
  "---\nauthor: bob@example.com\n---\n\nReproduced.\n",
);
fixture.server.commitAll("comment");

function makeCtx() {
  const config: Config = {
    repoPath: fixture.server.dir,
    port: 0,
    provider: { issuer: "https://id.invalid", jwksUrl: "https://id.invalid/keys" },
    audience: "navbook",
    policy: { requireClaims: [], allowEmailDomains: [], requireEmailVerified: false },
    remote: "origin",
    pullIntervalMs: 0,
    gitTimeoutMs: 0,
    graphiql: false,
  };
  const sync = new RepoSync({ repoRoot: fixture.server.dir, remote: null, pullIntervalMs: 0 });
  return makeGraphQLCtx({
    viewer: { name: "Reader", email: "reader@example.invalid" },
    config,
    sync,
    authors: {} as never,
    revisions: {} as never,
    trees: new TreeCache({ repoRoot: fixture.server.dir, navDir: ".navbook", intervalMs: 0 }),
    env: fixture.env,
  });
}

describe("the request's tree", () => {
  it("is the parse a root resolver made, not a second one", async () => {
    const ctx = makeCtx();
    const parsed = await ctx.sync.read(() => ctx.loadRepo("all"));
    assert.equal(await ctx.repo(), parsed);
  });

  it("is parsed on demand, once, when no root resolver made one", async () => {
    const ctx = makeCtx();
    const first = await ctx.repo();
    assert.equal(await ctx.repo(), first);
  });

  it("is parsed afresh after a write drops it", async () => {
    const ctx = makeCtx();
    const before = await ctx.sync.read(() => ctx.loadRepo("all"));
    ctx.invalidateRepo();
    assert.notEqual(await ctx.repo(), before);
  });
});

describe("an entity's comments", () => {
  const find = (repo: Repo): EntityRecord => repo.byId.get("cmntd001") as EntityRecord;

  it("are read when the tree it came from left them out", async () => {
    const ctx = makeCtx();
    const bare = find(await ctx.sync.read(() => ctx.loadRepo("none")));
    assert.deepEqual(bare.comments, []);
    const read = await ctx.commented(bare);
    assert.deepEqual(
      read.comments.map((comment) => comment.id),
      ["rply0001"],
    );
  });

  it("are read once per record, however many fields ask", async () => {
    const ctx = makeCtx();
    const bare = find(await ctx.sync.read(() => ctx.loadRepo("none")));
    assert.equal(await ctx.commented(bare), await ctx.commented(bare));
  });

  it("are not read again when the tree already had them", async () => {
    const ctx = makeCtx();
    const full = find(await ctx.sync.read(() => ctx.loadRepo("all")));
    assert.equal(await ctx.commented(full), full);
  });
});
