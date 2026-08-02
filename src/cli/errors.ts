/**
 * Exit codes — spec 04 §4.2: 0 success, 1 operational error, 2 format violation.
 */

export type ExitCode = 0 | 1 | 2;

export class NavError extends Error {
  readonly exitCode: ExitCode;
  /** Extra lines printed under the message, e.g. candidate IDs. */
  readonly details: string[];

  constructor(message: string, opts: { exitCode?: ExitCode; details?: string[] } = {}) {
    super(message);
    this.name = "NavError";
    this.exitCode = opts.exitCode ?? 1;
    this.details = opts.details ?? [];
  }
}

/** An operational error: not found, ambiguous, malformed input (exit 1). */
export function fail(message: string, details: string[] = []): never {
  throw new NavError(message, { exitCode: 1, details });
}

/** A format violation detected by `doctor` (exit 2). */
export function failFormat(message: string, details: string[] = []): never {
  throw new NavError(message, { exitCode: 2, details });
}
