/**
 * The orders `nav issue list --sort` offers — spec 02 §2.5.
 *
 * Sorting is a front end's reading of what it was handed, never an order the
 * files or the API hold: core lists newest first and the server takes no sort
 * argument, because an order either of them owned would be the index spec 06
 * §6.6 refuses. So this is here rather than in `core`, and the web client has
 * its own copy of the same rules for the same reason.
 *
 * Each order is a chain of comparisons ending in the one that can never tie,
 * so an ordering is total and two tools sorting one listing agree about it.
 */

import { type EntityRecord, readDeadline, readRank } from "@navbook/core";
import { fail } from "./errors.ts";

export const SORT_ORDERS = ["priority", "deadline", "newest"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** The order a `list` command uses when nobody asks for one: spec 04 §4.2's. */
export const DEFAULT_SORT: SortOrder = "newest";

type Comparator = (a: EntityRecord, b: EntityRecord) => number;

/**
 * What `--sort` was given, or the default when it was not given at all.
 *
 * A value that is not an order is refused rather than defaulted: somebody who
 * typed `--sort priorty` asked a question, and answering a different one by
 * handing back a listing in the usual order would hide the typo.
 */
export function parseSortOrder(value: unknown): SortOrder {
  if (value === undefined) return DEFAULT_SORT;
  if (typeof value === "string" && (SORT_ORDERS as readonly string[]).includes(value)) {
    return value as SortOrder;
  }
  fail(`--sort must be one of ${SORT_ORDERS.join(", ")}`);
}

/**
 * Unranked last and undated last, whichever way the values themselves run.
 *
 * An issue nobody has placed is not at the front of the queue, and one nobody
 * has dated is not the most urgent; both belong after everything that was
 * said about explicitly.
 */
function nullsLast<T>(a: T | null, b: T | null, compare: (a: T, b: T) => number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compare(a, b);
}

const byRank: Comparator = (a, b) => nullsLast(readRank(a.fm), readRank(b.fm), (x, y) => x - y);

const byDeadline: Comparator = (a, b) =>
  // Dates in this spelling sort as text, which is most of why the spelling was
  // chosen: no parse, and no way for a parse to disagree with a comparison.
  nullsLast(readDeadline(a.fm), readDeadline(b.fm), (x, y) => (x < y ? -1 : x > y ? 1 : 0));

/** Newest first, ties broken by ID — core's own order (spec 04 §4.2). */
const byNewest: Comparator = (a, b) => {
  const aCreated = typeof a.fm.created === "string" ? a.fm.created : "";
  const bCreated = typeof b.fm.created === "string" ? b.fm.created : "";
  if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Try each comparison in turn; the first that has an opinion decides. */
function chain(...comparators: Comparator[]): Comparator {
  return (a, b) => {
    for (const compare of comparators) {
      const verdict = compare(a, b);
      if (verdict !== 0) return verdict;
    }
    return 0;
  };
}

const COMPARATORS: Record<SortOrder, Comparator> = {
  priority: chain(byRank, byDeadline, byNewest),
  deadline: chain(byDeadline, byRank, byNewest),
  newest: byNewest,
};

/** A listing in one of the orders of spec 02 §2.5. */
export function sortListing(entities: readonly EntityRecord[], order: SortOrder): EntityRecord[] {
  return [...entities].sort(COMPARATORS[order]);
}
