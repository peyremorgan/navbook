/**
 * Patching a feature's files from an API request — spec 06 §6.3.
 *
 * The client sends fields and the server composes the file, which is the rule
 * that keeps format knowledge out of the browser. These are the two composers
 * for the files this plugin owns, moved out of `@navbook/server` unchanged.
 */

import type * as NavbookCore from "@navbook/core";
import type { ServerPluginHost } from "@navbook/server/plugin";

/**
 * What a composer needs from the host: its core, and the two errors it
 * reports through.
 *
 * Handed in rather than imported, for the reason `files.ts` gives about core:
 * `@navbook/server` is only a dev dependency here, so a runtime import of it
 * would resolve in this workspace and to nothing once the plugin is installed.
 * The errors are the server's own, so a refusal from here carries the same
 * extension codes as one from a built-in mutation.
 */
export interface PatchHost {
  core: typeof NavbookCore;
  api: Pick<ServerPluginHost["api"], "invalidInput" | "apiError">;
}

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
  host: PatchHost,
  content: string,
  input: SpecPatch,
  path: string,
): string {
  const { core, api } = host;
  const nav = core.parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw api.invalidInput("title must not be empty");
    core.patchDoc(nav, { title: input.title });
  }
  if (input.body !== undefined && input.body !== null) {
    if (input.body.trim() === "") throw api.invalidInput("body must not be empty");
    nav.body = `\n${core.normalizeBody(input.body)}`;
  }

  return serialize(host, nav, path);
}

/**
 * Apply a patch to a feature's identity card, returning the new text.
 *
 * An explicit null clears the summary, which is a thing a feature may go
 * without; `title` can be replaced but not emptied, since it is the name.
 */
export function applyFeaturePatch(
  host: PatchHost,
  content: string,
  input: FeaturePatch,
  path: string,
): string {
  const { core, api } = host;
  const nav = core.parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw api.invalidInput("title must not be empty");
    core.patchDoc(nav, { title: input.title });
  }
  if (input.summary !== undefined) {
    const summary = input.summary === null ? "" : core.normalizeBody(input.summary);
    nav.body = summary === "" ? "" : `\n${summary}`;
  }

  return serialize(host, nav, path);
}

/**
 * Serialize, turning a frontmatter fault into the error the API reports.
 *
 * A file somebody hand-edited into something the writer cannot round-trip is
 * not the requester's mistake, so it is reported as the file's, by path, with
 * what to do about it.
 */
function serialize(host: PatchHost, nav: NavbookCore.NavDoc, path: string): string {
  const { core, api } = host;
  try {
    return core.serializeDoc(nav);
  } catch (error) {
    if (!(error instanceof core.FrontmatterError)) throw error;
    throw api.apiError(`${path}: ${error.message}`, "FRONTMATTER", {
      details: ["fix the file by hand, or run 'nav doctor' to see what is wrong"],
    });
  }
}
