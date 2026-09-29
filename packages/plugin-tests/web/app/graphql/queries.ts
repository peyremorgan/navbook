/**
 * Every read this layer makes.
 */

import { graphql } from "../../src/generated/gql";

export const TEST_PLANS_QUERY = graphql(`
  query TestPlans {
    testPlans {
      ...TestPlanRow
    }
  }
`);

export const TEST_PLAN_QUERY = graphql(`
  query TestPlan($slug: String!) {
    testPlan(slug: $slug) {
      ...TestPlanDetail
    }
  }
`);

export const TEST_RUN_QUERY = graphql(`
  query TestRun($id: ID!) {
    testRun(id: $id) {
      ...TestRunDetail
    }
  }
`);

/**
 * A pull request's runs, for the panel on its page. The panel is handed the
 * page's edit state rather than the pull request, so it asks for what it
 * needs itself; `pr(ref)` is the host's field, keyed the same way, so this
 * shares the page's cache entry.
 */
export const PR_TEST_RUNS_QUERY = graphql(`
  query PrTestRuns($ref: ID!) {
    pr(ref: $ref) {
      id
      refs
      tested
      revisions {
        head
      }
      testRuns {
        ...TestRunRow
      }
    }
  }
`);

/** One attachment's bytes, fetched when somebody opens it. */
export const TEST_ATTACHMENT_QUERY = graphql(`
  query TestAttachment($run: ID!, $name: String!) {
    testAttachment(run: $run, name: $name) {
      name
      contentType
      size
      base64
    }
  }
`);
