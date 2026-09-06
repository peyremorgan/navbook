/**
 * Every write an issue page can make, in one place.
 *
 * The page is the only caller, but they are here rather than in it because
 * each one shares the same three concerns and none of them is about layout:
 * report what the commit did, forget the listings the write may have changed,
 * and let the page handle the failures that are really questions.
 *
 * The mutations return the issue, and the cache is normalised, so nothing here
 * writes to the cache by hand — the detail view updates because the entity did.
 */

import { useMutation } from "@vue/apollo-composable";
import {
  ADD_COMMENT,
  CLOSE_ISSUE,
  LINK_ISSUE,
  OPEN_ISSUE,
  REOPEN_ISSUE,
  UNLINK_ISSUE,
  UPDATE_ISSUE,
} from "~/graphql/mutations";
import type { IssuePatch } from "~/utils/patch";

/**
 * Failures the caller answers itself, so the shared toast stays quiet.
 *
 * Neither of these is really an error. `REPARENT_REQUIRED` is the server
 * asking whether you meant to move a subtask out from under the issue that
 * holds it — a question with a dialog behind it. `PRECONDITION` on a comment
 * names the branch to serve, which belongs beside the form, not in a toast
 * that disappears.
 */
const ASKED = { handledCodes: ["REPARENT_REQUIRED", "PRECONDITION"] };

/**
 * Run a write, and return null rather than throwing when it fails.
 *
 * The error link has already said what went wrong, in the one place a write's
 * failure can be said. Letting the rejection continue past that would only put
 * an unhandled promise into an event handler, and every caller would have to
 * write the same empty catch to stop it.
 *
 * `linkIssue` is the exception and rethrows: its failure is a question with a
 * dialog behind it, and the caller has to see it.
 */
async function reported<T>(run: () => Promise<T | null | undefined>): Promise<T | null> {
  try {
    return (await run()) ?? null;
  } catch {
    return null;
  }
}

export function useIssueMutations() {
  const commit = useCommitToast();
  const refreshListings = useListingRefresh();

  const open = useMutation(OPEN_ISSUE);
  const update = useMutation(UPDATE_ISSUE);
  const close = useMutation(CLOSE_ISSUE);
  const reopen = useMutation(REOPEN_ISSUE);
  const comment = useMutation(ADD_COMMENT);
  const link = useMutation(LINK_ISSUE, { context: ASKED });
  const unlink = useMutation(UNLINK_ISSUE);

  const busy = computed(
    () =>
      open.loading.value ||
      update.loading.value ||
      close.loading.value ||
      reopen.loading.value ||
      comment.loading.value ||
      link.loading.value ||
      unlink.loading.value,
  );

  return {
    busy,

    openIssue(input: {
      title: string;
      body: string;
      labels?: string[];
      assignees?: string[];
      milestone?: string | null;
      features?: string[];
      parent?: string | null;
    }) {
      return reported(async () => {
        const payload = (await open.mutate({ input }))?.data?.openIssue;
        if (payload) {
          commit.report(payload.commit, "Filed");
          refreshListings();
        }
        return payload;
      });
    },

    updateIssue(ref: string, patch: IssuePatch) {
      return reported(async () => {
        const payload = (await update.mutate({ input: { ref, ...patch } }))?.data?.updateIssue;
        if (payload) {
          commit.report(payload.commit, "Saved");
          // A label, an assignee or a milestone decides which listings hold it.
          refreshListings();
        }
        return payload;
      });
    },

    closeIssue(ref: string, resolution: string | null, duplicateOf: string | null) {
      return reported(async () => {
        const result = await close.mutate({
          input: {
            ref,
            ...(resolution === null ? {} : { resolution }),
            ...(duplicateOf === null ? {} : { duplicateOf }),
          },
        });
        const payload = result?.data?.closeIssue;
        if (payload) {
          commit.report(payload.commit, "Closed");
          refreshListings();
        }
        return payload;
      });
    },

    reopenIssue(ref: string) {
      return reported(async () => {
        const payload = (await reopen.mutate({ ref }))?.data?.reopenIssue;
        if (payload) {
          commit.report(payload.commit, "Reopened");
          refreshListings();
        }
        return payload;
      });
    },

    addComment(ref: string, body: string, replyTo: string | null) {
      return reported(async () => {
        const result = await comment.mutate({
          input: { kind: "ISSUE", ref, body, ...(replyTo === null ? {} : { replyTo }) },
        });
        const payload = result?.data?.addComment;
        if (payload) commit.report(payload.commit, "Commented");
        return payload;
      });
    },

    /**
     * File one issue under another.
     *
     * `allowReparent` is the consent the server asks for when the child
     * already has a parent: the first attempt is always made without it, so
     * that moving somebody else's subtask is never something this client does
     * on its own initiative.
     *
     * The only write here that lets its failure through, because that refusal
     * is the question the caller has a dialog for.
     */
    async linkIssue(child: string, parent: string, allowReparent = false) {
      const result = await link.mutate({ input: { child, parent, allowReparent } });
      const payload = result?.data?.linkIssue;
      if (payload) {
        commit.report(payload.commit, allowReparent ? "Moved" : "Linked");
        refreshListings();
      }
      return payload ?? null;
    },

    unlinkIssue(ref: string) {
      return reported(async () => {
        const payload = (await unlink.mutate({ ref }))?.data?.unlinkIssue;
        if (payload) commit.report(payload.commit, "Unlinked");
        return payload;
      });
    },
  };
}
