/**
 * The review policy a marker declares — spec 02 §2.10.
 *
 * This is the one thing in `navbook.json` a tool reads rather than merely
 * finds. It says how the reviews of §2.7 are counted: whether a pull request's
 * own author is among its reviewers, and how many approvals a decision of
 * `approved` takes.
 *
 * The defaults are §2.7 without a policy, so a repository that declares none —
 * and one written before the key existed — is read exactly as it was.
 *
 * Nothing here is a gate. A policy changes what the decision counts, and what
 * a tool may say about it; it never changes what a tool will do (§2.7).
 */

/** How reviews are counted. */
export interface ReviewPolicy {
  /** Whether a pull request's own author is counted among its reviewers. */
  selfReview: boolean;
  /** How many approvals a decision of `approved` takes; at least 1. */
  minApprovals: number;
}

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = { selfReview: false, minApprovals: 1 };

/** A marker read for its policy: what it asks for, and what was wrong with it. */
export interface ReviewPolicyReading {
  /** What to count by — the declared policy, with any unreadable key defaulted. */
  policy: ReviewPolicy;
  /** True when the marker carries a usable `review` object, however partial. */
  declared: boolean;
  /** One message per fault, in key order; empty when there is nothing wrong. */
  problems: string[];
}

/** The reading of a repository that declares nothing, which is most of them. */
export const NO_REVIEW_POLICY: ReviewPolicyReading = {
  policy: DEFAULT_REVIEW_POLICY,
  declared: false,
  problems: [],
};

/** A plain JSON object — not an array, and not `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the review policy out of a marker's text.
 *
 * `undefined` is a repository with no marker at all, which §2.10 keeps
 * conforming; it declares nothing and has nothing wrong with it.
 *
 * Every fault falls back to a default rather than propagating: each key falls
 * back on its own, and text that is not a JSON object falls back to both. A
 * marker somebody mistyped should not stop them listing their pull requests,
 * so the faults are returned to be reported (check D15) rather than thrown.
 */
export function parseReviewPolicy(markerText: string | undefined): ReviewPolicyReading {
  if (markerText === undefined) return NO_REVIEW_POLICY;

  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    return { policy: DEFAULT_REVIEW_POLICY, declared: false, problems: ["is not valid JSON"] };
  }
  if (!isPlainObject(marker)) {
    return { policy: DEFAULT_REVIEW_POLICY, declared: false, problems: ["is not a JSON object"] };
  }

  const review = marker.review;
  if (review === undefined) return NO_REVIEW_POLICY;
  if (!isPlainObject(review)) {
    return {
      policy: DEFAULT_REVIEW_POLICY,
      declared: false,
      problems: ["'review' must be an object"],
    };
  }

  const problems: string[] = [];
  let { selfReview, minApprovals } = DEFAULT_REVIEW_POLICY;

  if (review.selfReview !== undefined) {
    if (typeof review.selfReview === "boolean") selfReview = review.selfReview;
    else problems.push("'review.selfReview' must be true or false");
  }

  if (review.minApprovals !== undefined) {
    const value = review.minApprovals;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) minApprovals = value;
    else problems.push("'review.minApprovals' must be a whole number of at least 1");
  }

  return { policy: { selfReview, minApprovals }, declared: true, problems };
}

/** A declared policy in one line, for a tool that has room to say what it counts by. */
export function describeReviewPolicy(policy: ReviewPolicy): string {
  const approvals = policy.minApprovals === 1 ? "1 approval" : `${policy.minApprovals} approvals`;
  return `${approvals} required, self-review ${policy.selfReview ? "on" : "off"}`;
}
