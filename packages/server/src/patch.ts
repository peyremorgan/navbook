/**
 * Editing an issue's frontmatter and body from structured fields.
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
  type NavDoc,
  normalizeBody,
  parseDoc,
  patchDoc,
  serializeDoc,
  setFlowList,
} from "@navbook/core";
import { apiError, invalidInput } from "./errors.ts";
import type {
  UpdateFeatureInput,
  UpdateIssueInput,
  UpdateSpecInput,
} from "./generated/resolver-types.ts";

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
 * Apply a patch to an issue file's text, returning the new text.
 *
 * `path` is repository-relative and names the file only so a failure can say
 * which one it was.
 */
export function applyIssuePatch(content: string, input: UpdateIssueInput, path: string): string {
  const nav = parseDoc(content);

  if (input.title !== undefined && input.title !== null) {
    if (input.title.trim() === "") throw invalidInput("title must not be empty");
    patchDoc(nav, { title: input.title });
  }

  applyList(nav, "labels", input.labels);
  // `assignee` is singular on disk and may be a scalar or a list (spec 02
  // §2.5); one name is written as a scalar, matching what `newIssueFile` does.
  if (input.assignees !== undefined) {
    if (input.assignees === null || input.assignees.length === 0) {
      patchDoc(nav, { assignee: undefined });
    } else if (input.assignees.length === 1) {
      patchDoc(nav, { assignee: input.assignees[0] });
    } else {
      setFlowList(nav, "assignee", [...input.assignees]);
    }
  }

  if (input.milestone !== undefined) {
    patchDoc(nav, { milestone: input.milestone === null ? undefined : input.milestone });
  }

  // `feature` is singular on disk and, like `assignee`, may be a scalar or a
  // list (spec 02 §2.11); one feature is written as a scalar, which is what
  // `newIssueFile` does and what nearly every entity carries.
  if (input.features !== undefined) {
    if (input.features === null || input.features.length === 0) {
      patchDoc(nav, { feature: undefined });
    } else if (input.features.length === 1) {
      patchDoc(nav, { feature: input.features[0] });
    } else {
      setFlowList(nav, "feature", [...input.features]);
    }
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

/** True when a patch names nothing to change. */
export function isEmptyPatch(input: UpdateIssueInput): boolean {
  return (
    input.title === undefined &&
    input.body === undefined &&
    input.labels === undefined &&
    input.assignees === undefined &&
    input.milestone === undefined &&
    input.features === undefined
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
