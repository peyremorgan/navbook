/**
 * Every feature slug in the tree, read once and shared by everything that
 * offers one.
 *
 * Unlike labels and milestones — which have no registry, so the host guesses
 * them from whatever listing is on screen — a feature is a real directory and
 * exists whether or not any issue names it yet (spec 02 §2.11). Four places
 * want the list: the filter bar's menu on both listings, the editor on an
 * entity, and the new-issue form.
 *
 * Module state with one subscription rather than `useQuery` in each of them,
 * and the reason is the filter bar. Its menus are described by a computed, and
 * a slot's `options()` is therefore called during render and outside any
 * component's setup — where `useQuery` may not be called at all, and where
 * starting a query per evaluation would feed its own result back into the
 * computed that started it. One `watchQuery`, started on the first ask, is
 * both correct there and cheaper everywhere else.
 *
 * `cache-first`: it changes far less often than a listing does, and the
 * `listings` slot evicts it when an entity is written.
 */

import type { ApolloClient, NormalizedCacheObject } from "@apollo/client/core";
import { FEATURES_QUERY } from "../graphql/queries";

const slugs = shallowRef<string[]>([]);
let watching: ApolloClient<NormalizedCacheObject> | null = null;

/**
 * The slugs, starting the subscription the first time anything asks.
 *
 * Empty until the answer arrives, which is what every menu here shows anyway
 * while it loads — and empty for good if there is no Apollo client yet, since
 * this may be read before the host's own plugins have run.
 */
export function featureSlugs(): string[] {
  if (watching === null) {
    const client = clientOrNull();
    if (client !== null) {
      watching = client;
      client.watchQuery({ query: FEATURES_QUERY, fetchPolicy: "cache-first" }).subscribe({
        next: (result) => {
          slugs.value = (result.data?.features ?? []).map((feature) => feature.slug);
        },
        // A registry that could not be read is a menu with no suggestions in
        // it, not a page that fails: every one of them takes a value that is
        // not on the list.
        error: () => {
          slugs.value = [];
        },
      });
    }
  }
  return slugs.value;
}

function clientOrNull(): ApolloClient<NormalizedCacheObject> | null {
  try {
    return (useNuxtApp() as { $apollo?: ApolloClient<NormalizedCacheObject> }).$apollo ?? null;
  } catch {
    return null;
  }
}
