/**
 * Every write this layer makes. Each answers with the poll as it now is, the
 * issue's `ext` and polls — so the discussion and the panel pick a new poll
 * up without asking — and `commit { committed subject pushed }`, reported
 * through the host's own `useCommitToast`.
 */

import { graphql } from "../../src/generated/gql";

export const OPEN_POLL = graphql(`
  mutation OpenPoll($input: OpenPollInput!) {
    openPoll(input: $input) {
      ...PollPayloadFields
    }
  }
`);

export const EDIT_POLL = graphql(`
  mutation EditPoll($input: EditPollInput!) {
    editPoll(input: $input) {
      ...PollPayloadFields
    }
  }
`);

export const VOTE_POLL = graphql(`
  mutation VotePoll($input: VotePollInput!) {
    votePoll(input: $input) {
      ...PollPayloadFields
    }
  }
`);

export const CLOSE_POLL = graphql(`
  mutation ClosePoll($input: ClosePollInput!) {
    closePoll(input: $input) {
      ...PollPayloadFields
    }
  }
`);

export const REOPEN_POLL = graphql(`
  mutation ReopenPoll($input: ReopenPollInput!) {
    reopenPoll(input: $input) {
      ...PollPayloadFields
    }
  }
`);

export const POLL_PAYLOAD_FIELDS = graphql(`
  fragment PollPayloadFields on PollPayload {
    poll {
      ...PollCard
    }
    issue {
      id
      ext
      polls {
        ...PollRow
      }
    }
    revoked
    late
    commit {
      committed
      subject
      pushed
    }
  }
`);
