/**
 * The policies a marker declares — spec 02 §2.10.
 *
 * These are the two things in `navbook.json` a tool reads rather than merely
 * finds, beside the format `version` the marker claims to be written to. The review policy says how the reviews of §2.7 are counted: whether a
 * pull request's own author is among its reviewers, and how many approvals a
 * decision of `approved` takes. The merge policy says what shape a merge
 * leaves in the target branch's history.
 *
 * Both default to what the spec describes without them, so a repository that
 * declares neither — and one written before the keys existed — is read exactly
 * as it was, and both fall back per key rather than propagating a fault.
 *
 * Neither is a gate over a review state. A review policy changes what the
 * decision counts, and what a tool may say about it; it never changes what a
 * tool will do (§2.7). A merge method changes the history a merge writes, and
 * says nothing about reviews at all.
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

/* ---------------------------------------------------------- format version */

/** The one value of the marker's `version` this revision defines (§2.10). */
export const FORMAT_VERSION = 1;

/**
 * A marker's `version` this tool cannot take at its word (spec 02 §2.10).
 *
 * Two kinds, because only one of them is anybody's mistake, and they want
 * opposite things from the reader. `newer` is a whole number above
 * {@link FORMAT_VERSION}: the tree was written by a later Navbook than this
 * one, nothing is wrong with the file, and what the reader needs to hear is
 * that this tool is behind. `malformed` is every other way of not being the
 * integer the format is on, and is a file somebody has to edit.
 */
export interface MarkerVersionFault {
  kind: "newer" | "malformed";
  message: string;
}

/**
 * What this tool cannot take at its word in the marker's `version`, if
 * anything.
 *
 * §2.10 puts its MUST on the value and never on the key, so a marker that
 * carries no `version` is read as this revision rather than reported: a
 * repository predating the marker is still conforming, and one written by
 * hand should not have to repeat what it already is.
 *
 * Text that is not a JSON object is no fault of the version's and reads as
 * none: the policy readers already report it, and D15 would otherwise say so
 * twice. Returned rather than thrown, like every other fault in the marker.
 */
export function parseMarkerVersion(markerText: string | undefined): MarkerVersionFault | null {
  if (markerText === undefined) return null;

  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    return null;
  }
  if (!isPlainObject(marker) || marker.version === undefined) return null;

  const value = marker.version;
  if (value === FORMAT_VERSION) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > FORMAT_VERSION) {
    return {
      kind: "newer",
      message: `'version' is ${value} and this tool reads ${FORMAT_VERSION}: the tree was written by a newer Navbook; update nav`,
    };
  }
  return { kind: "malformed", message: `'version' must be the integer ${FORMAT_VERSION}` };
}

/** A declared policy in one line, for a tool that has room to say what it counts by. */
export function describeReviewPolicy(policy: ReviewPolicy): string {
  const approvals = policy.minApprovals === 1 ? "1 approval" : `${policy.minApprovals} approvals`;
  return `${approvals} required, self-review ${policy.selfReview ? "on" : "off"}`;
}

/* ------------------------------------------------------------ merge policy */

/**
 * How a pull request is landed on its target — spec 02 §2.10.
 *
 * Six shapes of history, not six ways of deciding whether to merge: the method
 * says what the target branch looks like afterwards, and nothing else. That is
 * why it sits outside §2.7 while the review policy above sits inside it, and
 * why `merge-ff` may refuse where no review state ever could.
 */
export type MergeMethod = "auto" | "merge" | "merge-ff" | "rebase" | "rebase-no-ff" | "squash";

/** Every method, in the order a message listing them should read. */
export const MERGE_METHODS: readonly MergeMethod[] = [
  "auto",
  "merge",
  "merge-ff",
  "rebase",
  "rebase-no-ff",
  "squash",
];

/** True for a name this revision defines. */
export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === "string" && (MERGE_METHODS as readonly string[]).includes(value);
}

/** True for the three methods that rewrite the source's commits rather than keep them. */
export function rewritesSource(method: MergeMethod): boolean {
  return method === "rebase" || method === "rebase-no-ff" || method === "squash";
}

/** What a repository lands its pull requests with. */
export interface MergePolicy {
  /** The method used when nothing overrides it for a single merge. */
  method: MergeMethod;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = { method: "auto" };

/** A marker read for its merge policy: what it asks for, and what was wrong with it. */
export interface MergePolicyReading {
  /** What to land by — the declared policy, with any unreadable key defaulted. */
  policy: MergePolicy;
  /** True when the marker carries a usable `merge` object. */
  declared: boolean;
  /** One message per fault, in key order; empty when there is nothing wrong. */
  problems: string[];
}

/** The reading of a repository that declares nothing, which is most of them. */
export const NO_MERGE_POLICY: MergePolicyReading = {
  policy: DEFAULT_MERGE_POLICY,
  declared: false,
  problems: [],
};

/**
 * Read the merge policy out of a marker's text.
 *
 * The twin of {@link parseReviewPolicy}, and deliberately its mirror image:
 * same fallbacks, same refusal to throw, same faults returned to be reported
 * under D15. A marker somebody mistyped should not stop them merging any more
 * than it should stop them listing — it should merge the way a repository that
 * declared nothing merges, and say so.
 */
export function parseMergePolicy(markerText: string | undefined): MergePolicyReading {
  if (markerText === undefined) return NO_MERGE_POLICY;

  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    return { policy: DEFAULT_MERGE_POLICY, declared: false, problems: ["is not valid JSON"] };
  }
  if (!isPlainObject(marker)) {
    return { policy: DEFAULT_MERGE_POLICY, declared: false, problems: ["is not a JSON object"] };
  }

  const merge = marker.merge;
  if (merge === undefined) return NO_MERGE_POLICY;
  if (!isPlainObject(merge)) {
    return {
      policy: DEFAULT_MERGE_POLICY,
      declared: false,
      problems: ["'merge' must be an object"],
    };
  }

  const problems: string[] = [];
  let { method } = DEFAULT_MERGE_POLICY;

  if (merge.method !== undefined) {
    if (isMergeMethod(merge.method)) method = merge.method;
    else problems.push(`'merge.method' must be one of ${MERGE_METHODS.join(", ")}`);
  }

  return { policy: { method }, declared: true, problems };
}

/** A method in one line, for a tool that has room to say how it will merge. */
export function describeMergeMethod(method: MergeMethod): string {
  return MERGE_METHOD_SUMMARIES[method];
}

const MERGE_METHOD_SUMMARIES: Record<MergeMethod, string> = {
  auto: "fast-forward where possible, otherwise a merge commit",
  merge: "always a merge commit",
  "merge-ff": "fast-forward only",
  rebase: "rebase, then fast-forward",
  "rebase-no-ff": "rebase, then a merge commit",
  squash: "squash into a single commit",
};
