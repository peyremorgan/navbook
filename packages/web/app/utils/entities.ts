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

/**
 * A comment's timestamp is colon-free.
 *
 * Its filename is the timestamp — that is what makes two people commenting at
 * once impossible to collide (spec 02 §2.6) — and a filename cannot hold
 * colons, so the API reports it exactly as it stands on disk:
 * `2026-08-04T110000Z`, which `Date` will not parse. An entity's `created`
 * carries the ordinary spelling. Both arrive here, so both are read.
 */
const COMPACT_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** Parse either spelling; null when it is neither. */
export function parseTimestamp(value: string): Date | null {
  const compact = COMPACT_STAMP.exec(value.trim());
  const text = compact ? `${compact[1]}T${compact[2]}:${compact[3]}:${compact[4]}Z` : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
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
  const then = parseTimestamp(iso);
  if (then === null) return iso;
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
  return parseTimestamp(iso)?.toLocaleString() ?? iso;
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
