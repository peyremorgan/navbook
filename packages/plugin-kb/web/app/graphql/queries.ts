/**
 * Every read this plugin makes.
 *
 * `FEATURES_QUERY` is asked for by three different things — the listing page,
 * the suggestions on an entity's feature editor, and the filter bar's menu —
 * and each of them reads it `cache-first`. A feature is a real directory, so
 * unlike labels and milestones it is a registry rather than something guessed
 * from whatever a listing happened to contain.
 */

import { graphql } from "../../src/generated/gql";

export const FEATURES_QUERY = graphql(`
  query Features {
    features {
      ...FeatureListItem
    }
  }
`);

export const FEATURE_QUERY = graphql(`
  query Feature($slug: String!) {
    feature(slug: $slug) {
      ...FeatureDetail
    }
  }
`);
