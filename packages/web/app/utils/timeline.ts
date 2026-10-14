/**
 * A detail page's discussion, with what plugins have to say placed in it.
 *
 * The thread is the comments, as `buildCommentTree` arranges them; a plugin
 * may add things that happened on the entity too — a poll somebody opened, say
 * — which belong where they happened rather than in a box beside the thread.
 * This puts them there: each where its time falls among the top-level
 * comments, so a reply never has something wedged between it and what it
 * answers.
 *
 * Pure, so it stays testable without an app; the issue page gathers the items
 * from the `timelineItems` slot, through {@link gatherTimelineItems}.
 */

import type { CommentNode } from "~/utils/comments";
import { parseTimestamp } from "~/utils/entities";

/** Something a plugin put in the thread, and when it happened. */
export interface TimelineItem<S = unknown> {
  /** Unique among what one slot returns; also the anchor it is drawn under. */
  key: string;
  /** A timestamp, ISO or a file name's compact one. One that does not parse goes last. */
  at: string;
  /** Whatever the caller needs to draw it: the slot that returned it, here. */
  source: S;
}

export type TimelineEntry<S = unknown> =
  | { kind: "comment"; node: CommentNode }
  | { kind: "item"; item: TimelineItem<S> };

/**
 * When something happened, for ordering; what does not parse sorts last. A
 * comment's time is its file name's compact stamp, `2026-10-04T101500Z`, and a
 * plugin's is usually ISO: both are read.
 */
function instant(stamp: string): number {
  return parseTimestamp(stamp)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/**
 * The thread with the items placed in it.
 *
 * Comments keep the order they came in, which is the server's; items are put
 * among the top-level ones by time, and keep their own order when two fall at
 * the same moment. A comment and an item made in the same second show the
 * comment first: the file names of both only say the second, and the comment
 * is what a reader is following.
 */
export function interleave<S>(
  nodes: readonly CommentNode[],
  items: readonly TimelineItem<S>[],
): TimelineEntry<S>[] {
  // A stable sort: items given in one order and stamped alike stay in it.
  const pending = items
    .map((item, index) => ({ item, index, time: instant(item.at) }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  const out: TimelineEntry<S>[] = [];
  for (const node of nodes) {
    const time = instant(node.comment.created);
    while (pending[0] !== undefined && pending[0].time < time) {
      out.push({ kind: "item", item: pending[0].item });
      pending.shift();
    }
    out.push({ kind: "comment", node });
  }
  for (const rest of pending) out.push({ kind: "item", item: rest.item });
  return out;
}

/**
 * A `timelineItems` slot, as far as gathering goes: whatever its `items`
 * returns is taken on trust by nothing.
 */
export interface TimelineSource {
  items: (ext: Record<string, unknown>) => unknown;
}

/** Slots already said to be broken, so a page that recomputes says it once. */
const complainedOf = new WeakSet<TimelineSource>();

function complain(slot: TimelineSource, what: string, cause?: unknown): void {
  if (complainedOf.has(slot)) return;
  complainedOf.add(slot);
  console.error(
    `a timeline slot ${what}; what it placed is left out of the discussion`,
    ...(cause === undefined ? [] : [cause]),
  );
}

function placeable(item: unknown): item is { key: string; at: string } {
  if (typeof item !== "object" || item === null) return false;
  const { key, at } = item as { key?: unknown; at?: unknown };
  return typeof key === "string" && typeof at === "string";
}

/**
 * What every slot places in the thread, each item carrying `source(slot, i)`.
 *
 * A slot is a plugin's code, read on every render of the discussion: one that
 * throws, or returns something other than a list of `{ key, at }` strings,
 * costs its own items rather than everybody's comments. What it got right of
 * a list is still placed; the rest is said once on the console.
 */
export function gatherTimelineItems<T extends TimelineSource, S>(
  slots: readonly T[],
  ext: Record<string, unknown>,
  source: (slot: T, index: number) => S,
): TimelineItem<S>[] {
  return slots.flatMap((slot, index) => {
    let items: unknown;
    try {
      items = slot.items(ext);
    } catch (error) {
      complain(slot, "threw", error);
      return [];
    }
    if (!Array.isArray(items)) {
      complain(slot, "returned something other than a list");
      return [];
    }
    const out: TimelineItem<S>[] = [];
    for (const item of items as unknown[]) {
      if (placeable(item)) out.push({ key: item.key, at: item.at, source: source(slot, index) });
      else complain(slot, "returned an item without a string key and time");
    }
    return out;
  });
}
