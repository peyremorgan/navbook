/**
 * The feature registry, read once and shared.
 *
 * Unlike labels and milestones — which have no registry, so the host guesses
 * them from whatever listing is on screen — a feature is a real directory and
 * exists whether or not any issue names it yet (spec 02 §2.11). So every menu
 * that offers one is offered the actual list.
 *
 * `cache-first` because it changes far less often than a listing does, and
 * every place that shows it wants the same answer: the filter bar's menu, an
 * entity's feature editor and the new-issue form each ask, and Apollo answers
 * all but the first from the cache.
 *
 * Reading an entity's own features is `readKbFeatures` in `utils/features.ts`,
 * which is a pure function and deliberately not in here.
 */

import { useQuery } from "@vue/apollo-composable";
import { FEATURES_QUERY } from "../graphql/queries";

export function useKbFeatures() {
  const { result } = useQuery(FEATURES_QUERY, undefined, { fetchPolicy: "cache-first" });
  /** Every feature slug in the tree, in the order the API returned them. */
  const slugs = computed(() => (result.value?.features ?? []).map((feature) => feature.slug));
  return { slugs };
}
