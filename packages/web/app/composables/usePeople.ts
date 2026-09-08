/**
 * Everyone the repository knows of, for a menu that names a person.
 *
 * The one list-like thing this client does not have to guess. Labels and
 * milestones still come from whatever the listing on screen holds, because the
 * format keeps no registry of them and the server introduces none; people it
 * can answer, from its own history and tree (spec 06 §6.3).
 *
 * Cached, and shared through the normalised cache by every page that asks: the
 * answer changes when somebody commits or is written down, and a write that
 * might have done either forgets it (`useListingRefresh`).
 */

import { useQuery } from "@vue/apollo-composable";
import { PEOPLE_QUERY } from "~/graphql/queries";

export function usePeople(): ComputedRef<string[]> {
  const { result } = useQuery(PEOPLE_QUERY, null, { fetchPolicy: "cache-first" });
  return computed(() => result.value?.people ?? []);
}
