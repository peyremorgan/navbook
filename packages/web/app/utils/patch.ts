/**
 * Turning an edited form back into the smallest patch that says it.
 *
 * The mutation distinguishes three things a field can mean, and getting them
 * confused is how an edit quietly destroys data: absent leaves the key alone,
 * an explicit `null` — or an empty list — clears it, and a value replaces it.
 * Sending every field on every save would therefore rewrite frontmatter nobody
 * touched, so only what actually changed is sent.
 *
 * An empty patch is refused by the server (`INVALID_INPUT`), so a save with
 * nothing in it must not be sent at all: `buildEntityPatch` returns null and the
 * caller does nothing, which is also the right thing for the person who opened
 * an editor and closed it again.
 */

import { isCalendarDate } from "~/utils/dates";
import type { UpdateIssueInput, UpdatePrInput } from "~~/src/generated/gql/graphql";

/**
 * The fields this client can edit, on either kind.
 *
 * `reviewers` is a pull request's alone (spec 02 §2.7). It is optional rather
 * than a second interface because everything else about the two patches is the
 * same, and the builder below only ever looks at what it was handed.
 */
export interface EntityEdit {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  features: string[];
  reviewers?: string[];
  /** Where it sits in the queue; issues only (spec 02 §2.5). */
  rank?: number | null;
  /** When the work is wanted, `YYYY-MM-DD`; issues only. */
  deadline?: string | null;
}

/** An update input without the `ref`, which the caller knows. */
export type EntityPatch = Omit<UpdateIssueInput, "ref"> & Pick<UpdatePrInput, "reviewers">;

export class PatchError extends Error {}

/**
 * Trim, drop blanks, and collapse duplicates, keeping the first spelling.
 *
 * Labels are compared case-insensitively by the server, so `Bug` and `bug`
 * would be one label there and two here; folding them now means the chip list
 * shows what the filter will actually match.
 */
export function normalizeList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** An optional single-line value, with blank meaning "no value". */
export function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What a number field means: blank is no rank, and anything else is a number.
 *
 * NaN comes back rather than null for text that is not a number, so that
 * "unplace it" and "that is not a rank" stay different answers — the second is
 * refused by the builder below, the first is an ordinary edit.
 */
export function parseRankInput(value: string | null | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The patch that turns `before` into `after`, or null when they agree.
 *
 * `after` is partial: a form that edits only the title passes only the title,
 * and every field it leaves out is left alone rather than treated as cleared.
 */
export function buildEntityPatch(
  before: EntityEdit,
  after: Partial<EntityEdit>,
): EntityPatch | null {
  const patch: EntityPatch = {};

  if (after.title !== undefined) {
    const title = after.title.trim();
    // The server refuses an empty title, and so does the format: a rewrite
    // that lost it would leave a file no reader could name.
    if (title === "") throw new PatchError("a title is required");
    if (title !== before.title.trim()) patch.title = title;
  }

  if (after.body !== undefined) {
    const body = after.body.trim();
    if (body === "") throw new PatchError("a description is required");
    if (body !== before.body.trim()) patch.body = body;
  }

  if (after.labels !== undefined) {
    const labels = normalizeList(after.labels);
    // An empty list is how the mutation spells "remove the key", so it is a
    // change worth sending whenever the issue had labels a moment ago.
    if (!sameList(labels, normalizeList(before.labels))) patch.labels = labels;
  }

  if (after.assignees !== undefined) {
    const assignees = normalizeList(after.assignees);
    if (!sameList(assignees, normalizeList(before.assignees))) patch.assignees = assignees;
  }

  if (after.milestone !== undefined) {
    const milestone = normalizeOptional(after.milestone);
    if (milestone !== normalizeOptional(before.milestone)) patch.milestone = milestone;
  }

  if (after.features !== undefined) {
    const features = normalizeList(after.features);
    if (!sameList(features, normalizeList(before.features))) patch.features = features;
  }

  if (after.reviewers !== undefined) {
    const reviewers = normalizeList(after.reviewers);
    if (!sameList(reviewers, normalizeList(before.reviewers ?? []))) patch.reviewers = reviewers;
  }

  if (after.rank !== undefined) {
    const rank = after.rank;
    // Null unplaces it; a number places it. Anything else is a typo in a field
    // and is said so, rather than sent for the server to refuse.
    if (rank !== null && !Number.isFinite(rank)) throw new PatchError("a rank is a number");
    if (rank !== (before.rank ?? null)) patch.rank = rank;
  }

  if (after.deadline !== undefined) {
    const deadline = normalizeOptional(after.deadline);
    if (deadline !== null && !isCalendarDate(deadline)) {
      throw new PatchError("a deadline is a date, as YYYY-MM-DD");
    }
    if (deadline !== normalizeOptional(before.deadline)) patch.deadline = deadline;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
