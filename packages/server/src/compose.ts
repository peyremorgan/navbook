/**
 * Composing the text of a new file from structured input.
 *
 * The operation layer takes a finished file, not a set of fields: composing is
 * the front end's job, and this is the server's half of it — the CLI's
 * equivalent is `cli/src/commands/compose.ts`, which fills an editor buffer.
 *
 * Clients never send frontmatter. That is what keeps the promise of spec 06
 * §6.3 that no Navbook logic ships to the browser: a web client that had to
 * compose a valid `issue.md` would be reimplementing the format.
 */

import { type ParsedFile, type Problem, parseFile } from "@navbook/core";
import { invalidInput } from "./errors.ts";

/**
 * Parse and validate a composed file, refusing it as input rather than letting
 * it reach the tree.
 *
 * A file this rejects was built from what a client sent, so every problem is
 * something the client can fix — which is why they are all reported at once.
 */
export function checkComposed(
  content: string,
  validate: (parsed: ParsedFile) => Problem[],
  noun: string,
): ParsedFile {
  let parsed: ParsedFile;
  try {
    parsed = parseFile(content);
  } catch (error) {
    throw invalidInput(`the ${noun} could not be composed`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const problems = validate(parsed);
  if (problems.length > 0) {
    throw invalidInput(
      `the ${noun} is not valid and was not created`,
      problems.map((problem) => problem.message),
    );
  }
  return parsed;
}

/** Reject a body that is only whitespace before anything is composed from it. */
export function requireText(value: string, what: string): string {
  if (value.trim() === "") throw invalidInput(`${what} must not be empty`);
  return value;
}
