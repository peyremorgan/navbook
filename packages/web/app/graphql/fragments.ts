/**
 * The field sets every operation is built from.
 *
 * Keeping them here rather than inline in components is what makes
 * `codegen.ts`'s one glob sufficient, and it is also the only way two views of
 * the same entity stay consistent: a list row and a detail header read the same
 * fragment, so the Apollo cache holds one normalised copy of each entity rather
 * than two half-populated ones.
 */

import { graphql } from "~~/src/generated/gql";

/** Everything issues and pull requests share; enough to render a list row. */
export const ENTITY_CORE = graphql(`
  fragment EntityCore on Entity {
    id
    slug
    kind
    status
    path
    archived
    title
    author
    created
    labels
    assignees
    milestone
    features
  }
`);

export const COMMENT_FIELDS = graphql(`
  fragment CommentFields on Comment {
    id
    path
    created
    author
    replyTo
    verdict
    revision
    file
    line
    body
  }
`);

export const ISSUE_LIST_ITEM = graphql(`
  fragment IssueListItem on Issue {
    ...EntityCore
    resolution
  }
`);

export const PR_LIST_ITEM = graphql(`
  fragment PrListItem on Pr {
    ...EntityCore
    target
    source
    draft
    refs
    reviewers
    reviewDecision
    merged {
      date
      by
      commit
    }
  }
`);

/**
 * One decomposition node without its children.
 *
 * The node is always returned, even when it can show nothing: `notAnIssue`,
 * `cycle` and `repeated` each mean a different thing to say to the reader, so
 * all three are fetched and none is inferred.
 */
export const LINK_NODE_CORE = graphql(`
  fragment LinkNodeCore on LinkNode {
    id
    notAnIssue
    cycle
    repeated
    issue {
      id
      title
      status
    }
  }
`);

/**
 * A subtask forest three levels deep, which is what `subtasks(depth: 3)` fills.
 *
 * GraphQL fragments cannot recurse, so the nesting is spelled out and the depth
 * argument is kept in step with it; `SUBTASK_DEPTH` is the single place that
 * says how deep, and `app/utils/subtasks.ts` walks whatever comes back.
 */
export const LINK_NODE_TREE = graphql(`
  fragment LinkNodeTree on LinkNode {
    ...LinkNodeCore
    children {
      ...LinkNodeCore
      children {
        ...LinkNodeCore
      }
    }
  }
`);

export const ISSUE_DETAIL = graphql(`
  fragment IssueDetail on Issue {
    ...EntityCore
    body
    resolution
    duplicateOf
    parent {
      ...LinkNodeCore
    }
    subtasks(depth: 3) {
      ...LinkNodeTree
    }
    comments {
      ...CommentFields
    }
  }
`);

export const PR_DETAIL = graphql(`
  fragment PrDetail on Pr {
    ...PrListItem
    body
    revisions {
      head
      base
      date
    }
    reviews {
      person
      state
      volunteer
      comment
    }
    comments {
      ...CommentFields
    }
  }
`);

/**
 * A feature as its listing row shows it, members included for the counts.
 *
 * `path` is selected on each document although the row never draws it: it is
 * the cache key for a `Spec`, and a normalised object Apollo cannot key is an
 * error rather than a quietly denormalised copy.
 */
export const FEATURE_LIST_ITEM = graphql(`
  fragment FeatureListItem on Feature {
    slug
    title
    author
    created
    summary
    specs {
      path
      fileName
      title
    }
    issues {
      id
      status
    }
    prs {
      id
      status
    }
  }
`);

/** One of a feature's documents, whole. */
export const SPEC_DETAIL = graphql(`
  fragment SpecDetail on Spec {
    fileName
    title
    path
    body
    baseSha
  }
`);

/**
 * A feature's page: the card, its documents, and the work and history that
 * make up its timeline. The entities come back as list rows because that is
 * what the timeline renders them as.
 */
export const FEATURE_DETAIL = graphql(`
  fragment FeatureDetail on Feature {
    slug
    title
    author
    created
    summary
    path
    baseSha
    specs {
      ...SpecDetail
    }
    issues {
      ...IssueListItem
    }
    prs {
      ...PrListItem
    }
    commits {
      sha
      subject
      author
      date
    }
  }
`);
