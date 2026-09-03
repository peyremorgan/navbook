/**
 * Reading a decomposition tree the server may not have been able to complete.
 *
 * `LinkNode` is deliberately not just an issue: a link can name something the
 * tree cannot show, and each case is a different thing to tell the reader
 * (schema, `LinkNode`). An unfetched branch means the issue is elsewhere; a
 * pull request means the link should never have been made; a cycle means the
 * chain loops here; `repeated` means the subtree is drawn somewhere above.
 *
 * Collapsing those into "missing" would be a lie in three of the four cases,
 * so the state is named and the component renders each one differently.
 */

import type { LinkNodeCoreFragment } from "~~/src/generated/gql/graphql";

export type LinkState = "issue" | "notAnIssue" | "cycle" | "repeated" | "unknown";

/** A node with its children, whatever depth the query asked for. */
export interface LinkTreeNode extends LinkNodeCoreFragment {
  children?: readonly LinkTreeNode[] | null;
}

/**
 * Which of the four things this node is.
 *
 * `cycle` and `repeated` are checked before the issue, because a node can carry
 * both an issue and a flag: the flag is why it is not expanded, and it is what
 * the reader needs to know.
 */
export function linkState(node: LinkNodeCoreFragment): LinkState {
  if (node.notAnIssue) return "notAnIssue";
  if (node.cycle) return "cycle";
  if (node.repeated) return "repeated";
  return node.issue ? "issue" : "unknown";
}

/** What to say about a node that is not a plain, expandable issue. */
export function linkNote(state: LinkState): string | null {
  switch (state) {
    case "notAnIssue":
      return "names a pull request, which decomposition does not relate";
    case "cycle":
      return "the chain of parents loops back here";
    case "repeated":
      return "shown above; not expanded again";
    case "unknown":
      return "no issue with this id is in this checkout";
    default:
      return null;
  }
}

/** How many issues a forest actually shows, ignoring what it could not. */
export function countSubtasks(nodes: readonly LinkTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (linkState(node) === "issue" ? 1 : 0) + countSubtasks(node.children ?? []),
    0,
  );
}
