/**
 * Where each listing was, so its tab can go back there.
 *
 * The filter is the address (`useEntityFilter`), which is what makes a
 * filtered view something to bookmark and send — and also why the navbar used
 * to lose it, since a tab linking to a bare `/issues` is asking for the
 * default listing and getting it. So the links carry a query instead: the one
 * their listing was last showing.
 *
 * Through the links and nowhere else. Nothing here redirects, because a bare
 * `/issues` typed, bookmarked or sent by somebody must keep meaning the
 * default listing rather than quietly becoming what this browser last looked
 * at.
 *
 * It lasts as long as the browser tab, in `sessionStorage`, for the reason the
 * token does (`app/plugins/02.auth.ts`): it is where you were rather than
 * something you chose, so it should survive a reload without following you
 * into next week. Nothing about it reaches the repository.
 */

import type { RouteLocationRaw } from "vue-router";
import { filterQuery, type RouteQuery } from "~/utils/filter-params";

/** Listing path to the filter parameters it was last showing. */
export type Remembered = Record<string, Record<string, string[]>>;

const STORAGE_KEY = "navbook:filter-memory";

export interface FilterMemory {
  /** Record what a listing is showing; an empty filter forgets it instead. */
  remember(path: string, query: RouteQuery): void;
  /**
   * Where a link to a listing should go: the listing as it was left.
   *
   * The target may carry a query of its own — `HOME` is `/issues?status=open`,
   * the listing the front page lands on. That query is the fallback rather
   * than an addition: it says what the listing means before this browser has
   * left it anywhere, and a remembered filter replaces it whole.
   */
  target(path: string): RouteLocationRaw;
}

/**
 * What was written down, with everything unrecognisable dropped.
 *
 * Storage is not a URL: what comes back was written by some version of this
 * client, or by hand, and it has to fail as nothing remembered rather than as
 * a link that cannot be navigated to. So every entry goes back through
 * `filterQuery`, and only keys that could be a route path are kept — which
 * also keeps `__proto__`, which `JSON.parse` will happily hand over as an own
 * property, from being assigned as one.
 */
export function readMemory(stored: string | null): Remembered {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored ?? "");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const remembered: Remembered = {};
  for (const [path, entry] of Object.entries(parsed)) {
    if (!path.startsWith("/")) continue;
    if (typeof entry !== "object" || entry === null) continue;
    const query = filterQuery(entry as RouteQuery);
    // An entry with nothing left in it is a listing at its default, which is
    // what having no entry already means.
    if (Object.keys(query).length > 0) remembered[path] = query;
  }
  return remembered;
}

/** A link target as its path and the query it carries, which may be empty. */
function splitTarget(target: string): [string, Record<string, string[]>] {
  const mark = target.indexOf("?");
  if (mark === -1) return [target, {}];
  const params = new URLSearchParams(target.slice(mark + 1));
  const query: Record<string, string[]> = {};
  for (const key of params.keys()) query[key] = params.getAll(key);
  return [target.slice(0, mark), query];
}

function load(): Remembered {
  try {
    return readMemory(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    // No storage to read — a browser refusing it, or nothing at all.
    return {};
  }
}

function save(remembered: Remembered): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    // A browser that will not store this is one that forgets on the next page,
    // which is the behaviour without any of this. There is nothing to report.
  }
}

export function useFilterMemory(): FilterMemory {
  const remembered = useState<Remembered>("filter-memory", load);

  return {
    remember(path, query) {
      const filter = filterQuery(query);
      // Replaced rather than mutated: the links render from this, and a new
      // object is a change every one of them can see.
      const next: Remembered = { ...remembered.value };
      // An empty filter is forgotten rather than stored empty, so a listing
      // left at its default gives its tab a bare link again.
      if (Object.keys(filter).length > 0) next[path] = filter;
      else delete next[path];
      remembered.value = next;
      save(next);
    },

    target(path) {
      const [bare, search] = splitTarget(path);
      return { path: bare, query: remembered.value[bare] ?? search };
    },
  };
}
