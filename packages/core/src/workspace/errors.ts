/**
 * Errors raised by the workspace and operation layers.
 *
 * These carry a machine-readable {@link WorkspaceErrorCode} and no notion of
 * how a program reports failure: the CLI turns them into a message and an exit
 * code (spec 04 §4.2), and a server turns the same code into a status. Keeping
 * exit codes out of here is what lets both front ends share the layer.
 */

export type WorkspaceErrorCode =
  /* discovery */
  | "not-a-git-repo"
  | "not-a-navbook-repo"
  | "ambiguous-root"
  | "already-exists"
  /* resolution */
  | "prefix-too-short"
  | "not-found"
  | "ambiguous"
  | "wrong-kind"
  /* file operations */
  | "missing-path"
  | "destination-exists"
  /* input and state */
  | "invalid-input"
  | "precondition"
  | "unrelated-staged"
  | "frontmatter"
  /** The file changed since the caller last read it (spec 06 §6.3). */
  | "stale-content"
  /* merging */
  | "merge-conflict"
  | "merge-unresolved"
  | "merge-ambiguous"
  /* environment */
  | "bad-env"
  | "ids-exhausted"
  | "mint-failed";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  /** Extra lines a front end may show under the message, e.g. candidate IDs. */
  readonly details: string[];

  constructor(code: WorkspaceErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}

/** Throw a {@link WorkspaceError}; the `never` return keeps call sites terse. */
export function wsFail(code: WorkspaceErrorCode, message: string, details: string[] = []): never {
  throw new WorkspaceError(code, message, details);
}
