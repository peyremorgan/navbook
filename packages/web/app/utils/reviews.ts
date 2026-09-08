/**
 * Saying what a review policy counts, and how far a pull request is from it.
 *
 * The policy (spec 02 §2.10) is a property of the repository, so the client
 * asks for it once and reads it beside whichever pull request is on screen.
 * None of this decides anything: the server has already counted, and these
 * turn its numbers into the sentence a reader needs. The API exposes no merge
 * either, so there is nothing here for a policy to gate even in principle.
 */

import type { ReviewPolicyQuery } from "~~/src/generated/gql/graphql";

export type ReviewPolicy = ReviewPolicyQuery["reviewPolicy"];

/** Approvals as any pull request reports them. */
export interface Approvals {
  given: number;
  required: number;
}

/**
 * "1 of 2 approvals", or null when the count would say nothing.
 *
 * Only where more than one approval is wanted: "1 of 1" beside a decision is a
 * fact nobody was missing, and drawing it everywhere would make the number
 * that matters harder to spot rather than easier.
 */
export function approvalLabel(approvals: Approvals | null | undefined): string | null {
  if (!approvals || approvals.required <= 1) return null;
  return `${approvals.given} of ${approvals.required} approvals`;
}

/** The declared policy in one line, or null when none is declared. */
export function describePolicy(policy: ReviewPolicy | null | undefined): string | null {
  if (!policy?.declared) return null;
  const approvals = policy.minApprovals === 1 ? "1 approval" : `${policy.minApprovals} approvals`;
  return `Requires ${approvals} · self-review ${policy.selfReview ? "on" : "off"}`;
}
