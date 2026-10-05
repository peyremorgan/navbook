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
 * from the `timelineItems` slot.
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
