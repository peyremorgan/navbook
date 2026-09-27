/**
 * Patching a feature's files from an API request — spec 06 §6.3.
 *
 * The client sends fields and the server composes the file, which is the rule
 * that keeps format knowledge out of the browser. These are the two composers
 * for the files this plugin owns, moved out of `@navbook/server` unchanged.
 */

import type * as NavbookCore from "@navbook/core";
import { apiError, invalidInput } from "@navbook/server/plugin";

type Core = typeof NavbookCore;

export interface SpecPatch {
  title?: string | null;
  body?: string | null;
}

export interface FeaturePatch {
  title?: string | null;
  summary?: string | null;
}

/** True when a document patch names nothing to change. */
export function isEmptySpecPatch(input: SpecPatch): boolean {
  return input.title === undefined && input.body === undefined;
}

/** Apply a patch to a specification document, returning the new text. */
export function applySpecPatch(
  core: Core,
  content: string,
  input: SpecPatch,
  path: string,
): string {
  const nav = core.parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    core.patchDoc(nav, { title: input.title });
  }
  if (input.body !== undefined && input.body !== null) {
    if (input.body.trim() === "") throw invalidInput("body must not be empty");
    nav.body = `\n${core.normalizeBody(input.body)}`;
  }

  return serialize(core, nav, path);
}

/**
 * Apply a patch to a feature's identity card, returning the new text.
 *
 * An explicit null clears the summary, which is a thing a feature may go
 * without; `title` can be replaced but not emptied, since it is the name.
 */
export function applyFeaturePatch(
  core: Core,
  content: string,
  input: FeaturePatch,
  path: string,
): string {
  const nav = core.parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    core.patchDoc(nav, { title: input.title });
  }
  if (input.summary !== undefined) {
    const summary = input.summary === null ? "" : core.normalizeBody(input.summary);
    nav.body = summary === "" ? "" : `\n${summary}`;
  }

  return serialize(core, nav, path);
}

/**
 * Serialize, turning a frontmatter fault into the error the API reports.
 *
 * A file somebody hand-edited into something the writer cannot round-trip is
 * not the requester's mistake, so it is reported as the file's, by path, with
 * what to do about it.
 */
function serialize(core: Core, nav: NavbookCore.NavDoc, path: string): string {
  try {
    return core.serializeDoc(nav);
  } catch (error) {
    if (!(error instanceof core.FrontmatterError)) throw error;
    throw apiError(`${path}: ${error.message}`, "FRONTMATTER", {
      details: ["fix the file by hand, or run 'nav doctor' to see what is wrong"],
    });
  }
}
