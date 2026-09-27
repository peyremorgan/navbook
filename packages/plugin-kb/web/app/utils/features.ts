/**
 * The features an entity asserts, read off `Entity.ext` (spec 06 §6.3).
 *
 * The host's own fragments select `ext` and nothing more specific, because a
 * fragment written in `@navbook/web` cannot name a field this plugin added. So
 * this is where a row badge, a panel or an inbox grouping reads them.
 *
 * The shape is checked rather than trusted. `ext` is a `JSON` scalar, so what
 * arrives is whatever the server put there and the schema promises nothing
 * about it: a client built with this layer against an API without the plugin
 * gets no key at all, and one against an older version could get something
 * else. Every one of those has to read as "no features" rather than as a page
 * that will not render — these chips are decoration on somebody else's row,
 * and a version mismatch must not be why the issue list is blank.
 *
 * A file of its own, apart from the composable that queries the registry, so
 * that it stays a pure function with no Vue and no Apollo behind it — which is
 * what lets `test/web.test.ts` run it under `node --test`.
 */

export function readKbFeatures(ext: Record<string, unknown> | null | undefined): string[] {
  const mine = ext?.kb;
  if (typeof mine !== "object" || mine === null) return [];
  const features = (mine as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features.filter((slug): slug is string => typeof slug === "string");
}
