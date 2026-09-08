/**
 * The inbox view, in the address bar.
 *
 * Same rule as the listings' filter (`app/utils/filter-params.ts`): the query
 * string is the state rather than a copy of it, so a view is something to
 * bookmark and send to somebody, and this file is the only translation. Every
 * default is left out of the URL, which keeps the round trip stable and each
 * parameter that does appear one the reader chose.
 *
 * A value the app would never write — a misspelled view, a feature nothing
 * carries — falls back to the default rather than failing. A URL is typed by
 * hand and shared, and the inbox is a better answer than an error.
 */

import { joinTerms, queryValues, type RouteQuery, splitTerms } from "~/utils/filter-params";
import {
  INBOX_KIND_CHOICES,
  INBOX_VIEWS,
  type InboxKindChoice,
  type InboxSelection,
  type InboxView,
} from "~/utils/inbox";

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
  /** The search box verbatim; `splitTerms` turns it into `text` terms. */
  text: string;
}

/** The keys this page owns; everything else in the URL is left alone. */
export const INBOX_PARAM_KEYS = ["view", "kind", "feature", "status", "q"] as const;

export function defaultInboxParams(): InboxParams {
  return { view: "everything", kind: "any", feature: null, finished: false, text: "" };
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
    // A slug is somebody's word, not one of ours, so it is carried through as
    // written and compared with case folded — as core compares it.
    feature: first(query.feature),
    finished: firstWord(query.status) === "all",
    text: joinTerms(queryValues(query.q).flatMap(splitTerms)),
  };
}

/** The query string for a view, with every default left out. */
export function inboxParamsToQuery(params: InboxParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.view !== "everything") query.view = params.view;
  if (params.kind !== "any") query.kind = params.kind;
  if (params.feature !== null && params.feature !== "") query.feature = params.feature;
  if (params.finished) query.status = "all";
  const terms = splitTerms(params.text);
  if (terms.length > 0) query.q = joinTerms(terms);
  return query;
}
