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
 */

import type { LocationQueryRaw } from "vue-router";
import {
  emptyFilter,
  type FilterState,
  filterToQuery,
  isEmptyFilter,
  queryToFilter,
  type RouteQuery,
  toEntityFilter,
} from "~/utils/filter-params";
import type { EntityFilter, Status } from "~~/src/generated/gql/graphql";

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

export function useEntityFilter(allowed: readonly Status[]): EntityFilterHandle {
  const route = useRoute();
  const router = useRouter();

  const filter = computed(() => queryToFilter(route.query as RouteQuery, allowed));

  const set = (next: FilterState): void => {
    // Parameters this filter does not own are kept, so a listing can carry
    // something else in its URL — `allRefs` on the pull request list — without
    // every filter change dropping it.
    const kept: LocationQueryRaw = { ...route.query };
    for (const key of ["status", "label", "assignee", "author", "milestone", "q"]) {
      delete kept[key];
    }
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
