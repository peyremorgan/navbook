/**
 * Timestamp helpers — spec 02 §2.4 (ISO 8601, UTC recommended).
 *
 * Frontmatter timestamps are display data; git history is authoritative
 * wherever ordering or authority matters.
 *
 * A `deadline` (§2.5) is the one temporal value here that is not an instant:
 * it is a day, and the helpers for it are kept apart from the ones above
 * because the difference is the whole point of the key.
 */

/** Normalize an instant to `YYYY-MM-DDTHH:MM:SSZ` (no sub-second precision). */
export function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** Compact UTC stamp used in comment filenames: `YYYY-MM-DDTHHMMSSZ` (§2.6). */
export function toCompactStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** Parse an ISO 8601 timestamp, returning null when it is not a valid instant. */
export function parseIso(value: string): Date | null {
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)
  ) {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Expand a compact comment-filename stamp into an ISO 8601 timestamp. */
export function fromCompactStamp(stamp: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Reject values that rolled over (e.g. month 13, day 32, hour 25).
  return toCompactStamp(date) === stamp ? date : null;
}

/**
 * A calendar date as `deadline` spells it (§2.5): `YYYY-MM-DD`, and a day that
 * exists.
 *
 * The shape and the day are two separate questions and both are asked here.
 * `2026-13-01` and `2026-02-30` pass a regular expression and roll over into
 * some other day when parsed, so the parse is asked to hand the same text back;
 * `2024-02-29` survives that and `2023-02-29` does not, which is the behaviour
 * a leap year needs.
 *
 * Nothing is trimmed, unlike {@link parseIso}. A timestamp arrives from a
 * clock and may be spelled loosely; a deadline is typed by a person into one
 * field, and " 2026-10-01" in a file is a thing worth being told about.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && calendarDateOf(date) === value;
}

/**
 * The UTC day an instant falls on, `YYYY-MM-DD`.
 *
 * UTC rather than a local reading, because this is what a `deadline` is
 * compared against and a comparison that moved with the reader's zone would
 * make `overdue` mean something different in two places at once.
 */
export function calendarDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
