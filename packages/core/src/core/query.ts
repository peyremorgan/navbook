/**
 * Query grammar for `nav issue list` / `nav pr list` — spec 04.
 *
 * Terms AND together. Within a single key the semantics follow the field:
 * single-valued fields (`status`, `author`, `milestone`) OR their terms, since
 * requiring two different values at once could never match; multi-valued fields
 * (`label`, `assignee`, `feature`) AND theirs, matching forge convention.
 */

import { readAssignees, readFeatures, readLabels } from "./files.ts";
import { personMatches } from "./person.ts";
import type { EntityKind, EntityRecord, Status } from "./tree.ts";

export interface Query {
  status: string[];
  labels: string[];
  assignees: string[];
  authors: string[];
  milestones: string[];
  features: string[];
  text: string[];
}

export interface QueryError {
  message: string;
}

const KEYED_TERM = /^(status|label|assignee|author|milestone|feature):(.*)$/;

export function emptyQuery(): Query {
  return {
    status: [],
    labels: [],
    assignees: [],
    authors: [],
    milestones: [],
    features: [],
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
    const key = match[1] as string;
    const value = (match[2] as string).trim();
    if (value === "") return { message: `query term '${term}' is missing a value` };
    switch (key) {
      case "status": {
        const allowed = kind === "issue" ? ["open", "closed"] : ["open", "merged", "closed"];
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
      default:
        query.milestones.push(value);
        break;
    }
  }
  return query;
}

export function isQueryError(value: Query | QueryError): value is QueryError {
  return (value as QueryError).message !== undefined;
}

/** True when evaluating the query requires reading comment bodies. */
export function needsComments(query: Query): boolean {
  return query.text.length > 0;
}

/** Evaluate a query against one entity. */
export function matchesQuery(query: Query, entity: EntityRecord): boolean {
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

  if (query.milestones.length > 0) {
    const milestone = typeof entity.fm.milestone === "string" ? entity.fm.milestone : "";
    if (!query.milestones.some((wanted) => wanted === milestone)) return false;
  }

  for (const needle of query.text) {
    if (!matchesText(needle.toLowerCase(), entity)) return false;
  }
  return true;
}

function matchesText(needle: string, entity: EntityRecord): boolean {
  if (entity.title.toLowerCase().includes(needle)) return true;
  if (entity.body.toLowerCase().includes(needle)) return true;
  return entity.comments.some((comment) => comment.body.toLowerCase().includes(needle));
}
