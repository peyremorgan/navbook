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
  type ReviewDecision as CoreReviewDecision,
  type ReviewState as CoreReviewState,
  type Verdict as CoreVerdict,
  type DeadlineTerm,
  type EntityKind,
  emptyQuery,
  type Query,
  type Status,
} from "@navbook/core";
import type {
  DeadlineState,
  DiagnosticLevel,
  EntityFilter,
  Status as GqlStatus,
  Kind,
  ReviewDecision,
  ReviewState,
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

const DEADLINE_IN: Record<DeadlineState, DeadlineTerm> = { OVERDUE: "overdue", NONE: "none" };

const KIND_OUT: Record<EntityKind, Kind> = { issue: "ISSUE", pr: "PR" };
const KIND_IN: Record<Kind, EntityKind> = { ISSUE: "issue", PR: "pr" };

const VERDICT_OUT: Record<CoreVerdict, Verdict> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  comment: "COMMENT",
};
const VERDICT_IN: Record<Verdict, CoreVerdict> = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
  COMMENT: "comment",
};

const STATE_OUT: Record<CoreReviewState, ReviewState> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  commented: "COMMENTED",
  pending: "PENDING",
};
const DECISION_OUT: Record<CoreReviewDecision, ReviewDecision> = {
  approved: "APPROVED",
  "changes-requested": "CHANGES_REQUESTED",
  pending: "PENDING",
};
const DECISION_IN: Record<ReviewDecision, CoreReviewDecision> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  PENDING: "pending",
};

export const toGqlStatus = (status: Status): GqlStatus => STATUS_OUT[status];
export const toCoreStatus = (status: GqlStatus): Status => STATUS_IN[status];
export const toGqlKind = (kind: EntityKind): Kind => KIND_OUT[kind];
export const toCoreKind = (kind: Kind): EntityKind => KIND_IN[kind];
export const toCoreVerdict = (verdict: Verdict): CoreVerdict => VERDICT_IN[verdict];
export const toGqlReviewState = (state: CoreReviewState): ReviewState => STATE_OUT[state];
export const toGqlDecision = (decision: CoreReviewDecision): ReviewDecision =>
  DECISION_OUT[decision];
export const toGqlLevel = (level: "error" | "warning"): DiagnosticLevel =>
  level === "error" ? "ERROR" : "WARNING";

/**
 * A stored `verdict`, when it is one the format defines.
 *
 * `Object.hasOwn` rather than `in`: frontmatter is hand-editable, and `in`
 * would answer yes to `verdict: constructor` and hand back a function the
 * schema cannot serialize.
 */
export function toGqlVerdict(value: unknown): Verdict | null {
  return typeof value === "string" && Object.hasOwn(VERDICT_OUT, value)
    ? VERDICT_OUT[value as CoreVerdict]
    : null;
}

/**
 * A filter as `core` asks for it.
 *
 * Built directly rather than through `parseQuery`, whose job is to interpret
 * `label:bug` typed at a shell. A GraphQL client has structure already, and
 * round-tripping it through a string could only lose some.
 *
 * `today` is the day `OVERDUE` is judged against, and it is always supplied:
 * core has no clock, and a filter that asked which work is late without saying
 * when would be a question with no answer.
 */
export function toQuery(filter: EntityFilter | null | undefined, today: string): Query {
  const query = emptyQuery();
  query.today = today;
  if (!filter) return query;
  if (filter.status) query.status = filter.status.map(toCoreStatus);
  if (filter.labels) query.labels = [...filter.labels];
  if (filter.assignees) query.assignees = [...filter.assignees];
  if (filter.authors) query.authors = [...filter.authors];
  if (filter.milestones) query.milestones = [...filter.milestones];
  if (filter.features) query.features = [...filter.features];
  if (filter.reviewers) query.reviewers = [...filter.reviewers];
  if (filter.reviews) query.reviews = filter.reviews.map((decision) => DECISION_IN[decision]);
  if (filter.awaiting) query.awaiting = [...filter.awaiting];
  if (filter.deadline) query.deadline = filter.deadline.map((state) => DEADLINE_IN[state]);
  if (filter.text) query.text = [...filter.text];
  return query;
}
