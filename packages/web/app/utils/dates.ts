/**
 * A deadline is a day, not an instant — spec 02 §2.5.
 *
 * Which is why none of this goes through `parseTimestamp`: that reads an
 * instant, and rendering one would put a `deadline` into the reader's zone and
 * shift it by a day for half the world. A day is compared with a day, as text,
 * and the arithmetic is done at noon UTC so no daylight-saving hour can round
 * a difference the wrong way.
 *
 * The day a deadline is measured against is the *reader's*, because a badge
 * saying "2 days overdue" is about their calendar. The server judges its
 * `OVERDUE` filter against its own day (spec 06 §6.3), so for the few hours
 * the two do not line up a row can be listed as overdue and read as due today.
 * That is the honest answer in both places: neither is wrong about its own day.
 */

/** A calendar date as `deadline` spells it, and a day that exists. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today as the reader's own calendar has it, `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole days from `today` to `deadline`; negative when the day has passed.
 *
 * Both are read at noon UTC rather than midnight, so that even if a caller
 * hands in a value this module did not produce, the twenty-three and
 * twenty-five hour days of a daylight-saving change cannot push the division
 * over a boundary.
 */
export function daysUntil(deadline: string, today: string): number | null {
  if (!isCalendarDate(deadline) || !isCalendarDate(today)) return null;
  const noon = (day: string): number => new Date(`${day}T12:00:00Z`).getTime();
  return Math.round((noon(deadline) - noon(today)) / 86_400_000);
}

export interface DueReading {
  /** What the badge says. */
  text: string;
  /** Wanted on a day now past. Strict: work wanted today is not yet late. */
  overdue: boolean;
}

/**
 * A deadline in the words a row shows: "due in 3 days", "2 days overdue".
 *
 * Counted in days rather than handed to `Intl.RelativeTimeFormat`, which would
 * read a date as an instant and say "in 14 hours" for something wanted today.
 * Far enough out, the count stops being the useful thing and the date itself
 * is shown instead.
 */
export function dueLabel(deadline: string, today: string = localToday()): DueReading {
  const days = daysUntil(deadline, today);
  if (days === null) return { text: deadline, overdue: false };
  if (days === 0) return { text: "due today", overdue: false };
  if (days === 1) return { text: "due tomorrow", overdue: false };
  if (days === -1) return { text: "1 day overdue", overdue: true };
  if (days < 0) return { text: `${-days} days overdue`, overdue: true };
  if (days <= 30) return { text: `due in ${days} days`, overdue: false };
  return { text: `due ${absoluteDate(deadline)}`, overdue: false };
}

/**
 * The day spelled out, for the title behind a badge.
 *
 * Built from the parts rather than from a parsed instant, so a date near
 * either end of a day is never printed as the one before or after it.
 */
export function absoluteDate(deadline: string): string {
  if (!isCalendarDate(deadline)) return deadline;
  const [year, month, day] = deadline.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: "long" });
}
