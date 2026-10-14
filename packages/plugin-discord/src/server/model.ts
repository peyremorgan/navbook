/**
 * What the bridge remembers about each issue and pull request, and what it
 * makes of two such memories: the events a thread is told.
 *
 * The bridge compares states rather than reading commits. A commit says what
 * its author did to one record, as `core/activity.ts` reads it; but a push
 * brings many commits, a merge brings a branch's worth at once, and a commit
 * made over the API is the machine account's, not the person's. The states
 * before and after say exactly what changed for every record, whichever road
 * the change came by — and what a thread needs is exactly that. Who did it is
 * read where the format records it: a comment's `author:`.
 */

import type * as NavbookCore from "@navbook/core";
import type { EntityRecord } from "@navbook/core";

export type Core = typeof NavbookCore;

/**
 * One record as last seen: enough to tell what changed, and plain JSON, so it
 * survives a restart in the bridge's state file and compares equal after one.
 */
export interface Seen {
  kind: "issue" | "pr";
  status: string;
  title: string;
  fm: Record<string, unknown>;
  /** Its comments' ids, in thread order. */
  comments: string[];
}

export function seenOf(entity: EntityRecord): Seen {
  return {
    kind: entity.kind,
    status: entity.status,
    title: entity.title,
    fm: plain(entity.fm),
    comments: entity.comments.map((comment) => comment.id),
  };
}

/** A value as JSON would give it back: dates as strings, nothing undefined. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export type EntityEvent =
  | { type: "opened" }
  | { type: "status"; from: string; to: string; resolution: string | null }
  | { type: "retitled"; from: string; to: string }
  | { type: "assigned"; added: string[]; removed: string[] }
  | { type: "reviewers"; added: string[]; removed: string[] }
  | { type: "revised"; heads: string[] }
  | { type: "field"; key: string; before: unknown; after: unknown }
  | { type: "comment"; id: string }
  | { type: "gone" };

/**
 * Keys with an event of their own, or that never change once written: a
 * `field` event for one of them would only repeat what another event says.
 */
const OWN_EVENT_KEYS = new Set(["title", "assignee", "reviewer", "revisions", "author", "created"]);

/**
 * What happened to one record between two sightings.
 *
 * A record seen for the first time is `opened` and nothing else: what it
 * already carries is in the card the thread starts with. Every field of it is
 * still something a rule may ask about, which {@link firstSighting} supplies.
 */
export function diffSeen(
  core: Core,
  before: Seen | undefined,
  after: Seen | undefined,
): EntityEvent[] {
  if (after === undefined) return before === undefined ? [] : [{ type: "gone" }];
  if (before === undefined) return [{ type: "opened" }];

  const events: EntityEvent[] = [];
  if (before.status !== after.status) events.push(statusEvent(before.status, after));
  if (before.title !== after.title) {
    events.push({ type: "retitled", from: before.title, to: after.title });
  }
  const assigned = peopleDiff(core, core.readAssignees(before.fm), core.readAssignees(after.fm));
  if (assigned !== null) events.push({ type: "assigned", ...assigned });
  if (after.kind === "pr") {
    const reviewers = peopleDiff(core, core.readReviewers(before.fm), core.readReviewers(after.fm));
    if (reviewers !== null) events.push({ type: "reviewers", ...reviewers });
    const was = new Set(core.readRevisions(before.fm).map((revision) => revision.head));
    const heads = core
      .readRevisions(after.fm)
      .map((revision) => revision.head)
      .filter((head) => !was.has(head));
    if (heads.length > 0) events.push({ type: "revised", heads });
  }
  const keys = new Set([...Object.keys(before.fm), ...Object.keys(after.fm)]);
  for (const key of keys) {
    if (OWN_EVENT_KEYS.has(key)) continue;
    if (JSON.stringify(before.fm[key]) === JSON.stringify(after.fm[key])) continue;
    events.push({ type: "field", key, before: before.fm[key], after: after.fm[key] });
  }
  const had = new Set(before.comments);
  for (const id of after.comments) if (!had.has(id)) events.push({ type: "comment", id });
  return events;
}

/**
 * The events a rule weighs when a record is seen for the first time: it was
 * opened, settled if it already is, assigned to whoever it names, and given
 * every field it carries — so an issue filed already assigned, or already
 * `priority: high`, or closed before the bridge looked, matches the rule that
 * waits for it, as one changed a minute later would.
 */
export function firstSighting(core: Core, after: Seen): EntityEvent[] {
  const events: EntityEvent[] = [{ type: "opened" }];
  if (after.status !== "open") events.push(statusEvent("open", after));
  const assignees = core.readAssignees(after.fm);
  if (assignees.length > 0) events.push({ type: "assigned", added: assignees, removed: [] });
  for (const [key, value] of Object.entries(after.fm)) {
    if (OWN_EVENT_KEYS.has(key)) continue;
    events.push({ type: "field", key, before: undefined, after: value });
  }
  return events;
}

/** The move from `from` to the status `after` is in, with the resolution it gives. */
function statusEvent(from: string, after: Seen): EntityEvent {
  const resolution = after.fm.resolution;
  return {
    type: "status",
    from,
    to: after.status,
    resolution: typeof resolution === "string" && resolution !== "" ? resolution : null,
  };
}

/** Who was added and removed, compared by address; null when nobody was. */
function peopleDiff(
  core: Core,
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } | null {
  const was = new Set(before.map((person) => addressOf(core, person)));
  const is = new Set(after.map((person) => addressOf(core, person)));
  const added = after.filter((person) => !was.has(addressOf(core, person)));
  const removed = before.filter((person) => !is.has(addressOf(core, person)));
  return added.length === 0 && removed.length === 0 ? null : { added, removed };
}

/** The address a person field names, lower-cased: the identity key (spec 02 §2.4). */
export function addressOf(core: Core, person: string): string {
  return (core.parsePerson(person)?.email ?? person).trim().toLowerCase();
}

/** A frontmatter value's items as text: a scalar is one, a list is each. */
export function valuesOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => valuesOf(item));
  if (typeof value === "object") return [JSON.stringify(value)];
  return [String(value)];
}
