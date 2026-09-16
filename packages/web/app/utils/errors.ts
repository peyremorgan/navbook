/**
 * Reading what the server said, and saying it back.
 *
 * Every failure the API reports carries `extensions.code` and, often, a
 * `details` list written for a person (see `packages/server/src/errors.ts`).
 * The server's own message is the best sentence anyone here could write — it
 * names the issue, the branch, the parent — so it is shown verbatim, and the
 * code only chooses the short heading above it.
 *
 * That is a deliberate stance rather than laziness: a conflict or a rejected
 * push is reported to the person who caused it, not smoothed into "something
 * went wrong" (spec 06 §6.3). Codes a caller says it will handle never reach
 * this file's toast at all.
 */

/** A failure flattened out of whatever Apollo threw. */
export interface ApiFailure {
  /** `extensions.code`, or null for a transport failure with no GraphQL body. */
  code: string | null;
  message: string;
  details: string[];
  extensions: Record<string, unknown>;
}

const HEADINGS: Record<string, string> = {
  ALREADY_EXISTS: "Already exists",
  AMBIGUOUS: "That prefix matches more than one",
  AMBIGUOUS_ROOT: "The server's repository is ambiguous",
  BAD_ENV: "The server is misconfigured",
  DESTINATION_EXISTS: "Something is already there",
  FRONTMATTER: "The file's frontmatter is not valid",
  GIT_ERROR: "A git command failed on the server",
  IDS_EXHAUSTED: "Could not mint an identifier",
  INVALID_INPUT: "That will not do",
  MERGE_AMBIGUOUS: "The merge is ambiguous",
  MERGE_CONFLICT: "The merge conflicts",
  MERGE_UNRESOLVED: "The merge is unresolved",
  MINT_FAILED: "Could not mint an identifier",
  MISSING_PATH: "The file is missing",
  NOT_A_GIT_REPO: "The server's repository is not a git repository",
  NOT_A_NAVBOOK_REPO: "The server's repository has no Navbook tree",
  NOT_FOUND: "Not found",
  PRECONDITION: "Not from here",
  PREFIX_TOO_SHORT: "That prefix is too short",
  REPARENT_REQUIRED: "It already has a parent",
  STALE_CONTENT: "Changed since you opened it",
  SYNC_CONFLICT: "The server's clone conflicts with the remote",
  SYNC_FAILED: "The server could not synchronise its clone",
  SYNC_PUSH_REJECTED: "The remote refused the push",
  UNAUTHENTICATED: "Not signed in",
  UNRELATED_STAGED: "The server's clone has unrelated staged changes",
  WRONG_KIND: "That is the other kind of thing",
};

/** The heading shown above the server's own sentence. */
export function errorHeading(code: string | null): string {
  if (code === null) return "The server could not be reached";
  return HEADINGS[code] ?? "The operation failed";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * The first GraphQL error in whatever was thrown, flattened.
 *
 * Apollo wraps errors differently depending on where they came from — a
 * transport failure, a GraphQL body, a thrown link — so this takes `unknown`
 * and digs, rather than making every call site know which it caught.
 */
export function describeApiError(error: unknown): ApiFailure {
  const record = asRecord(error);
  const graphQLErrors = record ? stringKeyedArray(record.graphQLErrors) : [];
  const first = asRecord(graphQLErrors[0]) ?? (record?.extensions ? record : null);

  if (first) {
    const extensions = asRecord(first.extensions) ?? {};
    const code = typeof extensions.code === "string" ? extensions.code : null;
    return {
      code,
      message: typeof first.message === "string" ? first.message : "the operation failed",
      details: stringList(extensions.details),
      extensions,
    };
  }

  const networkError = asRecord(record?.networkError);
  const message =
    (typeof networkError?.message === "string" ? networkError.message : undefined) ??
    (typeof record?.message === "string" ? record.message : undefined) ??
    String(error);
  return { code: null, message, details: [], extensions: {} };
}

function stringKeyedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** True when the failure means the token is missing, expired or refused. */
export function isUnauthenticated(failure: ApiFailure): boolean {
  return failure.code === "UNAUTHENTICATED";
}

/** The parent a `REPARENT_REQUIRED` refusal named, for the consent dialog. */
export function reparentConflict(
  failure: ApiFailure,
): { currentParentId: string; currentParentTitle: string | null } | null {
  if (failure.code !== "REPARENT_REQUIRED") return null;
  const currentParentId = failure.extensions.currentParentId;
  if (typeof currentParentId !== "string") return null;
  const title = failure.extensions.currentParentTitle;
  return { currentParentId, currentParentTitle: typeof title === "string" ? title : null };
}

/**
 * The branch a pull request lives on, when commenting was refused because this
 * server does not have it checked out.
 */
export function unservedBranch(failure: ApiFailure): string | null {
  if (failure.code !== "PRECONDITION") return null;
  const ref = failure.extensions.sourceRef;
  return typeof ref === "string" ? ref : null;
}

/**
 * The fields a `STALE_CONTENT` refusal of an entity patch said had moved.
 *
 * Named as the mutation's input names them (`body`, `assignees`), so a page can
 * say which of its fields somebody else changed. A stale refusal that names
 * none — the feature and document saves, which are per file — reads as an
 * empty list rather than as not stale.
 */
export function staleEdit(failure: ApiFailure): { message: string; moved: string[] } | null {
  if (failure.code !== "STALE_CONTENT") return null;
  return { message: failure.message, moved: stringList(failure.extensions.moved) };
}
