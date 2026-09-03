/**
 * Showing who someone is, for the length of one line.
 *
 * `author:` is an RFC 5322 address on disk — `Alice <alice@example.com>` or a
 * bare address (spec 02 §2.4) — and a list row wants the short half of that.
 * This splits it for display and nothing else: it does not validate an address,
 * decide whether two of them are the same person, or match one against a
 * filter. Those are format questions, and format questions are the server's
 * (spec 06 §6.3); the filter sends the string the person typed and lets the
 * server answer.
 */

export interface DisplayPerson {
  /** What to show: the display name when there is one, else the address. */
  label: string;
  /** The address, when the field looks like it has one. */
  email: string | null;
}

const NAMED = /^(.*?)\s*<([^<>]+)>$/;

export function displayPerson(field: string): DisplayPerson {
  const text = field.trim();
  const named = NAMED.exec(text);
  if (named) {
    const email = (named[2] as string).trim();
    const name = (named[1] as string).replace(/^"|"$/g, "").trim();
    return { label: name === "" ? email : name, email };
  }
  return { label: text, email: text.includes("@") ? text : null };
}

/** Just the part worth putting in a narrow column. */
export function personLabel(field: string): string {
  return displayPerson(field).label;
}

/** Two letters for an avatar, from a name or an address. */
export function personInitials(field: string): string {
  const { label } = displayPerson(field);
  const words = label.split(/[\s._-]+/).filter((word) => word !== "");
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  return (letters.join("") || label.slice(0, 2)).toUpperCase();
}
