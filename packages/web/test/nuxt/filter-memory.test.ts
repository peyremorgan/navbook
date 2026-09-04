/**
 * What comes back out of storage.
 *
 * The rest of the memory is a route change and a link, and is proved in a
 * browser. This part is not: it reads a string some other version of the
 * client wrote, and has to turn anything it cannot recognise into "this tab
 * has not been anywhere" rather than into a link that cannot be navigated to.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readMemory } from "../../app/composables/useFilterMemory";

const stored = (value: unknown): string => JSON.stringify(value);

describe("readMemory", () => {
  it("reads a listing back with the filter it was left showing", () => {
    assert.deepEqual(readMemory(stored({ "/issues": { status: ["closed"], label: ["bug"] } })), {
      "/issues": { status: ["closed"], label: ["bug"] },
    });
  });

  it("keeps the two listings apart", () => {
    const memory = readMemory(
      stored({ "/issues": { label: ["bug"] }, "/prs": { q: ["deadline"] } }),
    );
    assert.deepEqual(memory, { "/issues": { label: ["bug"] }, "/prs": { q: ["deadline"] } });
  });

  it("has been nowhere when there is nothing to read", () => {
    assert.deepEqual(readMemory(null), {});
    assert.deepEqual(readMemory(""), {});
    assert.deepEqual(readMemory("{}"), {});
  });

  it("survives something that is not the JSON it wrote", () => {
    for (const raw of ["not json", "[1,2]", "null", '"a string"', "42", "true"]) {
      assert.deepEqual(readMemory(raw), {}, raw);
    }
  });

  it("drops an entry that is not a filter", () => {
    assert.deepEqual(readMemory(stored({ "/issues": null, "/prs": "bug" })), {});
    assert.deepEqual(readMemory(stored({ "/issues": ["bug"] })), {});
  });

  it("drops a parameter the filter does not own", () => {
    // `refs=all` is a heavier way to look rather than a filter, and is asked
    // for again each time rather than restored.
    assert.deepEqual(readMemory(stored({ "/prs": { refs: ["all"], q: ["deadline"] } })), {
      "/prs": { q: ["deadline"] },
    });
    assert.deepEqual(readMemory(stored({ "/prs": { refs: ["all"] } })), {});
  });

  it("drops an entry left with nothing in it", () => {
    assert.deepEqual(readMemory(stored({ "/issues": {}, "/prs": { label: [] } })), {});
  });

  it("keeps only keys that could be a route path", () => {
    assert.deepEqual(readMemory(stored({ issues: { label: ["bug"] }, "": {} })), {});
  });

  it("does not let a stored key become the object's prototype", () => {
    // `JSON.parse` hands `__proto__` over as an own property, unlike a literal,
    // so assigning entries by key without looking is how a plain object stops
    // being one.
    const memory = readMemory('{"__proto__": {"label": ["bug"]}, "/issues": {"q": ["x"]}}');
    assert.deepEqual(Object.getPrototypeOf(memory), Object.prototype);
    assert.deepEqual(memory, { "/issues": { q: ["x"] } });
  });

  it("normalises the values, so a hand-edited entry is still navigable", () => {
    assert.deepEqual(readMemory(stored({ "/issues": { label: "bug", q: [" x ", ""] } })), {
      "/issues": { label: ["bug"], q: ["x"] },
    });
  });
});
