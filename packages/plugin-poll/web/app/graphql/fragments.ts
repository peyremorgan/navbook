/**
 * The field sets this layer's operations are built from.
 *
 * Its own, because a fragment registry does not cross a package. `id` is
 * selected wherever a poll or a vote is: they are the cache keys `50.poll.ts`
 * declares.
 */

import { graphql } from "../../src/generated/gql";

/** A poll as a list shows it: the sidebar panel, an inbox row's badge. */
export const POLL_ROW = graphql(`
  fragment PollRow on Poll {
    id
    title
    status
    closedByIssue
    voters
    deadline
    myState
  }
`);

/** A poll whole, as its card in the discussion shows it to the person looking. */
export const POLL_CARD = graphql(`
  fragment PollCard on Poll {
    id
    path
    baseSha
    title
    author
    created
    preamble
    results
    deadline
    fingerprint
    status
    closedByIssue
    closed
    closedBy
    decisionNote
    voters
    problems
    myState
    questions {
      id
      text
      multi
      other
      options {
        id
        label
        description
      }
    }
    outcome {
      question
      picks
      other
    }
    proposed {
      question
      picks
      other
    }
    tallies {
      question
      answered
      tied
      leaders
      options {
        option
        count
        voters
      }
      others {
        text
        voter
      }
    }
    myBallot {
      id
      state
      note
      answers {
        question
        picks
        other
      }
    }
    myDraft {
      note
      answers {
        question
        picks
        other
      }
    }
    issue {
      id
      status
    }
  }
`);
