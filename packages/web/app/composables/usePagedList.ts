/**
 * Showing a long listing a screenful at a time.
 *
 * The API returns every matching entity, newest first, with no `first`/`after`
 * and no sort argument. That is deliberate on the server's part — a cursor
 * would need an index, and an index is the thing the format refuses to grow
 * (spec 06 §6.6) — so paging is the client's problem, and it is a small one:
 * the whole answer is already here, this only decides how much of it to draw.
 */

const PAGE = 50;

export interface PagedList<T> {
  /** The slice to render. */
  shown: ComputedRef<T[]>;
  total: ComputedRef<number>;
  hasMore: ComputedRef<boolean>;
  more(): void;
}

export function usePagedList<T>(
  items: Ref<readonly T[]> | ComputedRef<readonly T[]>,
): PagedList<T> {
  const limit = ref(PAGE);
  // Reset on the filter, not on the data. A listing is refetched whenever the
  // page is revisited — `cache-and-network` — and the array that comes back is
  // a new one every time; resetting on that would undo "show more" behind the
  // reader's back. The filter lives in the query string, so that is the thing
  // that means "a different listing".
  const route = useRoute();
  watch(
    () => route.fullPath,
    () => {
      limit.value = PAGE;
    },
  );

  return {
    shown: computed(() => items.value.slice(0, limit.value) as T[]),
    total: computed(() => items.value.length),
    hasMore: computed(() => items.value.length > limit.value),
    more: () => {
      limit.value += PAGE;
    },
  };
}
