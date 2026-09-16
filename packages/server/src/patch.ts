/**
 * Editing an entity's frontmatter and body from structured fields.
 *
 * The CLI's `edit` opens the file in `$EDITOR` and records whatever comes back;
 * a server has no editor, so this plays the same part — it rewrites the file on
 * disk, and `applyEntityEdit` then records the edit exactly as it records a
 * human one.
 *
 * The edit goes through the YAML document rather than through `newIssueFile`,
 * and that is the whole point: unknown keys, key order and comments MUST
 * survive a rewrite (spec 02 §2.4), and rebuilding the file from known fields
 * would quietly drop everything the schema does not name.
 */

import {
  FrontmatterError,
  isCalendarDate,
  type NavDoc,
  normalizeBody,
  parseDoc,
  parseFile,
  patchDoc,
  readAssignees,
  readDeadline,
  readFeatures,
  readLabels,
  readRank,
  readReviewers,
  serializeDoc,
  setFlowList,
  writeScalarOrList,
} from "@navbook/core";
import { apiError, invalidInput } from "./errors.ts";
import type {
  UpdateFeatureInput,
  UpdateIssueInput,
  UpdatePrInput,
  UpdateSpecInput,
} from "./generated/resolver-types.ts";

/** What both kinds' patches carry; a pull request adds `reviewers` (§2.7). */
type EntityPatch = UpdateIssueInput & { reviewers?: readonly string[] | null };

/**
 * An optional list field.
 *
 * `undefined` leaves the key alone, an empty list or `null` removes it, and
 * anything else replaces it. The three cases are distinguishable because
 * GraphQL keeps an explicit null apart from an absent field, which is what lets
 * "clear the labels" and "do not touch the labels" be different requests.
 */
function applyList(nav: NavDoc, key: string, value: readonly string[] | null | undefined): void {
  if (value === undefined) return;
  if (value === null || value.length === 0) {
    patchDoc(nav, { [key]: undefined });
    return;
  }
  setFlowList(nav, key, [...value]);
}

/**
 * A key the format spells singular and accepts as a scalar or a list —
 * `assignee` (§2.5), `feature` (§2.11), `reviewer` (§2.7).
 *
 * Absent leaves it alone; null or empty removes it; one value is written as a
 * scalar and several as a flow list, which is what core's own constructors do.
 */
function applyScalarOrList(
  nav: NavDoc,
  key: string,
  value: readonly string[] | null | undefined,
): void {
  if (value === undefined) return;
  writeScalarOrList(nav, key, value ?? []);
}

/**
 * Apply a patch to an entity file's text, returning the new text.
 *
 * `path` is repository-relative and names the file only so a failure can say
 * which one it was. Both kinds take the same patch: what differs between an
 * issue and a pull request is what else the file holds, and this rewrites only
 * the keys it was given.
 */
export function applyEntityPatch(content: string, input: EntityPatch, path: string): string {
  const nav = parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    patchDoc(nav, { title: input.title });
  }

  applyList(nav, "labels", input.labels);
  applyScalarOrList(nav, "assignee", input.assignees);
  applyScalarOrList(nav, "reviewer", input.reviewers);
  applyScalarOrList(nav, "feature", input.features);

  if (input.milestone !== undefined) {
    patchDoc(nav, { milestone: input.milestone === null ? undefined : input.milestone });
  }

  if (input.rank !== undefined) {
    patchDoc(nav, { rank: input.rank === null ? undefined : input.rank });
  }

  if (input.deadline !== undefined) {
    // Checked here rather than left to the file's own validation: this rewrites
    // a file that was already well formed, and a patch that made it invalid
    // would be reported against the file rather than against the request.
    if (input.deadline !== null && !isCalendarDate(input.deadline)) {
      throw invalidInput("deadline must be a calendar date, as YYYY-MM-DD");
    }
    patchDoc(nav, { deadline: input.deadline === null ? undefined : input.deadline });
  }

  if (input.body !== undefined && input.body !== null) {
    if (input.body.trim() === "") throw invalidInput("body must not be empty");
    // Deliberately not marking the document dirty: the body is serialized
    // verbatim either way, and an untouched frontmatter block is replayed as
    // the author wrote it rather than round-tripped through the YAML printer.
    nav.body = `\n${normalizeBody(input.body)}`;
  }

  try {
    return serializeDoc(nav);
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    // The file's YAML cannot be re-emitted, so this edit cannot be made at all.
    // Same fault the CLI reports, named the same way.
    throw apiError(`${path}: ${error.message}`, "FRONTMATTER", {
      details: ["fix the file by hand, or run 'nav doctor' to see what is wrong"],
    });
  }
}

