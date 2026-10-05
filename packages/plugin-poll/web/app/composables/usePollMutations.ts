/**
 * The five writes, wrapped the way the host's are: each reports its commit
 * through `useCommitToast` and refreshes the listings a change can move — an
 * issue's row badge, and the inbox's poll reason.
 *
 * `STALE_CONTENT` is the card's to answer rather than the shared toast's: the
 * poll changed under the form, and the card says so and shows it as it is
 * now. Those writes rethrow it; every other refusal the toast has already
 * spoken for, and the write answers null.
 */

import { useMutation } from "@vue/apollo-composable";
import type { InjectionKey } from "vue";
import { describeApiError, staleEdit } from "~/utils/errors";
import type {
  ClosePollInput,
  EditPollInput,
  OpenPollInput,
  ReopenPollInput,
  VotePollInput,
} from "../../src/generated/gql/graphql";
import { CLOSE_POLL, EDIT_POLL, OPEN_POLL, REOPEN_POLL, VOTE_POLL } from "../graphql/mutations";

/** Codes a card answers itself, so the shared toast stays quiet about them. */
const ASKED = { handledCodes: ["STALE_CONTENT"] } as const;

/** The message a stale write was refused with, or null for any other failure. */
export function staleContent(error: unknown): string | null {
  return staleEdit(describeApiError(error))?.message ?? null;
}

/**
 * The writes, one set per poll: the card makes them, and the editor and the
 * close dialog inside it use the card's, so its busy state covers a save made
 * from either. Anywhere with no card above it — the panel's "New poll" —
 * makes a set of its own.
 */
export function usePollMutations(): PollMutations {
  const shared = inject(POLL_MUTATIONS, null);
  if (shared !== null) return shared;
  const own = createPollMutations();
  provide(POLL_MUTATIONS, own);
  return own;
}

export type PollMutations = ReturnType<typeof createPollMutations>;
const POLL_MUTATIONS: InjectionKey<PollMutations> = Symbol("poll-mutations");

function createPollMutations() {
  const open = useMutation(OPEN_POLL);
  const edit = useMutation(EDIT_POLL, () => ({ context: ASKED }));
  const vote = useMutation(VOTE_POLL, () => ({ context: ASKED }));
  const close = useMutation(CLOSE_POLL, () => ({ context: ASKED }));
  const reopen = useMutation(REOPEN_POLL, () => ({ context: ASKED }));
  const commit = useCommitToast();
  const refreshListings = useListingRefresh();

  const busy = computed(
    () =>
      open.loading.value ||
      edit.loading.value ||
      vote.loading.value ||
      close.loading.value ||
      reopen.loading.value,
  );

  /**
   * One write: its payload reported and the listings refreshed, a stale
   * refusal rethrown, anything else answered with null.
   */
  async function run<
    P extends { commit: { committed: boolean; subject: string; pushed: boolean } },
  >(send: () => Promise<P | null | undefined>, done: string): Promise<P | null> {
    try {
      const payload = (await send()) ?? null;
      if (payload) {
        commit.report(payload.commit, done);
        refreshListings();
      }
      return payload;
    } catch (error) {
      if (staleContent(error) !== null) throw error;
      return null;
    }
  }

  return {
    busy,
    openPoll: (input: OpenPollInput) =>
      run(async () => (await open.mutate({ input }))?.data?.openPoll, "Poll opened"),
    /** Rethrows a stale refusal: the questions or the title changed since the editor opened. */
    editPoll: (input: EditPollInput) =>
      run(async () => (await edit.mutate({ input }))?.data?.editPoll, "Poll saved"),
    /** Rethrows a stale refusal: the questions changed since the form was built. */
    votePoll: (input: VotePollInput, withdrawing: boolean) =>
      run(
        async () => (await vote.mutate({ input }))?.data?.votePoll,
        withdrawing ? "Vote withdrawn" : "Vote cast",
      ),
    closePoll: (input: ClosePollInput) =>
      run(async () => (await close.mutate({ input }))?.data?.closePoll, "Poll closed"),
    reopenPoll: (input: ReopenPollInput) =>
      run(async () => (await reopen.mutate({ input }))?.data?.reopenPoll, "Poll reopened"),
  };
}
