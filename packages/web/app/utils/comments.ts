/**
 * Comments as a conversation rather than a pile.
 *
 * On disk a comment is one file, which is what makes two people commenting at
 * once impossible to conflict (spec 02 §2.6) — and it means the API hands back
 * a flat, chronological list with `replyTo` as the only structure. This builds
 * the tree that structure implies.
 *
 * Two cases have to survive it. A reply whose parent is not in the list is
 * shown at the top level rather than dropped, because the reply is real even
 * when what it answered has been deleted by hand. And `replyTo` chains that
 * loop — which nothing prevents, since the files are edited by people — are
 * broken rather than followed, so a hand-edited tree cannot hang the page.
 */

import type { CommentFieldsFragment } from "~~/src/generated/gql/graphql";

export interface CommentNode {
  comment: CommentFieldsFragment;
  /** True when `replyTo` named a comment this thread cannot show. */
  orphaned: boolean;
  replies: CommentNode[];
}

/** True when the comment records a verdict, which makes it a review (§2.6). */
export function isReview(comment: CommentFieldsFragment): boolean {
  return comment.verdict !== null && comment.verdict !== undefined;
}

/** Whether `id` can reach a root without passing through itself. */
function reachesRoot(id: string, parentOf: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>([id]);
  let current = parentOf.get(id);
  while (current !== undefined) {
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current);
  }
  return true;
}

/**
 * The comment forest, in the order the API gave them.
 *
 * Replies keep their own chronological order under each parent, and roots keep
 * theirs, so nothing is re-sorted: the server already ordered the list, and a
 * second opinion here would only be another thing to keep in step.
 */
export function buildCommentTree(comments: readonly CommentFieldsFragment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { comment, orphaned: false, replies: [] });
  }

  const parentOf = new Map<string, string>();
  for (const comment of comments) {
    const parent = comment.replyTo;
    if (parent != null && parent !== comment.id && nodes.has(parent)) {
      parentOf.set(comment.id, parent);
    }
  }

  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id);
    if (node === undefined) continue;
    const parentId = parentOf.get(comment.id);
    // A parent that is not here, and a chain that loops, mean the same thing to
    // the reader: this reply has nothing above it to nest under.
    if (parentId === undefined || !reachesRoot(comment.id, parentOf)) {
      node.orphaned = comment.replyTo != null;
      roots.push(node);
      continue;
    }
    nodes.get(parentId)?.replies.push(node);
  }
  return roots;
}

/** How many comments a forest holds, replies included. */
export function countComments(nodes: readonly CommentNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countComments(node.replies), 0);
}
