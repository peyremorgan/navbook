/**
 * The history walk, and how seldom it happens.
 *
 * What is worth testing here is not who comes back — core's own tests say that
 * — but that the walk is done once per commit rather than once per request,
 * and that the machine account is left out of it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person } from "@navbook/core";
import { AuthorCache } from "../../src/people.ts";

const MACHINE = { name: "Nav Server", email: "server@test.invalid" };

/** A walk that records what it was asked, and answers whatever it is told to. */
function recording(answers: Person[] = [{ name: "Alice", email: "alice@example.com" }]): {
  cache: AuthorCache;
  calls: string[];
} {
  const calls: string[] = [];
  const cache = new AuthorCache({
    repoRoot: "/somewhere",
    exclude: MACHINE,
    load: (cwd, rev) => {
      calls.push(`${cwd}@${rev}`);
      return answers;
    },
  });
  return { cache, calls };
}

describe("AuthorCache", () => {
  it("walks once for a HEAD that has not moved", () => {
    const { cache, calls } = recording();
    assert.deepEqual(cache.at("abc123"), [{ name: "Alice", email: "alice@example.com" }]);
    assert.deepEqual(cache.at("abc123"), [{ name: "Alice", email: "alice@example.com" }]);
    assert.deepEqual(calls, ["/somewhere@abc123"]);
  });

  it("walks again once it has", () => {
    const { cache, calls } = recording();
    cache.at("abc123");
    cache.at("def456");
    assert.deepEqual(calls, ["/somewhere@abc123", "/somewhere@def456"]);
  });

  it("walks again for a HEAD it has seen before but not last", () => {
    // A branch moved back, by a reset or a force-pushed remote. The sha is the
    // key rather than a high-water mark, so this is a miss and not a hit.
    const { cache, calls } = recording();
    cache.at("abc123");
    cache.at("def456");
    cache.at("abc123");
    assert.equal(calls.length, 3);
  });

  it("says nobody, and asks nothing, where there is no HEAD", () => {
    const { cache, calls } = recording();
    assert.deepEqual(cache.at(null), []);
    assert.deepEqual(calls, []);
  });

  it("does not let a null HEAD forget what it knew", () => {
    const { cache, calls } = recording();
    cache.at("abc123");
    cache.at(null);
    cache.at("abc123");
    assert.deepEqual(calls, ["/somewhere@abc123"]);
  });

  it("leaves out the clone's own committer, however it is spelled", () => {
    const { cache } = recording([
      { name: "Nav Server", email: "SERVER@test.invalid" },
      { name: "Alice", email: "alice@example.com" },
    ]);
    assert.deepEqual(cache.at("abc123"), [{ name: "Alice", email: "alice@example.com" }]);
  });

  it("keeps somebody whose address merely resembles the committer's", () => {
    const { cache } = recording([
      { name: "Not The Server", email: "server@test.invalid.example.com" },
      { name: "Nor This", email: "aserver@test.invalid" },
    ]);
    assert.deepEqual(
      cache.at("abc123").map((person) => person.name),
      ["Not The Server", "Nor This"],
    );
  });

  it("says nobody where the history holds only the committer", () => {
    const { cache } = recording([{ name: "Nav Server", email: "server@test.invalid" }]);
    assert.deepEqual(cache.at("abc123"), []);
  });
});
