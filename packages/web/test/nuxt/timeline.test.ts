/**
 * What a plugin places in a discussion, placed — `app/utils/timeline.ts`.
 *
 * The rules worth proving are the ones a reader would notice broken: an item
 * lands where its time falls among the top-level comments, never between a
 * reply and what it answers; a comment made in the same second as an item
 * comes first; and nothing is lost when a time does not parse.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildCommentTree } from "~/utils/comments";
import { interleave, type TimelineEntry } from "~/utils/timeline";
import type { CommentFieldsFragment } from "~~/src/generated/gql/graphql";

function comment(
  id: string,
  created: string,
  replyTo: string | null = null,
): CommentFieldsFragment {
  return {
    id,
    path: `.navbook/issues/open/x/comments/${id}.md`,
    created,
    author: "a@example.com",
    replyTo,
    verdict: null,
    revision: null,
    file: null,
    line: null,
    body: id,
  };
}

const item = (key: string, at: string) => ({ key, at, source: "slot" });

/** The entries as `c:<id>` and `i:<key>`, in order. */
const shape = (entries: TimelineEntry<string>[]): string[] =>
  entries.map((entry) =>
    entry.kind === "comment" ? `c:${entry.node.comment.id}` : `i:${entry.item.key}`,
  );

/** Comments as the API dates them: their file names' compact stamps. */
const THREAD = buildCommentTree([
  comment("c1", "2026-10-04T090000Z"),
  comment("c2", "2026-10-04T110000Z"),
  // A reply made after the item below, nested under c2 all the same.
  comment("r1", "2026-10-04T130000Z", "c2"),
  comment("c3", "2026-10-04T150000Z"),
]);

describe("interleave", () => {
  it("is the thread when nothing is placed in it, and the items when nobody spoke", () => {
    assert.deepEqual(shape(interleave(THREAD, [])), ["c:c1", "c:c2", "c:c3"]);
    assert.deepEqual(shape(interleave([], [item("p", "2026-10-04T10:00:00Z")])), ["i:p"]);
  });

  it("puts each item where its time falls among the top-level comments", () => {
    const entries = interleave(THREAD, [
      item("late", "2026-10-04T16:00:00Z"),
      item("early", "2026-10-04T08:00:00Z"),
      item("middle", "2026-10-04T10:00:00Z"),
    ]);
    assert.deepEqual(shape(entries), ["i:early", "c:c1", "i:middle", "c:c2", "c:c3", "i:late"]);
  });

  it("never comes between a reply and the comment it answers", () => {
    // After c2 and before its reply, by time; but the reply is part of c2.
    const entries = interleave(THREAD, [item("p", "2026-10-04T12:00:00Z")]);
    assert.deepEqual(shape(entries), ["c:c1", "c:c2", "i:p", "c:c3"]);
    const c2 = entries[1];
    assert.equal(c2?.kind === "comment" && c2.node.replies[0]?.comment.id, "r1");
  });

  it("shows a comment made in the same second first, and keeps items stamped alike in their order", () => {
    const entries = interleave(THREAD, [
      item("b", "2026-10-04T11:00:00Z"),
      item("a", "2026-10-04T11:00:00Z"),
    ]);
    assert.deepEqual(shape(entries), ["c:c1", "c:c2", "i:b", "i:a", "c:c3"]);
  });

  it("puts an item whose time does not parse at the end, rather than losing it", () => {
    assert.deepEqual(shape(interleave(THREAD, [item("odd", "yesterday")])), [
      "c:c1",
      "c:c2",
      "c:c3",
      "i:odd",
    ]);
  });
});
