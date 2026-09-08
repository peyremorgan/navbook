/**
 * The orders a listing can be read in — spec 02 §2.5.
 *
 * The server hands every listing over newest first and takes no sort argument,
 * because an order it owned would be the index spec 06 §6.6 refuses. So the
 * order is the client's own reading, decided here and applied before paging.
 *
 * These rules are also implemented in `packages/cli/src/sort.ts`, and the
 * duplication is the point rather than an oversight: nothing about the format
 * ships to the browser (spec 06 §6.3), so the client cannot import core's
 * readers, and the specification is what the two copies are checked against.
 *
 * Each order is a chain ending in the comparison that cannot tie, so an
 * ordering is total and two front ends sorting one listing agree about it.
 */

export const SORT_ORDERS = ["priority", "deadline", "newest"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === "string" && (SORT_ORDERS as readonly string[]).includes(value);
}

/** What a row needs to carry to be sorted; a pull request has neither key. */
export interface Sortable {
  id: string;
  created: string;
  rank?: number | null;
  deadline?: string | null;
}

type Comparator = (a: Sortable, b: Sortable) => number;

/**
 * Unranked last and undated last, whichever way the values themselves run.
 *
 * An issue nobody has placed is not at the front of the queue, and one nobody
 * has dated is not the most urgent. A pull request has neither key, so this is
 * also what puts one below the work that was scheduled.
 */
function nullsLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  compare: (a: T, b: T) => number,
): number {
  const first = a ?? null;
  const second = b ?? null;
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return compare(first, second);
}

const byRank: Comparator = (a, b) =>
  // A rank the server could not read arrives as null, so this never sees NaN;
  // guarding anyway keeps a comparator that cannot return NaN and scramble the
  // sort, which is what a bad value would otherwise do.
  nullsLast(
    Number.isFinite(a.rank) ? a.rank : null,
    Number.isFinite(b.rank) ? b.rank : null,
    (x, y) => x - y,
  );

const byDeadline: Comparator = (a, b) =>
  // Dates in this spelling sort as text, which is most of why the spelling was
  // chosen: no parse, and no way for a parse to disagree with a comparison.
  nullsLast(a.deadline, b.deadline, (x, y) => (x < y ? -1 : x > y ? 1 : 0));

/** Newest first, ties broken by id — the order every listing arrives in. */
const byNewest: Comparator = (a, b) => {
  if (a.created !== b.created) return a.created < b.created ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Try each comparison in turn; the first with an opinion decides. */
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

/** The comparator for one order, for a caller sorting something of its own. */
export function compareBy(order: SortOrder): Comparator {
  return COMPARATORS[order];
}

/** A listing in one of the orders of spec 02 §2.5. */
export function sortRows<T extends Sortable>(rows: readonly T[], order: SortOrder): T[] {
  return [...rows].sort(COMPARATORS[order]);
}