/**
 * The fields an entity patch can name, in the order a refusal lists them.
 *
 * Each is read from a file the way its resolver reads it, so that two spellings
 * of one value — `assignee: A` and `assignee: [A]`, say — compare equal, and a
 * respelling by a hand edit is never mistaken for somebody changing the field.
 */
const FIELD_READINGS: Record<
  keyof Omit<EntityPatch, "ref" | "baseSha">,
  (fm: Record<string, unknown>, body: string) => unknown
> = {
  title: (fm) => (typeof fm.title === "string" ? fm.title : ""),
  body: (_fm, body) => body.trim(),
  labels: (fm) => readLabels(fm),
  assignees: (fm) => readAssignees(fm),
  reviewers: (fm) => readReviewers(fm),
  features: (fm) => readFeatures(fm),
  milestone: (fm) =>
    typeof fm.milestone === "string" && fm.milestone !== "" ? fm.milestone : null,
  rank: (fm) => readRank(fm),
  deadline: (fm) => readDeadline(fm),
};

/**
 * The fields a patch names whose value differs between two versions of a file.
 *
 * This is the comparison behind a `baseSha` on an entity patch: `base` is the
 * file as the client saw it and `current` is the file as it is now, and only a
 * field the patch would write counts. A field somebody else changed that this
 * patch leaves alone is not a conflict with anybody — the patch lands on their
 * value and both changes survive — and refusing it would only teach clients to
 * stop sending the hash. Names come back as the input spells them.
 */
export function movedFields(base: string, current: string, input: EntityPatch): string[] {
  const before = parseFile(base);
  const after = parseFile(current);
  const moved: string[] = [];
  for (const [field, read] of Object.entries(FIELD_READINGS)) {
    if (input[field as keyof EntityPatch] === undefined) continue;
    const was = JSON.stringify(read(before.fm, before.body));
    const is = JSON.stringify(read(after.fm, after.body));
    if (was !== is) moved.push(field);
  }
  return moved;
}

/** The fields a patch names, in the same order and spelling. */
export function namedFields(input: EntityPatch): string[] {
  return Object.keys(FIELD_READINGS).filter(
    (field) => input[field as keyof EntityPatch] !== undefined,
  );
}

/** True when a patch names nothing to change. */
export function isEmptyPatch(input: UpdateIssueInput | UpdatePrInput): boolean {
  return (
    input.title === undefined &&
    input.body === undefined &&
    input.labels === undefined &&
    input.assignees === undefined &&
    input.milestone === undefined &&
    input.features === undefined &&
    ("rank" in input ? input.rank === undefined : true) &&
    ("deadline" in input ? input.deadline === undefined : true) &&
    ("reviewers" in input ? input.reviewers === undefined : true)
  );
}

/**
 * Apply a patch to a specification document, returning the new text.
 *
 * Through the YAML document for the same reason an issue's patch is: a
 * document may carry keys this schema does not name — `author`, `created`, or
 * something a future revision defines — and rebuilding the file from the two
 * fields the client sent would quietly drop them (spec 02 §2.4).
 */
export function applySpecPatch(content: string, input: UpdateSpecInput, path: string): string {
  const nav = parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    patchDoc(nav, { title: input.title });
  }
  if (input.body !== undefined && input.body !== null) {
    if (input.body.trim() === "") throw invalidInput("body must not be empty");
    nav.body = `\n${normalizeBody(input.body)}`;
  }

  try {
    return serializeDoc(nav);
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    throw apiError(`${path}: ${error.message}`, "FRONTMATTER", {
      details: ["fix the file by hand, or run 'nav doctor' to see what is wrong"],
    });
  }
}

/**
 * Apply a patch to a feature's identity card, returning the new text.
 *
 * An explicit null clears the summary, which is a thing a feature may go
 * without; `title` can be replaced but not emptied, since it is the name.
 */
export function applyFeaturePatch(
  content: string,
  input: UpdateFeatureInput,
  path: string,
): string {
  const nav = parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    patchDoc(nav, { title: input.title });
  }
  if (input.summary !== undefined) {
    const summary = input.summary === null ? "" : normalizeBody(input.summary);
    nav.body = summary === "" ? "" : `\n${summary}`;
  }

  try {
    return serializeDoc(nav);
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    throw apiError(`${path}: ${error.message}`, "FRONTMATTER", {
      details: ["fix the file by hand, or run 'nav doctor' to see what is wrong"],
    });
  }
}

/** True when a document patch names nothing to change. */
export function isEmptySpecPatch(input: UpdateSpecInput): boolean {
  return input.title === undefined && input.body === undefined;
}
