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
import { INBOX_QUERY, INBOX_SOURCE_QUERY, VIEWER_QUERY } from "~/graphql/queries";
import { type InboxItem, inboxSourceFilter, inboxVariables, mergeInbox } from "~/utils/inbox";
import type { InboxParams } from "~/utils/inbox-params";
import type { IssueFilter } from "~~/src/generated/gql/graphql";

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
  const {
    result: viewerResult,
    error: viewerError,
    refetch: refetchViewer,
  } = useQuery(VIEWER_QUERY, null, { fetchPolicy: "cache-first" });
  const email = computed(() => viewerResult.value?.viewer.email ?? null);

  const { result, loading, error, refetch } = useQuery(
    INBOX_QUERY,
    () => inboxVariables(email.value ?? "", scope.value),
    () => ({ fetchPolicy: "cache-and-network" as const, enabled: email.value !== null }),
  );

  // One question per reason a plugin layer added. The slots are filled before
  // the first render and never change, so this is a fixed number of queries.
  const sources = useNavbookSlots()
    .inboxSources()
    .map((source) => {
      const asked = useQuery(
        INBOX_SOURCE_QUERY,
        () => ({
          // The plugin's fields are the server's `IssueFilter`, not this
          // client's copy of it; see INBOX_SOURCE_QUERY.
          filter: inboxSourceFilter(source.filter(email.value ?? ""), scope.value) as IssueFilter,
        }),
        () => ({ fetchPolicy: "cache-and-network" as const, enabled: email.value !== null }),
      );
      return { reason: source.reason, ...asked };
    });

  const items = computed(() => {
    const answers = result.value;
    if (answers === undefined) return [];
    return mergeInbox({
      issues: [
        { reason: "assigned", entities: answers.assignedIssues },
        { reason: "assigned", entities: answers.finishedAssignedIssues ?? [] },
        ...sources.map((source) => ({
          reason: source.reason,
          entities: source.result.value?.issues ?? [],
        })),
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
    loading: computed(
      () =>
        (email.value === null && viewerError.value === null) ||
        loading.value ||
        sources.some((source) => source.loading.value),
    ),
    // A plugin's source failing takes its own rows out, and nothing else: the
    // inbox a person relies on must not go blank because a layer's API half
    // is missing or broken — a client built with a layer can meet a server
    // without its plugin.
    error: computed(() => viewerError.value ?? error.value),
    refetch: () => {
      // The address first. When it is what failed, the inbox query was never
      // asked at all, and asking a disabled query again would do nothing.
      void refetchViewer();
      void refetch();
      for (const source of sources) void source.refetch();
    },
  };
}
