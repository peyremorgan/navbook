/**
 * The feature registry, for a component that offers one.
 *
 * A thin reactive view over `utils/feature-registry.ts`, which holds the one
 * subscription and explains why there is only one. Nothing here starts a query
 * of its own: the panel, the new-issue field and the filter bar's menu all
 * read the same answer, and a query apiece would be three requests for it.
 */

import { featureSlugs } from "../utils/feature-registry";

export function useKbFeatures() {
  /** Every feature slug in the tree, in the order the API returned them. */
  const slugs = computed(() => featureSlugs());
  return { slugs };
}
