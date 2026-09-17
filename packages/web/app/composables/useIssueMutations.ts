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
import type { EntityPatch } from "~/utils/patch";

/**
 * Failures the caller answers itself, so the shared toast stays quiet.
 *
 * None of these is really an error. `REPARENT_REQUIRED` is the server asking
 * whether you meant to move a subtask out from under the issue that holds it —
 * a question with a dialog behind it. `PRECONDITION` on a comment names the
 * branch to serve, which belongs beside the form, not in a toast that
 * disappears.
 *
 * An edit is different: every refusal of one is kept beside the field it was
 * about, with the server's words and a Retry (`usePendingEdits`), and a
 * `STALE_CONTENT` refusal is shown against what the file says now
 * (`useStaleEdit`). So `updateIssue` reports nothing here and rethrows
 * everything.
 */
const ASKED = { handledCodes: ["REPARENT_REQUIRED", "PRECONDITION"] };
const EDITED = { handled: true };

/**
 * Run a write, and return null rather than throwing when it fails.
 *
 * The error link has already said what went wrong, in the one place a write's
 * failure can be said. Letting the rejection continue past that would only put
 * an unhandled promise into an event handler, and every caller would have to
 * write the same empty catch to stop it.
 *
 * `linkIssue` and `updateIssue` are the exceptions and rethrow: the first
 * because its failure is a question with a dialog behind it, the second
 * because its failure is kept beside the field that was edited, and the
 * caller has to see both.
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
  const update = useMutation(UPDATE_ISSUE, { context: EDITED });
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
    /** Any write at all in flight, for a page with one button that writes. */
    busy,
    /**
     * Each write on its own, for a page with several. A spinner on the comment
     * button while an assignee is being saved is a spinner on the wrong thing.
     */
    loading: {
      open: open.loading,
      update: update.loading,
      close: close.loading,
      reopen: reopen.loading,
      comment: comment.loading,
      link: link.loading,
      unlink: unlink.loading,
    },

    openIssue(input: {
      title: string;
      body: string;
      labels?: string[];
      assignees?: string[];
      milestone?: string | null;
      features?: string[];
      rank?: number | null;
      deadline?: string | null;
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

    /**
     * Patch some fields, saying which version of the file they were read from.
     *
     * `baseSha` is what lets the server refuse a field somebody else changed
     * after the page was rendered: a question — theirs or yours? — that only
     * the page can put, beside what the file says now. A caller that edits
     * from no rendered value, the inbox placing a row it dragged, sends no
     * hash and is never asked.
     *
     * Every failure is thrown, and none is toasted: the caller keeps the edit
     * it was about to lose and says what happened beside it.
     */
    async updateIssue(ref: string, patch: EntityPatch, baseSha?: string) {
      const input = { ref, ...patch, ...(baseSha === undefined ? {} : { baseSha }) };
      const payload = (await update.mutate({ input }))?.data?.updateIssue;
      if (payload) {
        commit.report(payload.commit, "Saved");
        // A label, an assignee or a milestone decides which listings hold it,
        // and a rank or a deadline decides where in one it sits.
        refreshListings();
      }
      return payload ?? null;
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
