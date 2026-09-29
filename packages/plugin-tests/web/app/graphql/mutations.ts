/**
 * Every write this layer makes. Each returns `commit { committed subject
 * pushed }`, reported through the host's own `useCommitToast`, so a run saved
 * here says what an issue saved in the host says.
 */

import { graphql } from "../../src/generated/gql";

export const CREATE_TEST_PLAN = graphql(`
  mutation CreateTestPlan($input: CreateTestPlanInput!) {
    createTestPlan(input: $input) {
      plan {
        ...TestPlanDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const UPDATE_TEST_PLAN = graphql(`
  mutation UpdateTestPlan($input: UpdateTestPlanInput!) {
    updateTestPlan(input: $input) {
      plan {
        ...TestPlanDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const START_TEST_RUN = graphql(`
  mutation StartTestRun($input: StartTestRunInput!) {
    startTestRun(input: $input) {
      run {
        ...TestRunDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const SAVE_TEST_RUN = graphql(`
  mutation SaveTestRun($input: SaveTestRunInput!) {
    saveTestRun(input: $input) {
      run {
        ...TestRunDetail
      }
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);

export const ATTACH_TO_TEST_RUN = graphql(`
  mutation AttachToTestRun($input: AttachToTestRunInput!) {
    attachToTestRun(input: $input) {
      run {
        ...TestRunDetail
      }
      names
      commit {
        committed
        subject
        pushed
      }
    }
  }
`);
