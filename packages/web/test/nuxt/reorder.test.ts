/**
 * The arithmetic behind a drop — spec 02 §2.5.
 *
 * This is the half of reordering worth proving in isolation: the rest is
 * pointer events and focus, which the end-to-end suite drives in a real
 * browser. What matters here is that placing an issue rewrites *one* file, and
 * the way that is achieved is by finding a value between the neighbours rather
 * than renumbering the listing.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { rankForPosition } from "../../app/composables/useInboxReorder";
import type { InboxItem } from "../../app/utils/inbox";
import type { IssueListItemFragment, PrListItemFragment } from "../../src/generated/gql/graphql";

/** A row carrying nothing but the rank the arithmetic reads. */
const issue = (id: string, rank: number | null): InboxItem => ({
  kind: "issue",
  id,
  reasons: ["assigned"],
  entity: { id, rank } as IssueListItemFragment,
});

const pr = (id: string): InboxItem => ({
  kind: "pr",
  id,
  reasons: ["author"],
  entity: { id } as PrListItemFragment,
});

/** A queue of ranked rows, in the order they are shown. */
const queue = (...ranks: (number | null)[]): InboxItem[] =>
  ranks.map((rank, index) => issue(`aaaa000${index}`, rank));

describe("rankForPosition", () => {
  it("halves the gap between two ranked neighbours", () => {
    assert.equal(rankForPosition(queue(10, 20), 1), 15);
    assert.equal(rankForPosition(queue(10, 11), 1), 10.5);
    assert.equal(rankForPosition(queue(0, 10), 1), 5);
    assert.equal(rankForPosition(queue(-10, 10), 1), 0);
  });

  it("steps clear of the first row when dropped above it", () => {
    assert.equal(rankForPosition(queue(10, 20), 0), 0);
    assert.equal(rankForPosition(queue(0, 20), 0), -10);
    // Below zero is an ordinary place to be: a rank is a position, not a size.
    assert.equal(rankForPosition(queue(-10), 0), -20);
  });

  it("steps clear of the last row when dropped below it", () => {
    assert.equal(rankForPosition(queue(10, 20), 2), 30);
    assert.equal(rankForPosition(queue(10), 1), 20);
  });

  it("starts at the first step when nothing is ranked at all", () => {
    assert.equal(rankForPosition([], 0), 10);
    assert.equal(rankForPosition(queue(null, null), 1), 10);
  });

  it("places a row dropped into the unranked tail after everything ranked", () => {
    // There is nothing in the tail to sit between — those rows are in the order
    // they arrived — so the only reading that means anything is "last".
    const rows = queue(10, 20, null, null);
    assert.equal(rankForPosition(rows, 2), 30);
    assert.equal(rankForPosition(rows, 3), 30);
    assert.equal(rankForPosition(rows, 4), 30);
  });

  it("reads a pull request as unranked, since it has no rank to read", () => {
    const rows = [issue("aaaa0001", 10), pr("bbbb0001"), issue("aaaa0002", 20)];
    // Dropped between the pull request and the ranked row below it, the row
    // still lands between 10 and 20.
    assert.equal(rankForPosition(rows, 2), 15);
    assert.equal(rankForPosition(rows, 1), 15);
  });

  it("keeps the order it computed, so a drop lands where it was drawn", () => {
    // The contract the preview depends on: the rank chosen for position `i`
    // must sort the row into position `i`.
    const rows = queue(10, 20, 30);
    for (let index = 0; index <= rows.length; index++) {
      const rank = rankForPosition(rows, index);
      const ranks = rows.map((row) => (row.kind === "issue" ? (row.entity.rank as number) : null));
      const placed = [...ranks.slice(0, index), rank, ...ranks.slice(index)];
      assert.deepEqual(
        [...placed].sort((a, b) => (a as number) - (b as number)),
        placed,
        `at ${index}`,
      );
    }
  });

  it("clamps an index outside the list rather than producing nonsense", () => {
    assert.equal(rankForPosition(queue(10, 20), 99), 30);
    assert.equal(rankForPosition(queue(10, 20), -1), 0);
  });

  it("ignores a rank that is not a finite number", () => {
    // The server reads a malformed rank as null, so this should not arise; if
    // it did, halving against NaN would place every later drop at NaN too.
    const rows = [issue("aaaa0001", Number.NaN as number), issue("aaaa0002", 20)];
    assert.equal(rankForPosition(rows, 0), 10);
    assert.equal(Number.isFinite(rankForPosition(rows, 1)), true);
  });

  it("keeps halving usable over repeated drops into the same gap", () => {
    // Fifty squeezes into one gap and the value is still a number two rows
    // apart, which is what makes renumbering unnecessary rather than deferred.
    let low = 10;
    const high = 20;
    for (let step = 0; step < 50; step++) {
      const next = rankForPosition(queue(low, high), 1);
      assert.ok(next > low && next < high, `step ${step}: ${next}`);
      low = next;
    }
  });
});
