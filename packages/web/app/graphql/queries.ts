/**
 * Every read the client makes.
 *
 * The API has no pagination and no sort argument: a listing is the whole
 * matching set, newest first. That is a deliberate property of the server
 * (spec 06 §6.6 rejects anything index-like), so paging and sorting are the
 * client's job — see `app/utils/paging.ts`. It also means a listing already
 * holds every label, assignee and milestone in play, which is where the filter
 * bar's suggestions come from; there is no registry to query.
 */

import { graphql } from "~~/src/generated/gql";

export const VIEWER_QUERY = graphql(`
  query Viewer {
    viewer {
      name
      email
    }
  }
`);

export const ISSUES_QUERY = graphql(`
  query Issues($filter: EntityFilter) {
    issues(filter: $filter) {
      ...IssueListItem
    }
  }
`);

export const ISSUE_QUERY = graphql(`
  query Issue($ref: ID!) {
    issue(ref: $ref) {
      ...IssueDetail
    }
  }
`);

export const PRS_QUERY = graphql(`
  query Prs($filter: EntityFilter, $allRefs: Boolean!) {
    prs(filter: $filter, allRefs: $allRefs) {
      ...PrListItem
    }
  }
`);

export const PR_QUERY = graphql(`
  query Pr($ref: ID!) {
    pr(ref: $ref) {
      ...PrDetail
    }
  }
`);
