/**
 * Every write the client makes.
 *
 * All of them return `commit { committed subject pushed }`, and all of them
 * mean it: the server commits to its own clone and pushes, so a payload with
 * `pushed: false` is a change that exists nowhere but that clone. The UI says
 * so rather than hiding it (`app/composables/useCommitToast.ts`) — conflicts
 * and half-landed writes surface, they are not smoothed over (spec 06 §6.3).
 */

import { graphql } from "~~/src/generated/gql";

export const OPEN_ISSUE = graphql(`
  mutation OpenIssue($input: OpenIssueInput!) {
    openIssue(input: $input) {
      issue {
        ...IssueDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UPDATE_ISSUE = graphql(`
  mutation UpdateIssue($input: UpdateIssueInput!) {
    updateIssue(input: $input) {
      issue {
        ...IssueDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const CLOSE_ISSUE = graphql(`
  mutation CloseIssue($input: CloseIssueInput!) {
    closeIssue(input: $input) {
      issue {
        ...IssueDetail
      }
      destination
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const REOPEN_ISSUE = graphql(`
  mutation ReopenIssue($ref: ID!) {
    reopenIssue(ref: $ref) {
      issue {
        ...IssueDetail
      }
      destination
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const ADD_COMMENT = graphql(`
  mutation AddComment($input: AddCommentInput!) {
    addComment(input: $input) {
      comment {
        ...CommentFields
      }
      entity {
        id
        comments {
          ...CommentFields
        }
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const LINK_ISSUE = graphql(`
  mutation LinkIssue($input: LinkIssueInput!) {
    linkIssue(input: $input) {
      child {
        ...IssueDetail
      }
      parent {
        ...IssueDetail
      }
      previousParentId
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UNLINK_ISSUE = graphql(`
  mutation UnlinkIssue($ref: ID!) {
    unlinkIssue(ref: $ref) {
      child {
        ...IssueDetail
      }
      previousParentId
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);
