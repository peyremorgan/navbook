/**
 * The policies a marker declares — spec 02 §2.10 — and the extensions it
 * names (§2.12).
 *
 * The two policies are the things in `navbook.json` a tool reads rather than
 * merely finds. The review policy says how the reviews of §2.7 are counted: whether a
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

/* ------------------------------------------------------ plugin declaration */

/**
 * What a repository says its tree contains — spec 02 §2.12.
 *
 * Data about the tree, never instruction to a tool: a name here is read to
 * report what is missing, and is never permission to fetch or execute
 * anything. That rule lives in the tool; what lives here is the shape.
 */
export interface PluginDeclaration {
  /**
   * Each extension's name for itself, and the settings it carries.
   *
   * A null-prototype object, so that only a declared name is found in it:
   * `plugins.toString` is undefined, and a plugin named `__proto__` is an
   * entry like any other.
   */
  plugins: Record<string, Record<string, unknown>>;
}

/** A marker read for its plugin declaration: what it names, and what was wrong with it. */
export interface PluginReading {
  /** The declared extensions, with any entry that is not usable left out. */
  declaration: PluginDeclaration;
  /** True when the marker carries a usable `plugins` object. */
  declared: boolean;
  /** One message per fault, in key order; empty when there is nothing wrong. */
  problems: string[];
}

/**
 * Read the plugin declaration out of a marker's text.
 *
 * The third of the marker's readings, and the mirror image of the other two:
 * same fallbacks, same refusal to throw, same faults returned to be reported
 * under D15. §2.12 has a malformed declaration read "exactly as a malformed
 * review policy is", whose keys fall back independently (§2.10), so an entry
 * falls back on its own to not being declared: one mistyped entry costs that
 * entry and no other.
 *
 * Only the shape is checked. The key is the extension's own name for itself —
 * an npm package name here — and §2.12 leaves its grammar to whoever names
 * extensions, so it is not held to the short-name grammar of a namespace; it
 * must only be a name, which the empty string is not. What the settings hold
 * is the extension's business, checked under its own `X-<short>-<n>` codes
 * (spec 04 §4.3) if at all.
 *
 * Every call returns objects of its own, so a caller that adds to the
 * declaration it was handed changes no other reading.
 */
export function parsePluginDeclaration(markerText: string | undefined): PluginReading {
  if (markerText === undefined) return nothingDeclared();

  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    return nothingDeclared(["is not valid JSON"]);
  }
  if (!isPlainObject(marker)) return nothingDeclared(["is not a JSON object"]);

  const declared = marker.plugins;
  if (declared === undefined) return nothingDeclared();
  if (!isPlainObject(declared)) return nothingDeclared(["'plugins' must be an object"]);

  const problems: string[] = [];
  const plugins = emptyPlugins();
  for (const [name, settings] of Object.entries(declared)) {
    // The name is JSON-quoted, since a package name carries the `/` and `.` a
    // key path would, and any quote of its own comes out escaped.
    if (name === "") problems.push(`'plugins' entry "" must name an extension`);
    else if (!isPlainObject(settings)) {
      problems.push(`'plugins' entry ${JSON.stringify(name)} must be an object`);
    } else plugins[name] = settings;
  }
  return { declaration: { plugins }, declared: true, problems };
}

function nothingDeclared(problems: string[] = []): PluginReading {
  return { declaration: { plugins: emptyPlugins() }, declared: false, problems };
}

function emptyPlugins(): Record<string, Record<string, unknown>> {
  return Object.create(null) as Record<string, Record<string, unknown>>;
}
