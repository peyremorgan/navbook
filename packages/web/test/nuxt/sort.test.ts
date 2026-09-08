/**
 * The three orders of spec 02 §2.5, which the client applies because the API
 * does not: a listing arrives newest first and sorting is the client's own
 * reading of it (spec 06 §6.6).
 *
 * The same rules live in `packages/cli/src/sort.ts`. Neither copy can import
 * the other — nothing about the format ships to the browser — so what keeps
 * them honest is the specification and a suite on each side that asks the same
 * questions. These are those questions.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compareBy, isSortOrder, SORT_ORDERS, type Sortable, sortRows } from "../../app/utils/sort";

const SAME_DAY = "2026-08-01T10:00:00Z";

/** A row carrying only what an order reads. */
const row = (id: string, extra: Partial<Sortable> = {}): Sortable => ({
  id,
  created: SAME_DAY,
  ...extra,
});

const ids = (rows: Sortable[], order: (typeof SORT_ORDERS)[number]): string[] =>
  sortRows(rows, order).map((sorted) => sorted.id);

describe("isSortOrder", () => {
  it("knows the three orders and nothing else", () => {
    for (const order of SORT_ORDERS) assert.equal(isSortOrder(order), true, order);
    for (const value of ["priorty", "", "PRIORITY", null, undefined, 1, {}]) {
      assert.equal(isSortOrder(value), false, String(value));
    }
  });
});

describe("newest", () => {
  it("puts the later timestamp first", () => {
    const rows = [
      row("b", { created: "2026-08-02T09:15:00Z" }),
      row("c", { created: "2026-08-01T09:15:00Z" }),
      row("a", { created: "2026-08-03T09:15:00Z" }),
    ];
    assert.deepEqual(ids(rows, "newest"), ["a", "b", "c"]);
  });

  it("breaks a tie on the id, ascending", () => {
    assert.deepEqual(ids([row("b"), row("a")], "newest"), ["a", "b"]);
  });

  it("compares the timestamp as text, without parsing it", () => {
    // A value the server could not read is still something to order: where it
    // lands is not worth pinning, that it lands is.
    const rows = [row("a"), row("b", { created: "not a date at all" })];
    assert.equal(sortRows(rows, "newest").length, 2);
  });

  it("ignores a rank and a deadline entirely", () => {
    const rows = [
      row("b", { created: "2026-08-02T09:00:00Z" }),
      row("a", { created: "2026-08-03T09:00:00Z", rank: 999, deadline: "2099-01-01" }),
    ];
    assert.deepEqual(ids(rows, "newest"), ["a", "b"]);
  });
});

describe("priority", () => {
  it("reads the rank first, lower before higher", () => {
    const rows = [row("b", { rank: 20 }), row("c", { rank: 30 }), row("a", { rank: 10 })];
    assert.deepEqual(ids(rows, "priority"), ["a", "b", "c"]);
  });

  it("takes zero and a negative as ordinary positions", () => {
    const rows = [row("c", { rank: 10 }), row("a", { rank: -5 }), row("b", { rank: 0 })];
    assert.deepEqual(ids(rows, "priority"), ["a", "b", "c"]);
  });

  it("orders fractions between the whole numbers they fall between", () => {
    // Which is what makes a drop between two neighbours possible at all.
    const rows = [row("c", { rank: 20 }), row("a", { rank: 10 }), row("b", { rank: 15 })];
    assert.deepEqual(ids(rows, "priority"), ["a", "b", "c"]);
    assert.deepEqual(ids([row("b", { rank: 12.5 }), row("a", { rank: 10 })], "priority"), [
      "a",
      "b",
    ]);
  });

  it("puts the unranked last, whatever else they carry", () => {
    const rows = [row("b", { deadline: "1999-01-01" }), row("a", { rank: 100 })];
    assert.deepEqual(ids(rows, "priority"), ["a", "b"]);
  });

  it("falls through to the deadline when two rows share a rank", () => {
    const rows = [
      row("c", { rank: 10 }),
      row("a", { rank: 10, deadline: "2026-08-05" }),
      row("b", { rank: 10, deadline: "2026-12-31" }),
    ];
    assert.deepEqual(ids(rows, "priority"), ["a", "b", "c"]);
  });

  it("falls through again to the timestamp, and then to the id", () => {
    const rows = [
      row("b", { rank: 10, deadline: "2026-08-05", created: "2026-08-01T09:00:00Z" }),
      row("a", { rank: 10, deadline: "2026-08-05", created: "2026-08-02T09:00:00Z" }),
    ];
    assert.deepEqual(ids(rows, "priority"), ["a", "b"]);
    assert.deepEqual(ids([row("b", { rank: 10 }), row("a", { rank: 10 })], "priority"), ["a", "b"]);
  });
});

