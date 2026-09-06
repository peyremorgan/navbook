/**
 * The filter bar, the address bar and `EntityFilter`, kept in one shape.
 *
 * A listing's filter belongs in the URL: it is what makes a filtered view
 * something you can bookmark, reload and send to somebody. So the query string
 * is the state, this file is the only translation, and the components read and
 * write `FilterState`.
 *
 * Every key means the same thing when empty: no narrowing by that key. So an
 * empty filter is the whole listing, and each parameter that appears in the URL
 * is one the reader chose.
 */

import type { EntityFilter, Status } from "~~/src/generated/gql/graphql";

/** Statuses an issue can be in; a pull request adds `MERGED`. */
export const ISSUE_STATUSES: readonly Status[] = ["OPEN", "CLOSED"];
export const PR_STATUSES: readonly Status[] = ["OPEN", "MERGED", "CLOSED"];

export interface FilterState {
  /** Empty means any status, as an empty `EntityFilter.status` does. */
  status: Status[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  features: string[];
  /** The search box verbatim; `splitTerms` turns it into `text` terms. */
  text: string;
}

/** What a query string with none of our parameters in it means. */
export function emptyFilter(): FilterState {
  return {
    status: [],
    labels: [],
    assignees: [],
    authors: [],
    milestones: [],
    features: [],
    text: "",
  };
}

export function isEmptyFilter(filter: FilterState): boolean {
  return (
    filter.status.length === 0 &&
    filter.labels.length === 0 &&
    filter.assignees.length === 0 &&
    filter.authors.length === 0 &&
    filter.milestones.length === 0 &&
    filter.features.length === 0 &&
    filter.text.trim() === ""
  );
}

/** A router query value, which is one string, several, or nothing. */
type QueryValue = string | null | undefined | (string | null)[];
export type RouteQuery = Record<string, QueryValue>;

function values(raw: QueryValue): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function statuses(raw: QueryValue, allowed: readonly Status[]): Status[] {
  const wanted = values(raw).map((item) => item.toUpperCase());
  // Unknown or inapplicable statuses are dropped rather than refused: a URL is
  // typed by hand and shared, and a stale `status=merged` on the issue list
  // should show the issue list, not an error.
  return allowed.filter((status) => wanted.includes(status));
}

/**
 * Split a search box into `text` terms.
 *
 * Terms AND together on the server, so bare words narrow. Double quotes keep a
 * phrase whole, since a term may contain spaces and there is otherwise no way
 * to ask for one. An unclosed quote runs to the end rather than failing.
 */
export function splitTerms(text: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      if (current !== "") terms.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") terms.push(current);
  return terms;
}

/** The inverse of `splitTerms`: re-quote anything that would not survive it. */
export function joinTerms(terms: readonly string[]): string {
  return terms
    .map((term) => (/[\s"]/.test(term) ? `"${term.replaceAll('"', "")}"` : term))
    .join(" ");
}

export function queryToFilter(query: RouteQuery, allowed: readonly Status[]): FilterState {
  return {
    status: statuses(query.status, allowed),
    labels: values(query.label),
    assignees: values(query.assignee),
    authors: values(query.author),
    milestones: values(query.milestone),
    features: values(query.feature),
    text: joinTerms(values(query.q).flatMap(splitTerms)),
  };
}

/**
 * The query string for a filter, with every empty parameter left out.
 *
 * Absent rather than empty matters: `?label=` in a shared URL is noise, and a
 * round trip through here has to be stable or the router will loop replacing
 * one spelling of the same filter with another.
 */
export function filterToQuery(filter: FilterState): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  const put = (key: string, list: readonly string[]): void => {
    if (list.length > 0) query[key] = [...list];
  };
  put(
    "status",
    filter.status.map((status) => status.toLowerCase()),
  );
  put("label", filter.labels);
  put("assignee", filter.assignees);
  put("author", filter.authors);
  put("milestone", filter.milestones);
  put("feature", filter.features);
  const terms = splitTerms(filter.text);
  if (terms.length > 0) query.q = [joinTerms(terms)];
  return query;
}

/** The filter as the API takes it; empty keys are omitted, not sent empty. */
export function toEntityFilter(filter: FilterState): EntityFilter {
  const entityFilter: EntityFilter = {};
  if (filter.status.length > 0) entityFilter.status = [...filter.status];
  if (filter.labels.length > 0) entityFilter.labels = [...filter.labels];
  if (filter.assignees.length > 0) entityFilter.assignees = [...filter.assignees];
  if (filter.authors.length > 0) entityFilter.authors = [...filter.authors];
  if (filter.milestones.length > 0) entityFilter.milestones = [...filter.milestones];
  if (filter.features.length > 0) entityFilter.features = [...filter.features];
  const terms = splitTerms(filter.text);
  if (terms.length > 0) entityFilter.text = terms;
  return entityFilter;
}
