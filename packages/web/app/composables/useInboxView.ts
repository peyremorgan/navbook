/**
 * The inbox view that lives in the address bar.
 *
 * The listings' `useEntityFilter` with a different set of keys, and for the
 * same reasons: `router.replace` rather than `push`, because narrowing a view
 * is not a place in history to go back to; and parameters this page does not
 * own are kept, so nothing else in the URL is dropped by a click on the rail.
 */

import type { LocationQueryRaw } from "vue-router";
import type { RouteQuery } from "~/utils/filter-params";
import {
  INBOX_PARAM_KEYS,
  type InboxParams,
  inboxParamsToQuery,
  queryToInboxParams,
} from "~/utils/inbox-params";

export interface InboxViewHandle {
  /** The view the current URL means. */
  params: ComputedRef<InboxParams>;
  /** Replace the view, and the query string with it. */
  set(next: InboxParams): void;
  /** Change one field, leaving the rest alone. */
  patch(next: Partial<InboxParams>): void;
}

export function useInboxView(): InboxViewHandle {
  const route = useRoute();
  const router = useRouter();

  const params = computed(() => queryToInboxParams(route.query as RouteQuery));

  const set = (next: InboxParams): void => {
    const kept: LocationQueryRaw = { ...route.query };
    for (const key of INBOX_PARAM_KEYS) delete kept[key];
    void router.replace({ query: { ...kept, ...inboxParamsToQuery(next) } });
  };

  return {
    params,
    set,
    patch: (next) => set({ ...params.value, ...next }),
  };
}
