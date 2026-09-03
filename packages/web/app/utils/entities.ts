/**
 * Small presentational facts about issues and pull requests.
 *
 * Nothing here interprets the format: a status is turned into a colour, a
 * timestamp into "3 days ago", an id into the prefix people actually type. The
 * server decides what an entity *is*; this decides what it looks like.
 */

import type { Status } from "~~/src/generated/gql/graphql";

/** The colour each status wears, everywhere it appears. */
export function statusColor(status: Status): "success" | "neutral" | "primary" {
  switch (status) {
    case "OPEN":
      return "success";
    case "MERGED":
      return "primary";
    default:
      return "neutral";
  }
}

export function statusLabel(status: Status): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/**
 * The shortest prefix worth showing.
 *
 * Ids are eight random characters and references accept any unambiguous prefix
 * of four or more, so people speak in prefixes. Showing the whole id in a table
 * costs a column for no gain; links always carry the full one.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** A 40-hex SHA as it is spoken. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const UNITS: [limitSeconds: number, seconds: number, name: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86400, 3600, "hour"],
  [2592000, 86400, "day"],
  [31536000, 2592000, "month"],
  [Number.POSITIVE_INFINITY, 31536000, "year"],
];

/**
 * "3 days ago", from an ISO 8601 timestamp.
 *
 * `now` is a parameter so the result is a function of its inputs and a test can
 * pin it; callers pass nothing.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const elapsed = (now.getTime() - then.getTime()) / 1000;
  const magnitude = Math.abs(elapsed);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [limit, seconds, unit] of UNITS) {
    if (magnitude < limit) return format.format(-Math.round(elapsed / seconds), unit);
  }
  return iso;
}

/** The full timestamp, for the tooltip behind the relative one. */
export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Every distinct value of one repeated field across a listing, sorted.
 *
 * There is no query that enumerates labels, assignees or milestones — the
 * format has no registry of them and the server introduces none (spec 06
 * §6.6). What is in play is therefore whatever the current listing shows, and
 * that is what the filter bar offers as suggestions.
 */
export function distinctValues<T>(
  items: readonly T[],
  pick: (item: T) => readonly string[],
): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    for (const value of pick(item)) {
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
