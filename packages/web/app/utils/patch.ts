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
  /**
   * Values for list-valued fields plugins added to the update inputs, by the
   * name their SDL gave the field (spec 02 §2.12).
   *
   * Kept apart from the named keys rather than mixed in, for the reason
   * `FilterState.ext` is: every function here stays total over the format's
   * own fields, and a plugin cannot shadow one by choosing the same name. It
   * is one object rather than a key each because `usePendingEdits` keys a
   * save by the field it names, and a plugin's panel should not have to know
   * that.
   */
  ext: Record<string, string[]>;
  reviewers?: string[];
  /** Where it sits in the queue; issues only (spec 02 §2.5). */
  rank?: number | null;
  /** When the work is wanted, `YYYY-MM-DD`; issues only. */
  deadline?: string | null;
  /** A feature's card alone (spec 02 §2.11); never sent to an entity. */
  summary?: string | null;
}

/** An update input without the `ref`, which the caller knows. */
export type EntityPatch = Omit<UpdateIssueInput, "ref"> & Pick<UpdatePrInput, "reviewers">;

/**
 * Fields plugin layers added to `UpdateIssueInput` and `UpdatePrInput`.
 *
 * A module-level array rather than something read from the slot registry, for
 * the reason `FILTER_EXTENSIONS` is one: everything in this file is a pure
 * function over an edit and has to stay unit-testable without mounting an app.
 * A layer's Nuxt plugin registers into the slots, and the slots push here.
 *
 * Only list-valued fields. That is what a frontmatter key a plugin adds is in
 * every case this format allows (§2.12 gives it `<short>-*`, and §2.4 makes a
 * scalar and a one-item list the same thing), and it keeps the comparison
 * below one shape rather than a switch over types nothing yet uses.
 */
export const PATCH_EXTENSIONS: { field: string; label: string }[] = [];

/** Register a plugin's editable field. Called by the slot registry. */
export function registerPatchField(field: string, label: string): void {
  if (!PATCH_EXTENSIONS.some((entry) => entry.field === field)) {
    PATCH_EXTENSIONS.push({ field, label });
  }
}

/** Forget every registered field. For tests. */
export function resetPatchFields(): void {
  PATCH_EXTENSIONS.length = 0;
}

/**
 * A mutation's input with plugin fields added, the format's own winning.
 *
 * A form's plugin fields (the new-issue page's) arrive as an open map, since
 * the host cannot know what a layer will add. A key in it that names one of
 * the format's own fields — a plugin's `parent`, say — is dropped rather than
 * sent: it is either a mistake or a plugin quietly replacing what the person
 * set in the host's own field, and neither should reach the server. The rest
 * go in before the format's fields, so even a key missed here could not win.
 */
export function withPluginFields<T extends object>(
  core: T,
  extra: Record<string, unknown>,
): T & Record<string, unknown> {
  const own = new Set(Object.keys(core));
  const added = Object.fromEntries(Object.entries(extra).filter(([key]) => !own.has(key)));
  return { ...added, ...core };
}

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
 * What a rank field means: blank is no rank, and anything else is a number.
 *
 * A number arrives as often as a string does — a `type="number"` input hands
 * back whichever its component chose — so both are read here rather than one
 * being assumed. Getting that wrong is a silent failure and not a loud one:
 * Vue swallows what a save handler throws, so the form closes on an edit that
 * was never sent.
 *
 * NaN comes back rather than null for text that is not a number, so that
 * "unplace it" and "that is not a rank" stay different answers — the second is
 * refused by the builder below, the first is an ordinary edit.
 */
export function parseRankInput(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return value;
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

/** The fields an edit names: every key it holds a value for, absent ones aside. */
export function fieldsOf<E extends object>(change: Partial<E>): (keyof E)[] {
  return (Object.keys(change) as (keyof E)[]).filter((key) => change[key] !== undefined);
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

  if (after.ext !== undefined) {
    // Registered fields only. An `ext` key nothing registered is a field no
    // loaded plugin has, and sending it would be asking the server to refuse
    // an input it does not have either.
    for (const { field } of PATCH_EXTENSIONS) {
      const edited = after.ext[field];
      if (edited === undefined) continue;
      const values = normalizeList(edited);
      if (sameList(values, normalizeList(before.ext?.[field] ?? []))) continue;
      // Cast because the field is one a plugin's SDL added: the generated
      // input type describes the core schema and cannot know about it.
      (patch as Record<string, unknown>)[field] = values;
    }
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

/** What each field of an edit is called on the page. */
const FIELD_LABELS: Record<Exclude<keyof EntityEdit, "ext">, string> = {
  title: "title",
  body: "description",
  labels: "labels",
  assignees: "assignees",
  milestone: "milestone",
  reviewers: "reviewers",
  rank: "rank",
  deadline: "deadline",
  summary: "summary",
};

/**
 * The page's name for a field, given the mutation's — `body` is the
 * description, and a plugin's field is whatever its layer registered.
 */
export function fieldLabel(field: string): string {
  const built = FIELD_LABELS[field as Exclude<keyof EntityEdit, "ext">];
  if (built !== undefined) return built;
  return PATCH_EXTENSIONS.find((entry) => entry.field === field)?.label ?? field;
}

/**
 * What the toast calls a save: "Title updated", "Features updated".
 *
 * Read off the patch that went out rather than the edit that asked for it. A
 * plugin's panel hands over its whole `ext` map, so the edit's own keys would
 * say "Ext updated" — a name nobody on the page has seen — and its `ext`
 * would name every plugin field, changed or not. The patch names exactly the
 * fields that moved, a plugin's under the input field its SDL added, which
 * `fieldLabel` turns into what its layer registered.
 */
export function describeWrite(patch: EntityPatch): string {
  const labels = Object.keys(patch).map(fieldLabel);
  const said =
    labels.length <= 1
      ? (labels[0] ?? "field")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)} updated`;
}

/**
 * An edit as a person would read it back: one line per field it names.
 *
 * For the alert that shows a refused edit beside what the file says now. A
 * list is joined, an absence — a cleared milestone, an unplaced rank — is said
 * as "none", and a field the edit does not name is not mentioned.
 */
export function describeEntityEdit(
  change: Partial<EntityEdit>,
): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  const say = (value: unknown): string =>
    Array.isArray(value)
      ? value.length === 0
        ? "none"
        : value.join(", ")
      : value === null || value === ""
        ? "none"
        : String(value);

  for (const key of Object.keys(FIELD_LABELS) as Exclude<keyof EntityEdit, "ext">[]) {
    const value = change[key];
    if (value === undefined) continue;
    out.push({ field: FIELD_LABELS[key], value: say(value) });
  }
  // A plugin's fields read like the format's own, under the name its layer
  // gave them: this is the alert that shows a refused edit, and "ext" would
  // tell the person nothing about what they had typed.
  for (const { field, label } of PATCH_EXTENSIONS) {
    const value = change.ext?.[field];
    if (value === undefined) continue;
    out.push({ field: label, value: say(value) });
  }
  return out;
}
