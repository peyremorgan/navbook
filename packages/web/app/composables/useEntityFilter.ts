/**
 * The filter that lives in the address bar.
 *
 * A filtered listing has to be a thing you can bookmark, reload and send to
 * somebody, so the query string is the state rather than a copy of it. The
 * only translation is `app/utils/filter-params.ts`, and the components below
 * read and write the object it produces.
 *
 * Writes go through `router.replace`, not `push`: adjusting a filter is not a
 * place in history to go back to, and pushing would make the back button walk
 * every keystroke of the search box.
 *
 * Nothing here remembers anything. The navbar keeps a bookmark of the address
 * each listing was last at, so switching tabs comes back to it
 * (`useFilterMemory`), but the URL is still the only state there is.
 */

import {
  emptyFilter,
  type FilterKeys,
  type FilterState,
  filterToQuery,
  isEmptyFilter,
  queryToFilter,
  type RouteQuery,
  toEntityFilter,
  withoutFilter,
} from "~/utils/filter-params";
import type { EntityFilter } from "~~/src/generated/gql/graphql";

export interface EntityFilterHandle {
  /** The filter the current URL means. */
  filter: ComputedRef<FilterState>;
  /** The same thing as the API takes it. */
  variables: ComputedRef<EntityFilter>;
  empty: ComputedRef<boolean>;
  /** Replace the filter, and the query string with it. */
  set(next: FilterState): void;
  /** Change one field, leaving the rest alone. */
  patch(next: Partial<FilterState>): void;
  clear(): void;
}

export function useEntityFilter(keys: FilterKeys): EntityFilterHandle {
  const route = useRoute();
  const router = useRouter();

  const filter = computed(() => queryToFilter(route.query as RouteQuery, keys));

  const set = (next: FilterState): void => {
    // Parameters this filter does not own are kept, so a listing can carry
    // something else in its URL — `allRefs` on the pull request list, `sort` on
    // both — without every filter change dropping it. `sort` is deliberately
    // not among `FILTER_KEYS`: an order somebody chose survives Clear, because
    // clearing a filter is about which rows are listed and not about the order
    // they are read in.
    const kept = withoutFilter(route.query as RouteQuery);
    void router.replace({ query: { ...kept, ...filterToQuery(next) } });
  };

  return {
    filter,
    variables: computed(() => toEntityFilter(filter.value)),
    empty: computed(() => isEmptyFilter(filter.value)),
    set,
    patch: (next) => set({ ...filter.value, ...next }),
    clear: () => set(emptyFilter()),
  };
}
