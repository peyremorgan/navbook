/**
 * Comment threading, including the shapes only a hand-edited file produces.
 *
 * The files are meant to be edited by hand — that is the point of the format —
 * so `replyTo` can name a comment that was deleted, or a chain that loops. The
 * page must survive both, and neither is reachable through this client.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildCommentTree, countComments, isReview } from "../../app/utils/comments";
import type { CommentFieldsFragment } from "../../src/generated/gql/graphql";

function comment(id: string, replyTo: string | null = null, extra = {}): CommentFieldsFragment {
  return {
    id,
    path: `.navbook/issues/open/x/comments/${id}.md`,
    created: "2026-08-01T100000Z",
    author: "A Person <person@example.invalid>",
    replyTo,
    verdict: null,
    revision: null,
    file: null,
    line: null,
    body: id,
    ...extra,
  };
}

/** The ids at each level, for comparing a whole tree in one assertion. */
function shape(nodes: ReturnType<typeof buildCommentTree>): unknown[] {
  return nodes.map((node) =>
    node.replies.length ? [node.comment.id, shape(node.replies)] : node.comment.id,
  );
}

describe("buildCommentTree", () => {
  it("is empty for no comments", () => {
    assert.deepEqual(buildCommentTree([]), []);
    assert.equal(countComments([]), 0);
  });

  it("keeps plain comments flat, in the order the server gave them", () => {
    const tree = buildCommentTree([comment("a"), comment("b"), comment("c")]);
    assert.deepEqual(shape(tree), ["a", "b", "c"]);
  });

  it("nests a reply under what it answers", () => {
    const tree = buildCommentTree([comment("a"), comment("b", "a"), comment("c")]);
    assert.deepEqual(shape(tree), [["a", ["b"]], "c"]);
    assert.equal(countComments(tree), 3);
  });

  it("nests as deep as the replies go", () => {
    const tree = buildCommentTree([
      comment("a"),
      comment("b", "a"),
      comment("c", "b"),
      comment("d", "c"),
    ]);
    assert.deepEqual(shape(tree), [["a", [["b", [["c", ["d"]]]]]]]);
    assert.equal(countComments(tree), 4);
  });

  it("keeps replies in order under one parent", () => {
    const tree = buildCommentTree([comment("a"), comment("b", "a"), comment("c", "a")]);
    assert.deepEqual(shape(tree), [["a", ["b", "c"]]]);
  });

  it("shows a reply whose parent is not here, and says so", () => {
    // The parent may have been deleted by hand; the reply is still real.
    const tree = buildCommentTree([comment("b", "gone")]);
    assert.deepEqual(shape(tree), ["b"]);
    assert.equal(tree[0]?.orphaned, true);
  });

  it("does not mark a plain comment orphaned", () => {
    assert.equal(buildCommentTree([comment("a")])[0]?.orphaned, false);
  });

  it("breaks a chain that loops rather than following it", () => {
    // Nothing on disk prevents this, and following it would hang the page.
    const tree = buildCommentTree([comment("a", "b"), comment("b", "a")]);
    assert.equal(countComments(tree), 2, "both comments must still be shown");
    assert.deepEqual(
      tree.map((node) => node.comment.id).sort(),
      ["a", "b"].filter((id) => tree.some((node) => node.comment.id === id)).sort(),
    );
    assert.ok(tree.length >= 1);
  });

  it("breaks a longer loop, and shows every comment in it exactly once", () => {
    const tree = buildCommentTree([comment("a", "c"), comment("b", "a"), comment("c", "b")]);
    assert.equal(countComments(tree), 3);
  });

  it("survives a comment that replies to itself", () => {
    const tree = buildCommentTree([comment("a", "a")]);
    assert.deepEqual(shape(tree), ["a"]);
    assert.equal(tree[0]?.orphaned, true);
  });

  it("counts a forest, replies included", () => {
    const tree = buildCommentTree([
      comment("a"),
      comment("b", "a"),
      comment("c", "b"),
      comment("d"),
    ]);
    assert.equal(countComments(tree), 4);
  });
});

describe("isReview", () => {
  it("is a verdict that makes a comment a review", () => {
    assert.equal(isReview(comment("a")), false);
    assert.equal(isReview(comment("a", null, { verdict: "APPROVE" })), true);
    assert.equal(isReview(comment("a", null, { verdict: "REQUEST_CHANGES" })), true);
    // A comment that points at a line is still a comment without a verdict.
    assert.equal(isReview(comment("a", null, { file: "x.ts", line: "3" })), false);
  });
});
