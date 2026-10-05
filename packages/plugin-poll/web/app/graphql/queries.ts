/**
 * Every read this layer makes.
 */

import { graphql } from "../../src/generated/gql";

export const POLL_QUERY = graphql(`
  query Poll($id: ID!) {
    poll(id: $id) {
      ...PollCard
    }
  }
`);

/** An issue's polls, for its sidebar panel; `issue(ref)` is the host's, so it shares the page's cache entry. */
export const ISSUE_POLLS_QUERY = graphql(`
  query IssuePolls($ref: ID!) {
    issue(ref: $ref) {
      id
      status
      polls {
        ...PollRow
      }
    }
  }
`);
