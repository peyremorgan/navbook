/**
 * The field sets this layer's operations are built from.
 *
 * Its own, because a fragment registry does not cross a package: this layer
 * generates from the composed schema and its own documents, and the host's
 * fragments are not among them.
 *
 * `path` is selected wherever an attachment is, and `slug` and `id` wherever a
 * plan or a run is: they are the cache keys `50.tests.ts` declares, and an
 * object Apollo cannot key is an error rather than a quietly duplicated copy.
 */

import { graphql } from "../../src/generated/gql";

/** A run, as a row in a listing: enough to say what it concluded and about what. */
export const TEST_RUN_ROW = graphql(`
  fragment TestRunRow on TestRun {
    id
    planSlug
    author
    started
    finished
    commit
    version
    outcome
    pr {
      id
    }
  }
`);

/** A plan, as a row in the listing. */
export const TEST_PLAN_ROW = graphql(`
  fragment TestPlanRow on TestPlan {
    slug
    title
    author
    created
    steps {
      number
    }
    stats {
      runs
      passed
      failed
      blocked
      skipped
      incomplete
      inProgress
    }
    runs {
      ...TestRunRow
    }
  }
`);

/** A plan, whole: what its page and its editor show. */
export const TEST_PLAN_DETAIL = graphql(`
  fragment TestPlanDetail on TestPlan {
    slug
    title
    author
    created
    description
    path
    baseSha
    steps {
      number
      title
      actions
      expected
    }
    stats {
      runs
      passed
      failed
      blocked
      skipped
      incomplete
      inProgress
    }
    runs {
      ...TestRunRow
    }
  }
`);

/** A run, whole: every step of the plan it followed, beside what it recorded. */
export const TEST_RUN_DETAIL = graphql(`
  fragment TestRunDetail on TestRun {
    id
    path
    planSlug
    planSha
    author
    started
    finished
    commit
    version
    environment
    notes
    outcome
    stepsFrom
    baseSha
    plan {
      slug
      title
    }
    pr {
      id
      title
      refs
    }
    results {
      number
      title
      actions
      expected
      status
      actual
    }
    attachments {
      name
      path
    }
  }
`);
