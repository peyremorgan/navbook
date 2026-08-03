/**
 * Timestamp helpers — spec 02 §2.4 (ISO 8601, UTC recommended).
 *
 * Frontmatter timestamps are display data; git history is authoritative
 * wherever ordering or authority matters.
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
