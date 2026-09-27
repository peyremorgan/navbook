/**
 * The inbox view, in the address bar.
 *
 * Same rule as the listings' filter (`app/utils/filter-params.ts`): the query
 * string is the state rather than a copy of it, so a view is something to
 * bookmark and send to somebody, and this file is the only translation. Every
 * default is left out of the URL, which keeps the round trip stable and each
 * parameter that does appear one the reader chose.
 *
 * A value the app would never write — a misspelled view, a group value
 * nothing carries — falls back to the default rather than failing. A URL is typed by
 * hand and shared, and the inbox is a better answer than an error.
 */

import { joinTerms, queryValues, type RouteQuery, splitTerms } from "~/utils/filter-params";
import {
  INBOX_GROUPINGS,
  INBOX_KIND_CHOICES,
  INBOX_VIEWS,
  type InboxKindChoice,
  type InboxSelection,
  type InboxView,
} from "~/utils/inbox";
import { isSortOrder, type SortOrder } from "~/utils/sort";

export interface InboxParams extends InboxSelection {
  /**
   * Closed issues and closed or merged pull requests, too.
   *
   * One switch rather than status chips: an inbox is a reading of what is left
   * to do, and the only distinction that serves is between what is still going
   * and what is over. Which of `closed` and `merged` something finished as is
   * a question for the listing it came from.
   */
  finished: boolean;
  /**
   * The order the list is read in (spec 02 §2.5).
   *
   * Priority by default, unlike the listings. Those answer "what is there",
   * where newest first is the honest reading; this one answers "what next",
   * which is the question a rank was written down to answer.
   */
  sort: SortOrder;
  /** The search box verbatim; `splitTerms` turns it into `text` terms. */
  text: string;
}

/** The keys this page owns itself; everything else in the URL is left alone. */
export const INBOX_PARAM_KEYS = ["view", "kind", "status", "sort", "q"] as const;

/**
 * Every key this page owns, registered groups included.
 *
 * A function rather than a constant because a group is registered by a layer
 * at boot, and a frozen list read at module load would have been read first.
 */
export function inboxParamKeys(): string[] {
  return [...INBOX_PARAM_KEYS, ...INBOX_GROUPINGS.map((group) => group.key)];
}

export function defaultInboxParams(): InboxParams {
  return {
    view: "everything",
    kind: "any",
    ext: {},
    finished: false,
    sort: "priority",
    text: "",
  };
}

/** The first value a key holds; each of these groups chooses exactly one. */
function first(raw: RouteQuery[string]): string | null {
  return queryValues(raw)[0] ?? null;
}

/** The same, folded — these are words this page defines, not values from a tree. */
function firstWord(raw: RouteQuery[string]): string | null {
  return first(raw)?.toLowerCase() ?? null;
}

export function queryToInboxParams(query: RouteQuery): InboxParams {
  const view = firstWord(query.view);
  const kind = firstWord(query.kind);
  return {
    view: INBOX_VIEWS.includes(view as InboxView) ? (view as InboxView) : "everything",
    kind: INBOX_KIND_CHOICES.includes(kind as InboxKindChoice) ? (kind as InboxKindChoice) : "any",
    // A registered group's value is somebody's word, not one of ours, so it is
    // carried through as written and left to the group to compare.
    ext: Object.fromEntries(
      INBOX_GROUPINGS.map((group) => [group.key, first(query[group.key])]).filter(
        ([, value]) => value !== null,
      ),
    ),
    finished: firstWord(query.status) === "all",
    sort: isSortOrder(firstWord(query.sort)) ? (firstWord(query.sort) as SortOrder) : "priority",
    text: joinTerms(queryValues(query.q).flatMap(splitTerms)),
  };
}

/** The query string for a view, with every default left out. */
export function inboxParamsToQuery(params: InboxParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.view !== "everything") query.view = params.view;
  if (params.kind !== "any") query.kind = params.kind;
  for (const group of INBOX_GROUPINGS) {
    const value = params.ext[group.key] ?? null;
    if (value !== null && value !== "") query[group.key] = value;
  }
  if (params.finished) query.status = "all";
  if (params.sort !== "priority") query.sort = params.sort;
  const terms = splitTerms(params.text);
  if (terms.length > 0) query.q = joinTerms(terms);
  return query;
}
