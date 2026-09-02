/**
 * What each GraphQL type is resolved *from*.
 *
 * Codegen types every resolver against these, so a field resolver receives the
 * core record itself rather than a shape somebody had to build first. That is
 * what keeps the resolvers a projection of `@navbook/core` instead of a second
 * model of the same data.
 */

import type { CommentRecord, Diagnostic, EntityRecord, LinkNode } from "@navbook/core";

export type IssueParent = EntityRecord;

/**
 * A pull request, and the branches it was found on.
 *
 * The refs come from the cross-ref scan and are empty for a working-tree read,
 * so the wrapper is what lets one resolver serve both (spec 03 §3.5). Short
 * names only: which ref file a branch came from is not the client's business.
 */
export interface PrParent {
  entity: EntityRecord;
  refs: readonly string[];
}

export type CommentParent = CommentRecord;
export type LinkNodeParent = LinkNode;
export type DiagnosticParent = Diagnostic;

/** Either kind, as `Entity` and `AddCommentPayload.entity` return it. */
export type EntityParent = IssueParent | PrParent;

/** The pull-request wrapper, for a resolver handed either kind. */
export function isPrParent(parent: EntityParent): parent is PrParent {
  return "entity" in parent;
}

/** The underlying record, whichever shape the parent has. */
export function recordOf(parent: EntityParent): EntityRecord {
  return isPrParent(parent) ? parent.entity : parent;
}
