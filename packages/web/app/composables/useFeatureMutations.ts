/**
 * The four feature writes, wrapped the way the issue writes are.
 *
 * `STALE_CONTENT` is handled here rather than toasted: it is the one failure a
 * page can do something about — show what the file says now, and let the
 * author reapply their change — so the shared error toast is told to leave it
 * alone and the rejection is passed through to the caller.
 */

import { useMutation } from "@vue/apollo-composable";
import { ADD_SPEC, CREATE_FEATURE, UPDATE_FEATURE, UPDATE_SPEC } from "~/graphql/mutations";
import { describeApiError, staleEdit } from "~/utils/errors";

/** Codes a page answers itself, so the shared toast stays quiet about them. */
const ASKED = { handledCodes: ["STALE_CONTENT"] } as const;

/** The message a stale save was refused with, or null for any other failure. */
export function staleContent(error: unknown): string | null {
  return staleEdit(describeApiError(error))?.message ?? null;
}

export function useFeatureMutations() {
  const create = useMutation(CREATE_FEATURE);
  const updateFeature = useMutation(UPDATE_FEATURE, () => ({ context: ASKED }));
  const addSpec = useMutation(ADD_SPEC);
  const updateSpec = useMutation(UPDATE_SPEC, () => ({ context: ASKED }));
  const commit = useCommitToast();
  const refreshListings = useListingRefresh();

  /**
   * Run a write, report its commit, and swallow the rejection.
   *
   * Swallowed because the shared error link has already said so; the two
   * updates are the exception and rethrow, since only their caller can offer
   * the reload that answers a stale save.
   */
  async function reported<T>(
    body: () => Promise<T | null | undefined>,
    rethrow = false,
  ): Promise<T | null> {
    try {
      return (await body()) ?? null;
    } catch (error) {
      if (rethrow) throw error;
      return null;
    }
  }

  const busy = computed(
    () =>
      create.loading.value ||
      updateFeature.loading.value ||
      addSpec.loading.value ||
      updateSpec.loading.value,
  );

  return {
    busy,

    createFeature(input: { title: string; slug?: string | null; summary?: string | null }) {
      return reported(async () => {
        const payload = (await create.mutate({ input }))?.data?.createFeature;
        if (payload) {
          commit.report(payload.commit, "Created");
          refreshListings();
        }
        return payload;
      });
    },

    updateFeature(input: {
      slug: string;
      title?: string;
      summary?: string | null;
      baseSha: string;
    }) {
      return reported(async () => {
        const payload = (await updateFeature.mutate({ input }))?.data?.updateFeature;
        if (payload) commit.report(payload.commit, "Saved");
        return payload;
      }, true);
    },

    addSpec(input: { feature: string; title: string; body: string; fileName?: string | null }) {
      return reported(async () => {
        const payload = (await addSpec.mutate({ input }))?.data?.addSpec;
        if (payload) commit.report(payload.commit, "Added");
        return payload;
      });
    },

    updateSpec(input: {
      feature: string;
      fileName: string;
      title?: string;
      body?: string;
      baseSha: string;
    }) {
      return reported(async () => {
        const payload = (await updateSpec.mutate({ input }))?.data?.updateSpec;
        if (payload) commit.report(payload.commit, "Saved");
        return payload;
      }, true);
    },
  };
}
