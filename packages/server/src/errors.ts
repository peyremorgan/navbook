/**
 * Turning what the operation layer raises into what a client is told.
 *
 * `WorkspaceError` carries a machine-readable code and no notion of how failure
 * is reported: the CLI makes it a message and an exit code, and this makes it a
 * GraphQL error with the same code in `extensions` (spec 04 §4.2). The mapping
 * is exhaustive by construction — a new code in `core` stops typechecking here
 * until it is given a name.
 */

import { GitError, WorkspaceError, type WorkspaceErrorCode } from "@navbook/core";
import { GraphQLError } from "graphql";

const CODES: Record<WorkspaceErrorCode, string> = {
  "not-a-git-repo": "NOT_A_GIT_REPO",
  "not-a-navbook-repo": "NOT_A_NAVBOOK_REPO",
  "already-exists": "ALREADY_EXISTS",
  "prefix-too-short": "PREFIX_TOO_SHORT",
  "not-found": "NOT_FOUND",
  ambiguous: "AMBIGUOUS",
  "wrong-kind": "WRONG_KIND",
  "missing-path": "MISSING_PATH",
  "destination-exists": "DESTINATION_EXISTS",
  "invalid-input": "INVALID_INPUT",
  precondition: "PRECONDITION",
  "unrelated-staged": "UNRELATED_STAGED",
  frontmatter: "FRONTMATTER",
  "merge-conflict": "MERGE_CONFLICT",
  "merge-unresolved": "MERGE_UNRESOLVED",
  "merge-ambiguous": "MERGE_AMBIGUOUS",
  "bad-env": "BAD_ENV",
  "ids-exhausted": "IDS_EXHAUSTED",
  "mint-failed": "MINT_FAILED",
};

/** The `extensions.code` a workspace error is reported under. */
export function extensionCode(code: WorkspaceErrorCode): string {
  return CODES[code];
}

/** A client-facing error with a code, and whatever else is worth saying. */
export function apiError(
  message: string,
  code: string,
  extensions: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, { extensions: { code, ...extensions } });
}

/** No usable token, whatever the reason; the reason itself is never disclosed. */
export function unauthenticated(message: string): GraphQLError {
  return apiError(message, "UNAUTHENTICATED", { http: { status: 401 } });
}

/** Input this schema accepts but the format does not. */
export function invalidInput(message: string, details: readonly string[] = []): GraphQLError {
  return apiError(message, "INVALID_INPUT", details.length > 0 ? { details } : {});
}

/**
 * Run an operation, reporting what it raises as a GraphQL error.
 *
 * Errors that already carry a code pass through untouched, so a resolver can
 * raise its own (`REPARENT_REQUIRED`, the sync errors) without this needing to
 * know about it. Anything unrecognised is left to Yoga to mask: an unexpected
 * failure is a bug, and its message is not the client's business.
 */
export function translate(error: unknown): unknown {
  if (error instanceof GraphQLError) return error;
  if (error instanceof WorkspaceError) {
    return apiError(error.message, extensionCode(error.code), {
      ...(error.details.length > 0 ? { details: error.details } : {}),
    });
  }
  if (error instanceof GitError) {
    return apiError(error.message, "GIT_ERROR");
  }
  return error;
}

/** Wrap a resolver body so everything it raises is translated. */
export async function run<T>(body: () => Promise<T> | T): Promise<T> {
  try {
    return await body();
  } catch (error) {
    throw translate(error);
  }
}
