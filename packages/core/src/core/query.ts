/**
 * Query grammar for `nav issue list` / `nav pr list` — spec 04.
 *
 * Terms AND together. Within a single key the semantics follow the field:
 * single-valued fields OR their terms, since requiring two different values at
 * once could never match; multi-valued fields AND theirs, matching forge
 * convention. Which is which is `QUERY_TERMS`'s `combines`, below.
 */

import { readAssignees, readDeadline, readFeatures, readLabels, readReviewers } from "./files.ts";
import { personMatches } from "./person.ts";
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from "./policy.ts";
import { isAwaiting, REVIEW_DECISIONS, type ReviewDecision, reviewSummary } from "./review.ts";
import type { EntityKind, EntityRecord, Status } from "./tree.ts";

export interface Query {
  status: string[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  features: string[];
  /** `reviewer:` — who the pull request asks for a review (spec 02 §2.7). */
  reviewers: string[];
  /** `review:` — the decision the reviews add up to. */
  reviews: ReviewDecision[];
  /** `awaiting:` — who is asked and has not answered on the latest revision. */
  awaiting: string[];
  /** `deadline:` — where the issue stands against its due date (spec 02 §2.5). */
  deadline: DeadlineTerm[];
  /**
   * The day `overdue` is judged against, `YYYY-MM-DD`.
   *
   * Core has no clock, so the caller that has one supplies it: the CLI from
   * the workspace, which is what carries `NAV_NOW` into a fixture, and the
   * server from its own. A query that never asks `overdue` never needs it.
   */
  today: string | null;
  text: string[];
}

/** What `deadline:` can ask (spec 04 §4.3). */
export const DEADLINE_TERMS = ["overdue", "none"] as const;
export type DeadlineTerm = (typeof DEADLINE_TERMS)[number];

export interface QueryError {
  message: string;
}

/** The keys of the query grammar (spec 04 §4.3). */
export type QueryKey =
  | "status"
  | "label"
  | "assignee"
  | "author"
  | "milestone"
  | "feature"
  | "reviewer"
  | "review"
  | "awaiting"
  | "deadline";

/** One keyed term of the query grammar (spec 04 §4.3). */
export type QueryTerm = {
  key: QueryKey;
  /** How several terms of this key combine: see the head of this file. */
  combines: "and" | "or";
} & (
  | { only?: undefined }
  | {
      /** The one noun that has the field. */
      only: EntityKind;
      /** What the other noun has none of, in the words its refusal uses. */
      lacks: string;
    }
);

/**
 * Every keyed term the parser accepts, in the order help lists them.
 *
 * The one list the parser, `--help` and shell completion all read, so a term
 * added here cannot reach one of them and miss another. `deadline` is
 * single-valued, so it ORs: asking for both the overdue and the undated is a
 * question with an answer.
 */
export const QUERY_TERMS: readonly QueryTerm[] = [
  { key: "status", combines: "or" },
  { key: "label", combines: "and" },
  { key: "assignee", combines: "and" },
  { key: "author", combines: "or" },
  { key: "milestone", combines: "or" },
  { key: "feature", combines: "and" },
  { key: "reviewer", only: "pr", lacks: "reviews", combines: "and" },
  { key: "review", only: "pr", lacks: "reviews", combines: "or" },
  { key: "awaiting", only: "pr", lacks: "reviews", combines: "and" },
  { key: "deadline", only: "issue", lacks: "deadline", combines: "or" },
];

/** The terms a query over one noun accepts; the rest it refuses. */
export function queryTermsFor(kind: EntityKind): QueryTerm[] {
  return QUERY_TERMS.filter((term) => term.only === undefined || term.only === kind);
}

/** What `status:` can ask of each noun: the directories it has (spec 02 §2.1). */
export const QUERY_STATUSES: Readonly<Record<EntityKind, readonly string[]>> = {
  issue: ["open", "closed"],
  pr: ["open", "closed", "merged"],
};

const TERM_BY_KEY = new Map(QUERY_TERMS.map((term) => [term.key, term]));

// Every key is `[a-z]+`, so none needs escaping in the alternation.
const KEYED_TERM = new RegExp(`^(${QUERY_TERMS.map((term) => term.key).join("|")}):(.*)$`);

export function emptyQuery(): Query {
  return {
    status: [],
    labels: [],
    assignees: [],
    authors: [],
    milestones: [],
    features: [],
    reviewers: [],
    reviews: [],
    awaiting: [],
    deadline: [],
    today: null,
    text: [],
  };
}

/**
 * Statuses the CLI's `list` commands default to when the query names none.
 *
 * A query is status-neutral on its own — `matchesQuery` filters by status only
 * when one is named — so this default belongs to the CLI, which applies it in
 * `parseListQuery`. Other callers, the GraphQL API among them, get every
 * status when they ask for none (spec 04 §4.3).
 */
export function defaultStatuses(): Status[] {
  return ["open"];
}

/** Parse query terms. Unknown `key:value` shapes are treated as free text. */
export function parseQuery(terms: readonly string[], kind: EntityKind): Query | QueryError {
  const query = emptyQuery();
  for (const term of terms) {
    if (term.trim() === "") continue;
    const match = KEYED_TERM.exec(term);
    if (!match) {
      query.text.push(term);
      continue;
    }
    const key = match[1] as QueryKey;
    const value = (match[2] as string).trim();
    if (value === "") return { message: `query term '${term}' is missing a value` };
    const known = TERM_BY_KEY.get(key);
    if (known?.only !== undefined && known.only !== kind) {
      return {
        message:
          known.only === "pr"
            ? `'${key}:' describes a pull request; issues have no ${known.lacks}`
            : `'${key}:' describes an issue; pull requests have no ${known.lacks}`,
      };
    }
    switch (key) {
      case "status": {
        const allowed = QUERY_STATUSES[kind];
        if (!allowed.includes(value)) {
          return {
            message: `unknown status '${value}' for ${kind === "issue" ? "issues" : "pull requests"} (expected ${allowed.join(", ")})`,
          };
        }
        query.status.push(value);
        break;
      }
      case "label":
        query.labels.push(value);
        break;
      case "assignee":
        query.assignees.push(value);
        break;
      case "author":
        query.authors.push(value);
        break;
      case "feature":
        query.features.push(value);
        break;
      case "reviewer":
        query.reviewers.push(value);
        break;
      case "review": {
        if (!(REVIEW_DECISIONS as readonly string[]).includes(value)) {
          return {
            message: `unknown review decision '${value}' (expected ${REVIEW_DECISIONS.join(", ")})`,
          };
        }
        query.reviews.push(value as ReviewDecision);
        break;
      }
      case "awaiting":
        query.awaiting.push(value);
        break;
      case "deadline": {
        if (!(DEADLINE_TERMS as readonly string[]).includes(value)) {
          return {
            message: `unknown deadline term '${value}' (expected ${DEADLINE_TERMS.join(", ")})`,
          };
        }
        query.deadline.push(value as DeadlineTerm);
        break;
      }
      case "milestone":
        query.milestones.push(value);
        break;
      default: {
        // A key in `QUERY_TERMS` that no case reads: typing makes this unreachable.
        const unread: never = key;
        throw new Error(`query key '${unread}' has no parser`);
      }
    }
  }
  return query;
}

export function isQueryError(value: Query | QueryError): value is QueryError {
  return (value as QueryError).message !== undefined;
}

/**
 * True when evaluating the query requires the entity's comments to be loaded.
 *
 * A text search reads their bodies; `review:` and `awaiting:` read the verdicts
 * in their frontmatter, since that is where a review lives (spec 02 §2.6).
 */
export function needsComments(query: Query): boolean {
  return query.text.length > 0 || query.reviews.length > 0 || query.awaiting.length > 0;
}

/**
 * Evaluate a query against one entity.
 *
 * `policy` is only consulted by the derived terms (`review:` and `awaiting:`),
 * which read the same summary every other surface reads, so a listing and a
 * `show` of the same pull request can never disagree about it (spec 02 §2.10).
 */
export function matchesQuery(
  query: Query,
  entity: EntityRecord,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): boolean {
  if (query.status.length > 0 && !query.status.includes(entity.status)) return false;

  const labels = readLabels(entity.fm).map((l) => l.toLowerCase());
  for (const wanted of query.labels) {
    if (!labels.includes(wanted.toLowerCase())) return false;
  }

  const assignees = readAssignees(entity.fm);
  for (const wanted of query.assignees) {
    if (!assignees.some((a) => personMatches(wanted, a))) return false;
  }

  if (query.authors.length > 0) {
    const author = typeof entity.fm.author === "string" ? entity.fm.author : "";
    if (!query.authors.some((wanted) => personMatches(wanted, author))) return false;
  }

  // Slugs are lowercase by grammar, so folding case here only forgives a query
  // typed with a capital; it can never widen what a well-formed tree matches.
  const features = readFeatures(entity.fm).map((f) => f.toLowerCase());
  for (const wanted of query.features) {
    if (!features.includes(wanted.toLowerCase())) return false;
  }

  if (query.deadline.length > 0 && !matchesDeadline(query, entity)) return false;

  const reviewers = readReviewers(entity.fm);
  for (const wanted of query.reviewers) {
    if (!reviewers.some((person) => personMatches(wanted, person))) return false;
  }

  // Derived, so it costs a read of the comments — which is why `needsComments`
  // names these two terms alongside a text search.
  if (query.reviews.length > 0 || query.awaiting.length > 0) {
    const summary = reviewSummary(entity, policy);
    if (query.reviews.length > 0 && !query.reviews.includes(summary.decision)) return false;
    for (const wanted of query.awaiting) {
      if (!isAwaiting(summary, wanted)) return false;
    }
  }

  if (query.milestones.length > 0) {
    const milestone = typeof entity.fm.milestone === "string" ? entity.fm.milestone : "";
    if (!query.milestones.some((wanted) => wanted === milestone)) return false;
  }

  for (const needle of query.text) {
    if (!matchesText(needle.toLowerCase(), entity)) return false;
  }
  return true;
}

/**
 * Where an issue stands against its deadline (spec 02 §2.5).
 *
 * The terms OR, as `QUERY_TERMS` declares: asking for both the overdue and
 * the undated is a question with an answer, unlike two labels naming
 * different things.
 *
 * A query that asks `overdue` without a day to judge it against is a caller
 * that forgot to supply one, and it is told so. Matching nothing would be a
 * listing that looks answered and is not.
 */
function matchesDeadline(query: Query, entity: EntityRecord): boolean {
  const deadline = readDeadline(entity.fm);
  return query.deadline.some((term) => {
    if (term === "none") return deadline === null;
    if (query.today === null) {
      throw new Error("'deadline:overdue' needs the day to judge it against");
    }
    // Strict: work wanted today is wanted today, and is not yet late.
    return deadline !== null && deadline < query.today;
  });
}

function matchesText(needle: string, entity: EntityRecord): boolean {
  if (matchesIdentifier(needle, entity)) return true;
  if (entity.title.toLowerCase().includes(needle)) return true;
  if (entity.body.toLowerCase().includes(needle)) return true;
  return entity.comments.some((comment) => comment.body.toLowerCase().includes(needle));
}

/**
 * The shortest partial ID any surface accepts (spec 02 §2.2).
 *
 * It is a floor here rather than a rule about ambiguity: it is what keeps an
 * ordinary word search from reaching an ID it did not mean.
 */
const ID_PREFIX_FLOOR = 4;

/**
 * True when a bare term names the entity itself rather than something it says.
 *
 * Without this the one identifier every entity is guaranteed to have is the
 * one thing it cannot be found by, and searching an ID finds every entity that
 * *mentioned* it and never the entity itself (spec 04 §4.3).
 *
 * The term is matched as a prefix of the directory name, which is `<id>-<slug>`
 * (spec 02 §2.3), so the same test accepts both spellings a reader has to hand:
 * the partial ID of length >= 4 that every other surface takes, and the whole
 * directory name they copied out of a path. Anchoring it at the start is what
 * makes it quiet — a term can only reach an entity whose ID it names from the
 * first character, so no ordinary word search changes what it returns unless
 * that word happens to open an ID.
 *
 * Ambiguity is not an error as it is for an ID *argument*: a filter matching
 * two entities lists two rows, which is what a listing is for.
 *
 * A leading `#` is optional because that is how every mention of an ID is
 * written, and so what gets pasted into a search box.
 */
function matchesIdentifier(needle: string, entity: EntityRecord): boolean {
  const wanted = needle.startsWith("#") ? needle.slice(1) : needle;
  if (wanted.length < ID_PREFIX_FLOOR) return false;
  return entity.dirName.toLowerCase().startsWith(wanted);
}
