/**
 * When the remembered tree is reused, and when it is parsed again.
 *
 * The parse, HEAD and the watchdog's question are injected, so what is
 * asserted is how many parses happen and which tree each caller is handed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommentScope, Repo, WsCtx } from "@navbook/core";
import { TreeCache } from "../../src/trees.ts";

const WS = { repoRoot: "/clone" } as WsCtx;

function makeCache(
  world: { sha: string | null; edited?: boolean; blind?: boolean },
  intervalMs = 1000,
) {
  const parses: CommentScope[] = [];
  const reported: string[] = [];
  const cache = new TreeCache({
    repoRoot: "/clone",
    navDir: ".navbook",
    intervalMs,
    load: (_ws, scope) => {
      parses.push(scope);
      return { scope } as unknown as Repo;
    },
    head: () => world.sha,
    changed: async () => {
      if (world.blind) throw new Error("git is not there");
      return world.edited === true;
    },
    report: (line) => {
      reported.push(line);
    },
  });
  return { cache, parses, reported };
}

describe("TreeCache", () => {
  it("parses once per commit, and hands every caller that parse", () => {
    const { cache, parses } = makeCache({ sha: "a".repeat(40) });
    const first = cache.at(WS, "none");
    assert.equal(cache.at(WS, "none"), first);
    assert.deepEqual(parses, ["none"]);
  });

  it("parses again once HEAD has moved", () => {
    const world = { sha: "a".repeat(40) };
    const { cache, parses } = makeCache(world);
    const before = cache.at(WS, "all");
    world.sha = "b".repeat(40);
    assert.notEqual(cache.at(WS, "all"), before);
    assert.deepEqual(parses, ["all", "all"]);
  });

  it("serves a request for fewer comments from a tree read with more", () => {
    const { cache, parses } = makeCache({ sha: "a".repeat(40) });
    const all = cache.at(WS, "all");
    assert.equal(cache.at(WS, "none"), all);
    assert.equal(cache.at(WS, "prs"), all);
    assert.deepEqual(parses, ["all"]);
  });

  it("never serves a request for more comments from a tree read with fewer", () => {
    const { cache, parses } = makeCache({ sha: "a".repeat(40) });
    cache.at(WS, "none");
    cache.at(WS, "prs");
    cache.at(WS, "all");
    assert.deepEqual(parses, ["none", "prs", "all"]);
  });

  it("parses again after a write, though HEAD has not moved", () => {
    // A write that failed can leave the files changed and HEAD where it was.
    const { cache, parses } = makeCache({ sha: "a".repeat(40) });
    cache.at(WS, "none");
    cache.invalidate();
    cache.at(WS, "none");
    assert.deepEqual(parses, ["none", "none"]);
  });

  it("keeps nothing on a branch with no commits, having no commit to key it on", () => {
    const { cache, parses } = makeCache({ sha: null });
    cache.at(WS, "none");
    cache.at(WS, "none");
    assert.deepEqual(parses, ["none", "none"]);
  });

  it("keeps nothing with an interval of 0, which asks for the clone as it is now", () => {
    const { cache, parses } = makeCache({ sha: "a".repeat(40) }, 0);
    cache.at(WS, "none");
    cache.at(WS, "none");
    assert.deepEqual(parses, ["none", "none"]);
  });
});

describe("the TreeCache watchdog", () => {
  it("drops the tree and parses afresh while a hand edit stands, then caches again", async () => {
    const world = { sha: "a".repeat(40), edited: false };
    const { cache, parses } = makeCache(world);
    cache.at(WS, "none");

    world.edited = true;
    await cache.check();
    // Every read while the edit stands, however many edits follow it: git's
    // answer does not change when an already edited file is edited again.
    cache.at(WS, "none");
    cache.at(WS, "none");
    assert.deepEqual(parses, ["none", "none", "none"]);

    world.edited = false;
    await cache.check();
    const kept = cache.at(WS, "none");
    assert.equal(cache.at(WS, "none"), kept);
    assert.deepEqual(parses, ["none", "none", "none", "none"]);
  });

  it("trusts nothing it could not check, and says so once", async () => {
    const world = { sha: "a".repeat(40), blind: true };
    const { cache, parses, reported } = makeCache(world);
    await cache.check();
    await cache.check();
    cache.at(WS, "none");
    cache.at(WS, "none");
    assert.deepEqual(parses, ["none", "none"]);
    assert.equal(reported.length, 1);
    assert.match(reported[0] as string, /cannot look, so nothing is cached: git is not there/);

    world.blind = false;
    await cache.check();
    assert.match(reported.at(-1) as string, /can see again/);
  });

  it("looks at once when started, and stops looking when stopped", async () => {
    let looks = 0;
    const cache = new TreeCache({
      repoRoot: "/clone",
      navDir: ".navbook",
      intervalMs: 5,
      changed: async () => {
        looks++;
        return false;
      },
    });
    cache.start();
    // Until it has looked twice, rather than for a fixed while: a loaded
    // machine can let 40 ms go by with a 5 ms timer firing only once.
    for (let waited = 0; looks < 2 && waited < 2000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await cache.stop();
    const after = looks;
    assert.ok(after >= 2, `looked ${after} times`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(looks, after);
  });
});
