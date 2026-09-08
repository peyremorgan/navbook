/**
 * The CLI's listing orders and the browser's, checked against each other.
 *
 * Spec 02 §2.5 defines three orders, and two front ends implement them. That
 * duplication is a property of the design rather than an oversight: nothing
 * about the format ships to the browser (spec 06 §6.3), so the client cannot
 * import core's readers and has to spell the rules out again. What the two
 * copies do not have is a compiler to keep them in step, which is what this is
 * for — the same errand as the rest of this directory, one implementation
 * short of a second language.
 *
 * The values are chosen to collide: ranks that repeat, days that repeat, and
 * timestamps that repeat, so that every tier of every chain is reached and the
 * tie-break at the end of each is exercised rather than skipped.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SORT_ORDERS, sortListing } from "../../packages/cli/src/sort.ts";
import { type NavTree, parseTree } from "../../packages/core/src/core/tree.ts";
import { type Sortable, sortRows } from "../../packages/web/app/utils/sort.ts";

interface Row {
  id: string;
  rank: number | null;
  deadline: string | null;
  created: string;
}

/** Deliberately repetitive, so ties are the common case and not the rare one. */
const RANKS: (number | null)[] = [null, null, 0, -5, 10, 10, 2.5, 20, 1000];
const DAYS: (string | null)[] = [
  null,
  null,
  "2026-08-01",
  "2026-08-01",
  "2026-12-31",
  "2099-01-01",
];
const MADE = ["2026-08-01T09:00:00Z", "2026-08-02T09:00:00Z", "2026-08-02T09:00:00Z"];

/** A small deterministic generator: the same rows on every machine and run. */
function generator(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % bound;
  };
}

/** The rows as `core` reads them out of a tree. */
function asRecords(rows: readonly Row[]) {
  const entries: Record<string, string> = {};
  for (const row of rows) {
    const lines = ["---", "title: T", "author: a@b.co", `created: ${row.created}`];
    if (row.rank !== null) lines.push(`rank: ${row.rank}`);
    if (row.deadline !== null) lines.push(`deadline: ${row.deadline}`);
    lines.push("---", "", "Body.", "");
    entries[`issues/open/${row.id}-slug/issue.md`] = lines.join("\n");
  }
  return parseTree(new Map(Object.entries(entries)) as NavTree).issues;
}

/** And as the browser receives them, which is fields rather than a file. */
const asSortables = (rows: readonly Row[]): Sortable[] =>
  rows.map((row) => ({
    id: row.id,
    created: row.created,
    rank: row.rank,
    deadline: row.deadline,
  }));

describe("the listing orders of spec 02 §2.5", () => {
  it("are read the same way by the CLI and by the browser", () => {
    const next = generator(20260908);
    let checked = 0;

    for (let round = 0; round < 400; round++) {
      const rows: Row[] = [];
      for (let index = 0; index < 2 + next(7); index++) {
        rows.push({
          id: `aaaa${1000 + index}`,
          rank: RANKS[next(RANKS.length)] ?? null,
          deadline: DAYS[next(DAYS.length)] ?? null,
          created: MADE[next(MADE.length)] as string,
        });
      }

      const records = asRecords(rows);
      const sortables = asSortables(rows);
      for (const order of SORT_ORDERS) {
        assert.deepEqual(
          sortListing(records, order).map((entity) => entity.id),
          sortRows(sortables, order).map((row) => row.id),
          `${order}: ${JSON.stringify(rows)}`,
        );
        checked++;
      }
    }

    assert.equal(checked, 1200, "every round exercised every order");
  });

  it("are each total, so neither can leave two rows in an arbitrary order", () => {
    // The property the tie-break exists for: reversing the input must not
    // reverse the output, or a refetch would reshuffle rows that tied.
    const rows: Row[] = [
      { id: "aaaa0001", rank: 10, deadline: "2026-08-01", created: MADE[0] as string },
      { id: "aaaa0002", rank: 10, deadline: "2026-08-01", created: MADE[0] as string },
      { id: "aaaa0003", rank: null, deadline: null, created: MADE[0] as string },
    ];
    for (const order of SORT_ORDERS) {
      const forwards = sortListing(asRecords(rows), order).map((entity) => entity.id);
      const backwards = sortListing(asRecords([...rows].reverse()), order).map(
        (entity) => entity.id,
      );
      assert.deepEqual(forwards, backwards, order);
      assert.deepEqual(
        sortRows(asSortables([...rows].reverse()), order).map((r) => r.id),
        forwards,
        order,
      );
    }
  });
});
