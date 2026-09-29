/**
 * The two file types this plugin defines — spec 02 §2.11, `doc/spec.md`.
 *
 * Moved out of `@navbook/core` unchanged in what they accept: a `feature.md`
 * and a specification document are still exactly what the format says they
 * are. What changed is which package owns the code, not what a conforming tree
 * looks like, and that is the property the conformance fixtures check.
 */

import type * as NavbookCore from "@navbook/core";
import type { ParsedFile, Problem } from "@navbook/core";

/**
 * The running core, handed to `activate` and kept here.
 *
 * A *type* import of `@navbook/core` above and no value import: a plugin must
 * never resolve its own copy. The store installs with `--omit=peer` precisely
 * so it cannot, which means a runtime `import ... from "@navbook/core"` in
 * this package would resolve to nothing once installed — and would have failed
 * only there, never in this workspace, where it resolves to the same instance
 * by accident.
 *
 * Set once, before anything below is called: every entry point of this plugin
 * runs after its own `activate`.
 */
let core: typeof NavbookCore;

/** Called by `activate` before any of these functions can be reached. */
export function useCore(host: typeof NavbookCore): void {
  core = host;
}

/** The directory features live in, at the top of the Navbook root (§2.11). */
export const SPECS_DIR = "specs";

/** A feature's identity card, inside its own directory. */
export const FEATURE_FILE = "feature.md";

/** The slug grammar of §2.3 without the ID, which §2.11 reuses. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate a `feature.md` (§2.11).
 *
 * The body is the feature's summary and may be empty: a title and an author is
 * enough to name a concept, and the documents beside it are where the substance
 * belongs.
 */
export function validateFeature(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  core.requireString(parsed, "title", problems);
  core.checkPerson(parsed, "author", problems);
  core.checkTimestamp(parsed, "created", problems);
  core.checkNoStatusKey(parsed, problems);
  return problems;
}

/**
 * Validate a specification document (§2.11).
 *
 * Only `title` is required. A spec is a living document rather than a record of
 * something that happened, so who wrote it and when are git's answer to give.
 */
export function validateSpec(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  core.requireString(parsed, "title", problems);
  if (parsed.fm.author !== undefined && parsed.fm.author !== null) {
    core.checkPerson(parsed, "author", problems);
  }
  if (parsed.fm.created !== undefined && parsed.fm.created !== null) {
    core.checkTimestamp(parsed, "created", problems);
  }
  core.checkNoStatusKey(parsed, problems);
  return problems;
}

/**
 * The `feature` key: a slug or a list of them (§2.11).
 *
 * A value that is not a slug can name no directory at all, so it is a schema
 * fault (D2) rather than a dangling reference (D14). Registered as the
 * validator for the key, and therefore run wherever the host validates an
 * entity — which is how a plugin's key gets checked by `doctor` without
 * `doctor` knowing the key exists.
 */
export function checkFeatureKey(value: unknown): Problem[] {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  const bad =
    entries.length === 0 ||
    entries.some((entry) => typeof entry !== "string" || !SLUG_PATTERN.test(entry));
  return bad ? [{ key: "feature", message: "'feature' must be a slug or list of slugs" }] : [];
}

/**
 * The slugs a write names, each once, in the order first given.
 *
 * `feature` is a set written as a list: `--feature auth --feature auth`, or an
 * API client that appends without looking, means one feature, and a file that
 * said `[auth, auth]` would count the entity twice wherever the list is read.
 */
export function uniqueSlugs(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * The features an entity claims, keeping only well-formed slugs.
 *
 * Defensive for the reason every reader in this format is: a hand-edited file
 * may say anything, and a listing that threw on one would be a listing nobody
 * could run. What is dropped here is reported by D2.
 */
export function readFeatures(fm: Record<string, unknown>): string[] {
  const value = fm.feature;
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter(
    (entry): entry is string => typeof entry === "string" && SLUG_PATTERN.test(entry),
  );
}

export interface NewFeatureInput {
  title: string;
  author: string;
  created: string;
  /** The summary; a feature may have none. */
  body?: string;
}

/** Render a new `feature.md`. */
export function newFeatureFile(input: NewFeatureInput): string {
  const nav = core.emptyDoc();
  core.patchDoc(nav, { title: input.title, author: input.author, created: input.created });
  const summary = core.normalizeBody(input.body ?? "");
  // A feature with no summary ends at its closing delimiter. The blank line a
  // body is separated by is part of having one.
  nav.body = summary === "" ? "" : `\n${summary}`;
  return core.serializeDoc(nav);
}

export interface NewSpecInput {
  title: string;
  body: string;
  author?: string;
  created?: string;
}

/** Render a new specification document. */
export function newSpecFile(input: NewSpecInput): string {
  const nav = core.emptyDoc();
  core.patchDoc(nav, { title: input.title });
  if (input.author) core.patchDoc(nav, { author: input.author });
  if (input.created) core.patchDoc(nav, { created: input.created });
  nav.body = `\n${core.normalizeBody(input.body)}`;
  return core.serializeDoc(nav);
}

/**
 * The grammar a document's name must follow to be *created* by a tool.
 *
 * Reading is deliberately more generous — the tree model takes any `*.md` —
 * because a hand-written `Login Flow.md` is legal and must keep working. What a
 * tool mints for somebody else to live with is held to the slug grammar, and
 * `feature.md` is excluded because that name already means something else.
 */
export const SPEC_FILE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;

/** True when a tool may create a document under this name. */
export function isSpecFileName(name: string): boolean {
  return name !== FEATURE_FILE && SPEC_FILE_PATTERN.test(name);
}

/**
 * Derive a document's file name from its title.
 *
 * A title that slugs to `feature` would collide with the identity card, so it
 * gains a suffix rather than being refused: the author named a document, and
 * which file holds it is the tool's business.
 */
export function specFileName(title: string): string {
  const slug = core.slugify(title);
  return slug === "feature" ? "feature-spec.md" : `${slug}.md`;
}
