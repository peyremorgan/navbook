/**
 * The assistant's two documents.
 *
 * `CHAT_STATUS_QUERY` decides whether the button is shown at all: null when
 * the server has no model configured, and a validation error when the server
 * does not have this plugin — both mean "nothing to offer". The subscription
 * is sent by `useChatSession` over a streaming `fetch`, not through Apollo, so
 * it is only ever printed; writing it here lets codegen check it all the same.
 */

import { graphql } from "../../src/generated/gql";

export const CHAT_STATUS_QUERY = graphql(`
  query ChatStatus {
    chat {
      model
      endpoint
    }
  }
`);

export const CHAT_SUBSCRIPTION = graphql(`
  subscription Chat($input: ChatInput!) {
    chat(input: $input) {
      type
      delta
      callId
      tool
      arguments
      summary
      ok
      commit {
        committed
        subject
        pushed
      }
      record {
        kind
        id
      }
      reason
      transcript
      message
      code
    }
  }
`);
