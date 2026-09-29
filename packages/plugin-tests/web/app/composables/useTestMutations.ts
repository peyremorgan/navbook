/**
 * The five writes, wrapped the way the host's are: each reports its commit
 * through `useCommitToast` and refreshes the listings a change can move.
 *
 * Two failures are the page's to answer rather than the shared toast's.
 * `STALE_CONTENT` on a plan or a run is the editor's: it keeps the draft and
 * shows what the file says now. `PRECONDITION` on a run is the runner's: it
 * says which branch the pull request lives on, the way the review form does.
 * Those writes rethrow; the rest swallow, since the toast has spoken.
 */

import { useMutation } from "@vue/apollo-composable";
import { describeApiError, staleEdit, unservedBranch } from "~/utils/errors";
import type {
  AttachToTestRunInput,
  CreateTestPlanInput,
  SaveTestRunInput,
  StartTestRunInput,
  UpdateTestPlanInput,
} from "../../src/generated/gql/graphql";
import {
  ATTACH_TO_TEST_RUN,
  CREATE_TEST_PLAN,
  SAVE_TEST_RUN,
  START_TEST_RUN,
  UPDATE_TEST_PLAN,
} from "../graphql/mutations";

/** Codes a page answers itself, so the shared toast stays quiet about them. */
const ASKED = { handledCodes: ["STALE_CONTENT", "PRECONDITION"] } as const;

/** The message a stale save was refused with, or null for any other failure. */
export function staleContent(error: unknown): string | null {
  return staleEdit(describeApiError(error))?.message ?? null;
}

/** The branch a refused write belongs on, or null for any other failure. */
export function refusedBranch(error: unknown): string | null {
  return unservedBranch(describeApiError(error));
}

export function useTestMutations() {
  const create = useMutation(CREATE_TEST_PLAN);
  const update = useMutation(UPDATE_TEST_PLAN, () => ({ context: ASKED }));
  const start = useMutation(START_TEST_RUN, () => ({ context: ASKED }));
  const save = useMutation(SAVE_TEST_RUN, () => ({ context: ASKED }));
  const attach = useMutation(ATTACH_TO_TEST_RUN, () => ({ context: ASKED }));
  const commit = useCommitToast();
  const refreshListings = useListingRefresh();

  const busy = computed(
    () =>
      create.loading.value ||
      update.loading.value ||
      start.loading.value ||
      save.loading.value ||
      attach.loading.value,
  );

  return {
    busy,

    /** Null when refused; the shared toast has said why. */
    async createPlan(input: CreateTestPlanInput) {
      try {
        const payload = (await create.mutate({ input }))?.data?.createTestPlan;
        if (payload) {
          commit.report(payload.commit, "Created");
          refreshListings();
        }
        return payload ?? null;
      } catch {
        return null;
      }
    },

    /** Rethrows, so the editor can answer a stale save. */
    async updatePlan(input: UpdateTestPlanInput) {
      const payload = (await update.mutate({ input }))?.data?.updateTestPlan;
      if (payload) {
        commit.report(payload.commit, "Saved");
        refreshListings();
      }
      return payload ?? null;
    },

    /** Rethrows, so the caller can say which branch a refused run belongs on. */
    async startRun(input: StartTestRunInput) {
      const payload = (await start.mutate({ input }))?.data?.startTestRun;
      if (payload) {
        commit.report(payload.commit, "Run started");
        refreshListings();
      }
      return payload ?? null;
    },

    /** Rethrows, so the runner can keep its draft and say why. */
    async saveRun(input: SaveTestRunInput) {
      const payload = (await save.mutate({ input }))?.data?.saveTestRun;
      if (payload) {
        commit.report(payload.commit, input.finish ? "Run finished" : "Progress saved");
        refreshListings();
      }
      return payload ?? null;
    },

    /** Rethrows, for the same reason as `saveRun`. */
    async attach(input: AttachToTestRunInput) {
      const payload = (await attach.mutate({ input }))?.data?.attachToTestRun;
      if (payload) commit.report(payload.commit, "Attached");
      return payload ?? null;
    },
  };
}
