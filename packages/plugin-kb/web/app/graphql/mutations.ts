/**
 * Every write this plugin makes.
 *
 * All four return `commit { committed subject pushed }`, and all four mean it,
 * exactly as the host's own mutations do: the server commits to its clone and
 * pushes, so a payload with `pushed: false` is a change that exists nowhere
 * but that clone. `useFeatureMutations` reports that through the host's own
 * `useCommitToast`, so a feature's save says what an issue's save says.
 *
 * The two writes an entity's *feature list* goes through are not here. They
 * are `updateIssue` and `updatePr` — the host's mutations, with a field this
 * plugin's SDL added to their inputs — so a feature attached from an issue's
 * page is one commit to one file, not a second write of its own.
 */

import { graphql } from "../../src/generated/gql";

export const CREATE_FEATURE = graphql(`
  mutation CreateFeature($input: CreateFeatureInput!) {
    createFeature(input: $input) {
      feature {
        ...FeatureDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UPDATE_FEATURE = graphql(`
  mutation UpdateFeature($input: UpdateFeatureInput!) {
    updateFeature(input: $input) {
      feature {
        ...FeatureDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const ADD_SPEC = graphql(`
  mutation AddSpec($input: AddSpecInput!) {
    addSpec(input: $input) {
      feature {
        ...FeatureDetail
      }
      spec {
        ...SpecDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UPDATE_SPEC = graphql(`
  mutation UpdateSpec($input: UpdateSpecInput!) {
    updateSpec(input: $input) {
      feature {
        ...FeatureDetail
      }
      spec {
        ...SpecDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);
