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

/* ------------------------------------------------------------ stale check */

/** How to read one patchable field off a parsed file, for comparison. */
type Reading = (parsed: NavbookCore.ParsedFile) => unknown;

const titleOf: Reading = (parsed) => parsed.fm.title;
const bodyOf: Reading = (parsed) => parsed.body.trim();

/**
 * The fields a document patch would write, and how each reads. A null title
 * or body is left alone rather than cleared (`applySpecPatch`), so it is not a
 * field the patch names and must not be one it is refused over.
 */
export function specReadings(input: SpecPatch): Record<string, Reading> {
  return {
    ...(input.title !== undefined && input.title !== null ? { title: titleOf } : {}),
    ...(input.body !== undefined && input.body !== null ? { body: bodyOf } : {}),
  };
}

/** The same for an identity card, where a null summary does clear it. */
export function featureReadings(input: FeaturePatch): Record<string, Reading> {
  return {
    ...(input.title !== undefined && input.title !== null ? { title: titleOf } : {}),
    ...(input.summary !== undefined ? { summary: bodyOf } : {}),
  };
}

/**
 * Refuse a patch to a field that has changed since the client read the file.
 *
 * The host's `assertFieldsUnmoved` for an entity, applied to this plugin's
 * files, and for the same reason. The page saves one field at a time with the
 * hash it rendered, so a whole-file check refuses somebody's second quick edit
 * as stale against their own first one — the summary refused because the
 * title they had just saved moved the hash. Compared per field instead, a
 * patch is refused only over a field it writes that somebody else changed.
 *
 * A hash of the file as it is now settles it without git. Otherwise the hash
 * names the version the client saw, which every write here committed, so the
 * clone still has it; one it does not have — never fetched, not a hash, or
 * not a file this plugin can parse — is refused as stale over every field the
 * patch names, since there is no telling what the client was looking at. As
 * on the host, the lookup is best-effort: under a clean filter or CRLF
 * conversion the text's hash is not git's name for it, and a concurrent edit
 * is refused whole rather than per field.
 *
 * Checked before anything is written, so a refusal leaves the tree as it was.
 */
export function assertFieldsUnmoved(
  host: PatchHost,
  repoRoot: string,
  describe: string,
  current: string,
  baseSha: string,
  readings: Record<string, Reading>,
): void {
  const { core, api } = host;
  if (core.blobSha(current) === baseSha) return;

  const stale = (message: string, moved: string[]): Error =>
    api.apiError(message, "STALE_CONTENT", {
      moved,
      details: ["reload it and apply your change to what it says now"],
    });
  const named = Object.keys(readings);
  const unknown = (): Error =>
    stale(`${describe} was read from a version this server does not have`, named);

  const base = core.blobContent(repoRoot, baseSha);
  if (base === null) throw unknown();
  let before: NavbookCore.ParsedFile;
  let after: NavbookCore.ParsedFile;
  try {
    before = core.parseFile(base);
    after = core.parseFile(current);
  } catch (error) {
    if (!(error instanceof core.FrontmatterError)) throw error;
    throw unknown();
  }

  const moved = named.filter((field) => {
    const read = readings[field] as Reading;
    return JSON.stringify(read(before)) !== JSON.stringify(read(after));
  });
  if (moved.length === 0) return;
  throw stale(`${moved.join(", ")} of ${describe} changed since you opened it`, moved);
}
