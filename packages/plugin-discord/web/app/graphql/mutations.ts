/** Linking and unlinking a Discord account, as the signed-in person. */

import { graphql } from "../../src/generated/gql";

export const LINK_DISCORD = graphql(`
  mutation LinkDiscord($code: String!) {
    linkDiscord(code: $code) {
      link {
        userId
        username
        handle
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UNLINK_DISCORD = graphql(`
  mutation UnlinkDiscord {
    unlinkDiscord {
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);