describe("deadline", () => {
  it("reads the day first, soonest before latest", () => {
    const rows = [
      row("b", { deadline: "2026-09-01" }),
      row("c", { deadline: "2026-12-31" }),
      row("a", { deadline: "2026-08-05" }),
    ];
    assert.deepEqual(ids(rows, "deadline"), ["a", "b", "c"]);
  });

  it("compares days as text, which is what the spelling is for", () => {
    // No parse means no zone, and no way for a parse to disagree.
    const rows = [row("b", { deadline: "2026-10-02" }), row("a", { deadline: "2026-10-01" })];
    assert.deepEqual(ids(rows, "deadline"), ["a", "b"]);
  });

  it("puts the undated last, and orders them by rank among themselves", () => {
    const rows = [row("c", {}), row("b", { rank: 20 }), row("a", { deadline: "2099-12-31" })];
    assert.deepEqual(ids(rows, "deadline"), ["a", "b", "c"]);
  });

  it("reads a past day as sooner, since a missed deadline is still the soonest", () => {
    const rows = [row("b", { deadline: "2026-12-31" }), row("a", { deadline: "1999-01-01" })];
    assert.deepEqual(ids(rows, "deadline"), ["a", "b"]);
  });
});

describe("every order", () => {
  it("is total, so a sort is stable however the rows arrived", () => {
    const rows = [row("c"), row("a"), row("b")];
    for (const order of SORT_ORDERS) {
      assert.deepEqual(ids(rows, order), ["a", "b", "c"], order);
      assert.deepEqual(ids([...rows].reverse(), order), ["a", "b", "c"], order);
    }
  });

  it("survives a rank that is not a finite number", () => {
    // The server reads a malformed rank as null, so this should not arise —
    // but a comparator that returned NaN would scramble the whole listing,
    // which is far worse than a row in the wrong place.
    const rows = [
      row("b", { rank: Number.NaN }),
      row("a", { rank: 10 }),
      row("c", { rank: Number.POSITIVE_INFINITY }),
    ];
    for (const order of SORT_ORDERS) {
      assert.deepEqual(new Set(ids(rows, order)), new Set(["a", "b", "c"]), order);
    }
    assert.equal(ids(rows, "priority")[0], "a", "the readable rank still leads");
  });

  it("treats an undefined key as an absent one", () => {
    // A pull request carries neither, and arrives with both undefined rather
    // than null; the two must mean the same thing.
    assert.deepEqual(ids([row("b", { rank: undefined }), row("a", { rank: 10 })], "priority"), [
      "a",
      "b",
    ]);
  });

  it("leaves the array it was given alone", () => {
    const rows = [row("b", { rank: 20 }), row("a", { rank: 10 })];
    sortRows(rows, "priority");
    assert.deepEqual(
      rows.map((r) => r.id),
      ["b", "a"],
    );
  });

  it("hands back a comparator that agrees with the sort", () => {
    const compare = compareBy("priority");
    assert.ok(compare(row("a", { rank: 10 }), row("b", { rank: 20 })) < 0);
    assert.ok(compare(row("b", { rank: 20 }), row("a", { rank: 10 })) > 0);
    assert.equal(compare(row("a", { rank: 10 }), row("a", { rank: 10 })), 0);
  });
});
