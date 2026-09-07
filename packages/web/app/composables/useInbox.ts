/**
 * Everything that concerns the signed-in person, as one list.
 *
 * The address asked about is the server's own reading of the token — the
 * `email` claim it takes `author:` from — rather than the claim this client
 * parsed out of its copy. They agree, but only one of them has been checked
 * against the server that will do the matching, and matching is a format
 * question the client does not answer for itself (spec 06 §6.3).
 *
 * Nothing is asked until that address is known, and the page shows its skeleton
 * meanwhile: an inbox drawn for nobody would be an empty one, which reads as an
 * answer rather than as a question still in flight.
 */

import { useQuery } from "@vue/apollo-composable";
import { INBOX_QUERY, VIEWER_QUERY } from "~/graphql/queries";
import { type InboxItem, inboxVariables, mergeInbox } from "~/utils/inbox";
import type { InboxParams } from "~/utils/inbox-params";

export interface InboxHandle {
  /** The address the inbox is about; null until the server has said. */
  email: ComputedRef<string | null>;
  /** Every answer merged, newest first. Empty until there is one. */
  items: ComputedRef<InboxItem[]>;
  loading: ComputedRef<boolean>;
  error: ComputedRef<unknown>;
  refetch(): void;
}

export function useInbox(scope: ComputedRef<Pick<InboxParams, "finished" | "text">>): InboxHandle {
  // The layout asks this too, and the cache is normalised, so this costs a
  // cache read rather than a request.
  const { result: viewerResult, error: viewerError } = useQuery(VIEWER_QUERY, null, {
    fetchPolicy: "cache-first",
  });
  const email = computed(() => viewerResult.value?.viewer.email ?? null);

  const { result, loading, error, refetch } = useQuery(
    INBOX_QUERY,
    () => inboxVariables(email.value ?? "", scope.value),
    () => ({ fetchPolicy: "cache-and-network" as const, enabled: email.value !== null }),
  );

  const items = computed(() => {
    const answers = result.value;
    if (answers === undefined) return [];
    return mergeInbox({
      issues: [
        { reason: "assigned", entities: answers.assignedIssues },
        { reason: "assigned", entities: answers.finishedAssignedIssues ?? [] },
      ],
      prs: [
        { reason: "assigned", entities: answers.assignedPrs },
        { reason: "author", entities: answers.authoredPrs },
        { reason: "awaiting", entities: answers.awaitingPrs },
        { reason: "assigned", entities: answers.finishedAssignedPrs ?? [] },
        { reason: "author", entities: answers.finishedAuthoredPrs ?? [] },
      ],
    });
  });

  return {
    email,
    items,
    // Waiting for the address is waiting: the query has not been asked yet, so
    // Apollo reports nothing in flight and only this knows better.
    loading: computed(() => (email.value === null && viewerError.value === null) || loading.value),
    error: computed(() => viewerError.value ?? error.value),
    refetch: () => {
      void refetch();
    },
  };
}
