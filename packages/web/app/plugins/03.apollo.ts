/**
 * The GraphQL client.
 *
 * Three links, in the order a request passes them: errors on the way back in,
 * the bearer token on the way out, and HTTP. The token is attached here rather
 * than in a wrapper around every operation, because every operation needs it —
 * the API answers nothing without one, introspection included.
 *
 * Two things about the cache are worth knowing. `possibleTypes` is required
 * because `Entity` is an interface and `addComment` returns one: without it
 * the cache cannot tell which fragment applies to what came back. And
 * `LinkNode` is deliberately *not* normalised — its ids repeat within a single
 * response, once per position the issue occupies in the tree, so keying by id
 * would merge a node marked `repeated` into the one it points at and lose the
 * distinction the schema went to the trouble of making.
 */

import { ApolloClient, from, HttpLink, InMemoryCache } from "@apollo/client/core";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { DefaultApolloClient } from "@vue/apollo-composable";
import type { DocumentNode } from "graphql";
import { describeApiError, errorHeading, isForbidden, isUnauthenticated } from "~/utils/errors";

/**
 * Codes a caller has said it will handle itself.
 *
 * Set it in an operation's context — `context: { handledCodes: [...] }` — and
 * the shared error toast stays quiet, leaving the failure to whatever raised
 * the operation. `REPARENT_REQUIRED` and the pull request `PRECONDITION` are
 * not really errors so much as questions, and each has a place in the page
 * that answers it better than a toast could.
 */
export interface HandledContext {
  handledCodes?: readonly string[];
}

/**
 * Whether an operation is a write.
 *
 * Only writes are announced. A read that fails has a natural place to say so —
 * the space its data would have filled, which `QueryState` renders — and
 * saying it twice is worse than saying it once: two copies of the same
 * sentence read as two separate faults.
 */
function isMutation(document: DocumentNode): boolean {
  return document.definitions.some(
    (definition) =>
      definition.kind === "OperationDefinition" && definition.operation === "mutation",
  );
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = nuxtApp.$navConfig;
  const auth = useAuth();

  const authLink = setContext(async (_operation, previous) => {
    const token = await auth.getAccessToken();
    const headers = { ...(previous.headers as Record<string, string> | undefined) };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return { headers };
  });

  // Whether a refused visit is already on its way to the page that explains
  // it. Every operation a page issues fails the same way at once, and each
  // would otherwise start a navigation that cancels the one before it.
  let sendingAway = false;

  const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
    const failure = describeApiError({ graphQLErrors, networkError });

    if (isUnauthenticated(failure)) {
      // The token was refused rather than merely missing, so the stored one is
      // no use to anybody. Dropping it means the next attempt signs in again
      // instead of retrying with the same rejected credential.
      void auth.forget().then(() => auth.login());
      return;
    }

    if (isForbidden(failure)) {
      // Signed in, and refused by the repository's policy: the page says so
      // and offers to sign out. The token itself is kept — see `refused`.
      // No return: a refused *write* is still announced below, since the
      // person who was admitted a moment ago has just lost what they typed.
      if (!sendingAway) {
        sendingAway = true;
        void auth.refused().finally(() => {
          sendingAway = false;
        });
      }
    }

    const context = operation.getContext() as HandledContext;
    if (context.handledCodes?.includes(failure.code ?? "")) return;
    if (!isMutation(operation.query)) return;

    const toast = useToast();
    toast.add({
      title: errorHeading(failure.code),
      description: [failure.message, ...failure.details].join(" — "),
      color: "error",
      icon: "i-lucide-triangle-alert",
      duration: 8000,
    });
  });

  const cache = new InMemoryCache({
    possibleTypes: { Entity: ["Issue", "Pr"] },
    typePolicies: {
      Issue: { keyFields: ["id"] },
      // A feature is named by its slug, a document by its path within one.
      Feature: { keyFields: ["slug"] },
      Spec: { keyFields: ["path"] },
      Commit: { keyFields: ["sha"] },
      Pr: { keyFields: ["id"] },
      Comment: { keyFields: ["id"] },
      LinkNode: { keyFields: false },
      Revision: { keyFields: false },
      MergedInfo: { keyFields: false },
      CommitInfo: { keyFields: false },
      Viewer: { keyFields: ["email"] },
      Query: {
        fields: {
          // A listing is the whole matching set for one filter, and two
          // filters are two different sets: without this, Apollo would hand
          // the label-filtered listing back for the unfiltered one.
          issues: { keyArgs: ["filter"] },
          prs: { keyArgs: ["filter", "allRefs"] },
          features: { keyArgs: [] },
          feature: { keyArgs: ["slug"] },
        },
      },
    },
  });

  const client = new ApolloClient({
    link: from([errorLink, authLink, new HttpLink({ uri: config.graphqlUrl })]),
    cache,
    defaultOptions: {
      // Reads are cheap on the server and the tree behind them changes without
      // this client's knowledge — somebody pushes from a terminal — so a view
      // shows what is cached at once and then corrects itself.
      watchQuery: { fetchPolicy: "cache-and-network", nextFetchPolicy: "cache-first" },
    },
  });

  nuxtApp.vueApp.provide(DefaultApolloClient, client);
  nuxtApp.provide("apollo", client);
});
