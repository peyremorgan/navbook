/**
 * The one place GraphQL's vocabulary and the format's are translated.
 *
 * They differ in exactly two ways, and both are conventions rather than
 * disagreements: GraphQL enums are SCREAMING_CASE where the files are lowercase
 * (`request-changes` could not be an enum value at all), and a filter is a
 * structured input where the CLI takes query terms. Keeping both translations
 * here means a resolver never does either by hand.
 */

import {
  type Verdict as CoreVerdict,
  type EntityKind,
  emptyQuery,
  type Query,
  type Status,
} from "@navbook/core";
import type {
  DiagnosticLevel,
  EntityFilter,
  Status as GqlStatus,
  Kind,
  Verdict,
} from "../generated/resolver-types.ts";

const STATUS_OUT: Record<Status, GqlStatus> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};
const STATUS_IN: Record<GqlStatus, Status> = {
  OPEN: "open",
  CLOSED: "closed",
  MERGED: "merged",
};

const KIND_OUT: Record<EntityKind, Kind> = { issue: "ISSUE", pr: "PR" };
const KIND_IN: Record<Kind, EntityKind> = { ISSUE: "issue", PR: "pr" };

const VERDICT_OUT: Record<CoreVerdict, Verdict> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
};
const VERDICT_IN: Record<Verdict, CoreVerdict> = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
};

export const toGqlStatus = (status: Status): GqlStatus => STATUS_OUT[status];
export const toCoreStatus = (status: GqlStatus): Status => STATUS_IN[status];
export const toGqlKind = (kind: EntityKind): Kind => KIND_OUT[kind];
export const toCoreKind = (kind: Kind): EntityKind => KIND_IN[kind];
export const toCoreVerdict = (verdict: Verdict): CoreVerdict => VERDICT_IN[verdict];
export const toGqlLevel = (level: "error" | "warning"): DiagnosticLevel =>
  level === "error" ? "ERROR" : "WARNING";

/** A stored `verdict`, when it is one the format defines. */
export function toGqlVerdict(value: unknown): Verdict | null {
  return typeof value === "string" && value in VERDICT_OUT
    ? VERDICT_OUT[value as CoreVerdict]
    : null;
}

/**
 * A filter as `core` asks for it.
 *
 * Built directly rather than through `parseQuery`, whose job is to interpret
 * `label:bug` typed at a shell. A GraphQL client has structure already, and
 * round-tripping it through a string could only lose some.
 */
export function toQuery(filter: EntityFilter | null | undefined): Query {
  const query = emptyQuery();
  if (!filter) return query;
  if (filter.status) query.status = filter.status.map(toCoreStatus);
  if (filter.labels) query.labels = [...filter.labels];
  if (filter.assignees) query.assignees = [...filter.assignees];
  if (filter.authors) query.authors = [...filter.authors];
  if (filter.milestones) query.milestones = [...filter.milestones];
  if (filter.text) query.text = [...filter.text];
  return query;
}
