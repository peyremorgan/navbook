/**
 * What the layer reads: whether the server runs a bridge, who the viewer is
 * linked to, and where a record's thread is.
 *
 * `discord` is null on a server that runs no bridge, and refused outright by
 * one without this plugin; the components read both as "nothing to show".
 */

import { graphql } from "../../src/generated/gql";

export const DISCORD_LINK_QUERY = graphql(`
  query DiscordLink {
    discord {
      guild
    }
    viewer {
      email
      discord {
        userId
        username
      }
    }
  }
`);

export const DISCORD_THREAD_QUERY = graphql(`
  query DiscordThread($ref: ID!) {
    discord {
      thread(ref: $ref) {
        id
        url
      }
    }
  }
`);
