/**
 * Producing the text of a new Navbook file, from `-m` or from `$EDITOR`.
 *
 * Both paths end in the same place: a complete file that has been parsed and
 * validated before anything is written into `.navbook/`. The editor buffer is
 * the whole file — frontmatter included — so an author can set the title,
 * labels and body in one pass, and an abort leaves nothing behind.
 */

import { type ParsedFile, type Problem, parseFile } from "@navbook/core";
import type { Ctx } from "../context.ts";
import { editBuffer } from "../editor.ts";
import { fail } from "../errors.ts";

export interface ComposeOptions {
  /** Text supplied with `-m`; when absent the editor is opened. */
  message?: string;
  /** Name of the scratch buffer inside the git directory. */
  bufferName: string;
  /** Render the complete file from a body. */
  render: (body: string) => string;
  /** Schema check applied to the finished file. */
  validate: (parsed: ParsedFile) => Problem[];
  /** Noun used in error messages, e.g. "issue" or "comment". */
  noun: string;
}

export interface Composed {
  content: string;
  parsed: ParsedFile;
}

export function composeFile(ctx: Ctx, opts: ComposeOptions): Composed {
  if (opts.message !== undefined) {
    if (opts.message.trim() === "") fail(`empty ${opts.noun} text; aborting`);
    return check(opts, opts.render(opts.message));
  }
  const edited = editBuffer(ctx, opts.bufferName, opts.render(""));
  let parsed: ParsedFile;
  try {
    parsed = parseFile(edited);
  } catch (error) {
    fail(`aborting: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.body.trim() === "") fail(`aborting ${opts.noun} due to empty body`);
  return check(opts, edited);
}

function check(opts: ComposeOptions, content: string): Composed {
  let parsed: ParsedFile;
  try {
    parsed = parseFile(content);
  } catch (error) {
    fail(`aborting: ${error instanceof Error ? error.message : String(error)}`);
  }
  const problems = opts.validate(parsed);
  if (problems.length > 0) {
    fail(
      `the ${opts.noun} is not valid and was not created`,
      problems.map((problem) => `  ${problem.message}`),
    );
  }
  return { content, parsed };
}
