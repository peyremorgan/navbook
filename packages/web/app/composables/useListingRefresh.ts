/**
 * Forgetting the listings after a write.
 *
 * A mutation returns the entity it changed, and Apollo's cache is normalised,
 * so every detail view of that entity corrects itself for free. What it cannot
 * know is whether the entity still belongs in the listings that hold it: an
 * issue that was just closed drops out of a listing filtered to open ones, a
 * new label puts it into a filtered one, a new issue belongs at the top of
 * several.
 *
 * Working that out on the client would mean reimplementing `matchesQuery` in
 * the browser, which is exactly the thing this client does not do. Evicting the
 * listings and letting the server answer again is both correct and cheap: the
 * API has no pagination, so a listing is one request.
 *
 * `people` is forgotten for the same reason rather than a different one: a
 * write is how somebody first gets assigned or asked to review, and the answer
 * that already named everybody cannot know it now names one more.
 */

import type { ApolloClient, NormalizedCacheObject } from "@apollo/client/core";

/** Root fields whose cached answers a write can invalidate. */
const LISTINGS = ["issues", "prs", "people"] as const;

export function evictListings(client: ApolloClient<NormalizedCacheObject>): void {
  // A plugin's listing is evicted with the built-in ones: its data changed when
  // the entity did, and one that went stale until a reload would be a plugin
  // behaving worse than the thing it sits beside.
  for (const fieldName of [...LISTINGS, ...useNavbookSlots().listings()]) {
    client.cache.evict({ id: "ROOT_QUERY", fieldName });
  }
  client.cache.gc();
}

export function useListingRefresh(): () => void {
  const { $apollo } = useNuxtApp();
  return () => evictListings($apollo);
}
