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
import {
  type ApiFailure,
  describeApiError,
  isForbidden,
  isUnauthenticated,
  sayFailure,
} from "~/utils/errors";

/**
 * Failures a caller has said it will report itself.
 *
 * Set in an operation's context. `handledCodes` names some — `context:
 * { handledCodes: [...] }` — and the shared error toast stays quiet about
 * those, leaving them to whatever raised the operation: `REPARENT_REQUIRED`
 * and the pull request `PRECONDITION` are not really errors so much as
 * questions, and each has a place in the page that answers it better than a
 * toast could. `handled` names all of them, for a write whose every refusal is
 * kept beside the field it was about, with the server's words and a Retry
 * (`usePendingEdits`); a toast on top would be the same sentence said twice.
 * Except one: a refusal by the repository's policy sends the person to the
 * page that explains it, and the field the refusal would have been kept
 * beside leaves with the page they were on, so that one is still announced.
 */
export interface HandledContext {
  handledCodes?: readonly string[];
  handled?: boolean;
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
  //
  // It stays set when the person chose to stay with unsaved work instead
  // (`middleware/00.unsaved.global.ts`), and is lowered only by a navigation
  // that lands: until they move, every further refusal would ask again.
  let sendingAway = false;
  // The same for a refused token: asked once, and not again until they move.
  let signingIn = false;
  nuxtApp.$router.afterEach((_to, _from, failure) => {
    if (failure) return;
    sendingAway = false;
    signingIn = false;
  });

  /**
   * Sign in again, once the person has agreed to leave whatever they typed.
   *
   * Asked in the app before anything is dropped, as signing out does
   * (`useAuth().logout`): staying keeps the page, the draft and the token, so
   * the draft can be copied out before going. Declining says why nothing
   * was saved, since the refused operation is otherwise never mentioned.
   */
  async function signInAgain(failure: ApiFailure): Promise<void> {
    // Mid sign-out the token was dropped on purpose, and whatever was typed
    // has already been asked about; `login` would decline to go anyway.
    if (auth.signingOut()) return;
    const unsaved = nuxtApp.$unsaved;
    if (unsaved.dirty()) {
      if (!(await unsaved.confirmLeave())) {
        const said = sayFailure(failure);
        useToast().add({
          title: said.heading,
          description: `${said.message} — copy what you wrote, then sign in again.`,
          color: "error",
          icon: "i-lucide-triangle-alert",
          duration: 8000,
        });
        return;
      }
      unsaved.agree();
    }
    // The token was refused rather than merely missing, so the stored one is
    // no use to anybody. Dropping it means the next attempt signs in again
    // instead of retrying with the same rejected credential.
    await auth.forget();
    await auth.login();
  }

  const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
    const failure = describeApiError({ graphQLErrors, networkError });

    if (isUnauthenticated(failure) && !signingIn) {
      signingIn = true;
      void signInAgain(failure);
      return;
    }

    if (isForbidden(failure)) {
      // Signed in, and refused by the repository's policy: the page says so
      // and offers to sign out. The token itself is kept — see `refused`.
      // No return: a refused *write* is still announced below, since the
      // person who was admitted a moment ago has just lost what they typed.
      if (!sendingAway) {
        sendingAway = true;
        void auth.refused();
      }
    }

    const context = operation.getContext() as HandledContext;
    if (context.handled === true && !isForbidden(failure)) return;
    if (context.handledCodes?.includes(failure.code ?? "")) return;
    if (!isMutation(operation.query)) return;

    const said = sayFailure(failure);
    const toast = useToast();
    toast.add({
      title: said.heading,
      description: said.message,
      color: "error",
      icon: "i-lucide-triangle-alert",
      duration: 8000,
    });
  });

  // How the loaded plugin layers want their own types and root fields cached.
  // Read before the cache is built rather than merged into it afterwards:
  // Apollo reads its configuration once, and a policy added later would apply
  // only to what had not been read yet.
  const slots = useNavbookSlots();

  const cache = new InMemoryCache({
    possibleTypes: { Entity: ["Issue", "Pr"] },
    typePolicies: {
      // A layer's policies first, so one naming a type this client already
      // knows about cannot quietly change how it is keyed.
      ...slots.typePolicies(),
      Issue: { keyFields: ["id"] },
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
          ...slots.queryFields(),
          // A listing is the whole matching set for one filter, and two
          // filters are two different sets: without this, Apollo would hand
          // the label-filtered listing back for the unfiltered one.
          issues: { keyArgs: ["filter"] },
          prs: { keyArgs: ["filter", "allRefs"] },
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
