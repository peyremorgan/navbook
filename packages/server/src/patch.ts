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
  NAVBOOK_ROOT,
  type NavDoc,
  normalizeBody,
  parseDoc,
  patchDoc,
  serializeDoc,
  setFlowList,
} from "@navbook/core";
import { apiError, invalidInput } from "./errors.ts";
import type { UpdateIssueInput } from "./generated/resolver-types.ts";

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
 * `path` names the file only so a failure can say which one it was.
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
    throw apiError(`${NAVBOOK_ROOT}/${path}: ${error.message}`, "FRONTMATTER", {
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
    input.milestone === undefined
  );
}
