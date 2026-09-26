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
import type { Config } from "../../src/config.ts";
import { makeGraphQLCtx } from "../../src/context.ts";
import { RepoSync } from "../../src/sync.ts";
import { makeFixture } from "../helpers/temprepo.ts";

const fixture = makeFixture({ noRemote: true });
after(() => fixture.cleanup());

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
    env: fixture.env,
  });
}

describe("the request's tree", () => {
  it("is the parse a root resolver made, not a second one", async () => {
    const ctx = makeCtx();
    const parsed = await ctx.sync.read(() => ctx.loadRepo());
    assert.equal(await ctx.repo(), parsed);
  });

  it("is parsed on demand, once, when no root resolver made one", async () => {
    const ctx = makeCtx();
    const first = await ctx.repo();
    assert.equal(await ctx.repo(), first);
  });

  it("is parsed afresh after a write drops it", async () => {
    const ctx = makeCtx();
    const before = await ctx.sync.read(() => ctx.loadRepo());
    ctx.invalidateRepo();
    assert.notEqual(await ctx.repo(), before);
  });
});
