/**
 * The filter bar, the address bar and the API's `IssueFilter` and `PrFilter`,
 * kept in one shape.
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

import type {
  DeadlineState,
  IssueFilter,
  IssueStatus,
  PrFilter,
  Status,
} from "~~/src/generated/gql/graphql";

/** The parameters the filter owns. Everything else in a query belongs to the page. */
export const FILTER_KEYS = [
  "status",
  "label",
  "assignee",
  "author",
  "milestone",
  "reviewer",
  "deadline",
  "q",
] as const;

/** Statuses an issue can be in; a pull request adds `MERGED`. */
export const ISSUE_STATUSES: readonly Status[] = ["OPEN", "CLOSED"];
export const PR_STATUSES: readonly Status[] = ["OPEN", "MERGED", "CLOSED"];

/** Where an issue stands against its deadline; issues only (spec 02 §2.5). */
export const DEADLINE_STATES: readonly DeadlineState[] = ["OVERDUE", "NONE"];

export interface FilterState {
  /** Empty means any status, as an empty `status` in the API's filter does. */
  status: Status[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  /** Asked to review it; pull requests only (spec 02 §2.7). */
  reviewers: string[];
  /** Where it stands against its deadline; issues only (spec 02 §2.5). */
  deadline: DeadlineState[];
  /** The search box verbatim; `splitTerms` turns it into `text` terms. */
  text: string;
  /**
   * Values for parameters plugins added, by parameter name (spec 02 §2.12).
   *
   * Kept apart from the named keys rather than mixed in, so every function
   * here stays total over the format's own filter and a plugin cannot shadow
   * one of its keys by choosing the same name.
   */
  ext: Record<string, string[]>;
}

/**
 * Filter parameters plugin layers registered.
 *
 * A module-level array rather than something read from the slot registry,
 * because everything in this file is a pure function over a query string and
 * has to stay unit-testable without mounting an app. A layer's Nuxt plugin
 * registers into the slots, and the slots push here.
 */
export const FILTER_EXTENSIONS: { param: string; apiField: string }[] = [];

/** Register a plugin's filter parameter. Called by the slot registry. */
export function registerFilterParam(param: string, apiField: string): void {
  if (!FILTER_EXTENSIONS.some((entry) => entry.param === param)) {
    FILTER_EXTENSIONS.push({ param, apiField });
  }
}

/** Forget every registered parameter. For tests. */
export function resetFilterParams(): void {
  FILTER_EXTENSIONS.length = 0;
}

/**
 * Every parameter the filter owns, registered ones included.
 *
 * A function rather than a constant because a layer registers at boot, and a
 * frozen list read at module load would have been read first. It matters for
 * `withoutFilter`: a plugin's parameter the filter did not claim would be
 * carried from one listing to the next as though it belonged to the page.
 */
export function filterKeys(): string[] {
  return [...FILTER_KEYS, ...FILTER_EXTENSIONS.map((entry) => entry.param)];
}

/** What a query string with none of our parameters in it means. */
export function emptyFilter(): FilterState {
  return {
    status: [],
    labels: [],
    assignees: [],
    authors: [],
    milestones: [],
    reviewers: [],
    deadline: [],
    text: "",
    ext: {},
  };
}

export function isEmptyFilter(filter: FilterState): boolean {
  return (
    filter.status.length === 0 &&
    filter.labels.length === 0 &&
    filter.assignees.length === 0 &&
    filter.authors.length === 0 &&
    filter.milestones.length === 0 &&
    filter.reviewers.length === 0 &&
    filter.deadline.length === 0 &&
    filter.text.trim() === "" &&
    Object.values(filter.ext).every((values) => values.length === 0)
  );
}

/** A router query value, which is one string, several, or nothing. */
type QueryValue = string | null | undefined | (string | null)[];
export type RouteQuery = Record<string, QueryValue>;

/**
 * The strings a query-string key holds: one value, several, or none.
 *
 * Blanks are dropped rather than kept, so `?label=` and no `label` at all are
 * the same filter — which is what makes a round trip through the address bar
 * stable.
 */
export function queryValues(raw: QueryValue): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function statuses(raw: QueryValue, allowed: readonly Status[]): Status[] {
  const wanted = queryValues(raw).map((item) => item.toUpperCase());
  // Unknown or inapplicable statuses are dropped rather than refused: a URL is
  // typed by hand and shared, and a stale `status=merged` on the issue list
  // should show the issue list, not an error.
  return allowed.filter((status) => wanted.includes(status));
}

/**
 * The deadline states a URL names, dropped for the same reason a status is
 * when it does not apply.
 *
 * `allowed` is empty on the pull request listing, so `?deadline=overdue` there
 * reads as no narrowing rather than as a filter the API would refuse.
 */
function deadlineStates(raw: QueryValue, allowed: readonly DeadlineState[]): DeadlineState[] {
  const wanted = queryValues(raw).map((item) => item.toUpperCase());
  return allowed.filter((state) => wanted.includes(state));
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

/**
 * Just the filter's own parameters, normalised the way `queryToFilter` reads
 * them: every value a trimmed string, every empty key left out.
 *
 * This is `filterToQuery` for a query string that has been round the houses —
 * typed by hand, or read back out of storage — so an unrecognised shape comes
 * out as nothing remembered rather than as something that cannot be navigated
 * to. Statuses are not checked against a listing here: `queryToFilter` already
 * drops one that does not apply, and a filter is remembered per listing.
 */
export function filterQuery(query: RouteQuery): Record<string, string[]> {
  const kept: Record<string, string[]> = {};
  for (const key of filterKeys()) {
    const list = queryValues(query[key]);
    if (list.length > 0) kept[key] = list;
  }
  return kept;
}

/** Everything the filter does not own, left exactly as it was found. */
export function withoutFilter(query: RouteQuery): RouteQuery {
  const rest: RouteQuery = { ...query };
  for (const key of filterKeys()) delete rest[key];
  return rest;
}

export interface FilterKeys {
  /** Statuses this listing has; the rest are dropped from the URL. */
  statuses: readonly Status[];
  /** Deadline states it has: none, on a listing whose noun is not scheduled. */
  deadlines?: readonly DeadlineState[];
  /** Whether it has reviewers at all: only a pull request does (spec 02 §2.7). */
  reviewers?: boolean;
}

export function queryToFilter(query: RouteQuery, keys: FilterKeys): FilterState {
  return {
    status: statuses(query.status, keys.statuses),
    labels: queryValues(query.label),
    assignees: queryValues(query.assignee),
    authors: queryValues(query.author),
    milestones: queryValues(query.milestone),
    // Dropped on a listing that has none, as a deadline is: `?reviewer=` on the
    // issue list reads as no narrowing, not as a term the API would refuse.
    reviewers: keys.reviewers === true ? queryValues(query.reviewer) : [],
    deadline: deadlineStates(query.deadline, keys.deadlines ?? []),
    text: joinTerms(queryValues(query.q).flatMap(splitTerms)),
    ext: Object.fromEntries(
      FILTER_EXTENSIONS.map(({ param }) => [param, queryValues(query[param])]).filter(
        ([, values]) => (values as string[]).length > 0,
      ),
    ),
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
  put("reviewer", filter.reviewers);
  put(
    "deadline",
    filter.deadline.map((state) => state.toLowerCase()),
  );
  for (const { param } of FILTER_EXTENSIONS) put(param, filter.ext[param] ?? []);
  const terms = splitTerms(filter.text);
  if (terms.length > 0) query.q = [joinTerms(terms)];
  return query;
}

/**
 * The filter as the issue listing's query takes it; empty keys are omitted,
 * not sent empty.
 *
 * One function per noun, each writing only its own input's keys, because the
 * API refuses the other noun's rather than matching nothing (spec 04 §4.3).
 */
export function toIssueFilter(filter: FilterState): IssueFilter {
  const issueFilter: IssueFilter = sharedFilter(filter);
  // `queryToFilter` already keeps only the listing's statuses; this narrows
  // the type, and drops a `MERGED` the API would refuse on an issue.
  const status = filter.status.filter((value): value is IssueStatus => value !== "MERGED");
  if (status.length > 0) issueFilter.status = status;
  if (filter.deadline.length > 0) issueFilter.deadline = [...filter.deadline];
  return issueFilter;
}

/** The pull request half of `toIssueFilter`. */
export function toPrFilter(filter: FilterState): PrFilter {
  const prFilter: PrFilter = sharedFilter(filter);
  if (filter.status.length > 0) prFilter.status = [...filter.status];
  if (filter.reviewers.length > 0) prFilter.reviewers = [...filter.reviewers];
  return prFilter;
}

/** The keys both nouns have, which is most of them; `status` differs in type. */
function sharedFilter(filter: FilterState): Omit<IssueFilter & PrFilter, "status"> {
  const shared: Omit<IssueFilter & PrFilter, "status"> = {};
  if (filter.labels.length > 0) shared.labels = [...filter.labels];
  if (filter.assignees.length > 0) shared.assignees = [...filter.assignees];
  if (filter.authors.length > 0) shared.authors = [...filter.authors];
  if (filter.milestones.length > 0) shared.milestones = [...filter.milestones];
  for (const { param, apiField } of FILTER_EXTENSIONS) {
    const values = filter.ext[param] ?? [];
    // Cast because the field is one a plugin's SDL added: the generated type
    // describes the core schema, and cannot know about it.
    if (values.length > 0) (shared as Record<string, unknown>)[apiField] = [...values];
  }
  const terms = splitTerms(filter.text);
  if (terms.length > 0) shared.text = terms;
  return shared;
}
