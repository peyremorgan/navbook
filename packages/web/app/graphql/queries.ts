/**
 * Every read the client makes.
 *
 * The API has no pagination and no sort argument: a listing is the whole
 * matching set, newest first. That is a deliberate property of the server
 * (spec 06 §6.6 rejects anything index-like), so paging and sorting are the
 * client's job — see `app/utils/paging.ts`. It also means a listing already
 * holds every label, assignee and milestone in play, which is where the filter
 * bar's suggestions come from; there is no registry to query. Features are the
 * exception: `FEATURES_QUERY` is a real registry, because a feature exists
 * whether or not any issue names it yet.
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

/**
 * How this repository counts reviews (spec 02 §2.10).
 *
 * A property of the repository rather than of any pull request, so it is asked
 * for once and read beside whichever pull request is on screen. `problems` is
 * why the numbers may be the defaults: a marker nobody can read is reported
 * rather than obeyed, and the page says so instead of quietly counting wrong.
 */
export const REVIEW_POLICY_QUERY = graphql(`
  query ReviewPolicy {
    reviewPolicy {
      selfReview
      minApprovals
      declared
      problems
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

/**
 * Everything that concerns the signed-in person, in one round trip.
 *
 * Four questions are asked of the same address, and which one an entity came
 * back in is the whole of why it is in the inbox — the client never compares an
 * address with another (`app/utils/people.ts`), so the field it arrived in is
 * what a row says about itself.
 *
 * Pull requests are asked for across every fetched branch, because a pull
 * request's files live on the branch it proposes to merge (spec 03 §3.5) and
 * the person's own are exactly the ones the serving checkout is least likely to
 * hold. That scan finds open pull requests only, so the finished half asks the
 * working tree instead — a different question, and the reason these are two
 * fields rather than one with a wider status.
 *
 * Finished work is asked for only when somebody asks for it, and no review
 * request is asked for there at all: a request on a pull request that has since
 * merged is not work waiting for anybody.
 */
export const INBOX_QUERY = graphql(`
  query Inbox($me: String!, $text: [String!], $finished: Boolean!) {
    assignedIssues: issues(filter: { assignees: [$me], status: [OPEN], text: $text }) {
      ...IssueListItem
    }
    assignedPrs: prs(filter: { assignees: [$me], status: [OPEN], text: $text }, allRefs: true) {
      ...PrListItem
    }
    authoredPrs: prs(filter: { authors: [$me], status: [OPEN], text: $text }, allRefs: true) {
      ...PrListItem
    }
    awaitingPrs: prs(filter: { awaiting: [$me], status: [OPEN], text: $text }, allRefs: true) {
      ...PrListItem
    }
    finishedAssignedIssues: issues(filter: { assignees: [$me], status: [CLOSED], text: $text })
      @include(if: $finished) {
      ...IssueListItem
    }
    finishedAssignedPrs: prs(
      filter: { assignees: [$me], status: [CLOSED, MERGED], text: $text }
      allRefs: false
    ) @include(if: $finished) {
      ...PrListItem
    }
    finishedAuthoredPrs: prs(
      filter: { authors: [$me], status: [CLOSED, MERGED], text: $text }
      allRefs: false
    ) @include(if: $finished) {
      ...PrListItem
    }
  }
`);
