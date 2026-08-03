/**
 * People — spec 02 §2.4. RFC 5322 addresses, display name optional. The email
 * address is the identity key and is compared case-insensitively.
 */

export interface Person {
  name?: string;
  email: string;
}

const ADDRESS_PATTERN = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const NAMED_PATTERN = /^(.*?)\s*<([^<>]+)>$/;

/** Parse `alice@example.com` or `Alice Smith <alice@example.com>`. */
export function parsePerson(input: string): Person | null {
  const text = input.trim();
  if (text === "") return null;
  const named = NAMED_PATTERN.exec(text);
  if (named) {
    const email = (named[2] as string).trim();
    if (!ADDRESS_PATTERN.test(email)) return null;
    const name = (named[1] as string).replace(/^"|"$/g, "").trim();
    return name === "" ? { email } : { name, email };
  }
  if (!ADDRESS_PATTERN.test(text)) return null;
  return { email: text };
}

/** Render a person back to its RFC 5322 form. */
export function formatPerson(person: Person): string {
  return person.name ? `${person.name} <${person.email}>` : person.email;
}

/** Compare two addresses case-insensitively (§2.4). */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Match a person against an `author:`/`assignee:` query value: the full address
 * matches case-insensitively, and a bare domain fragment matches as a substring
 * of the part after `@` (spec 04, query grammar).
 */
export function personMatches(queryValue: string, personField: string): boolean {
  const needle = queryValue.trim().toLowerCase();
  if (needle === "") return false;
  const person = parsePerson(personField);
  const email = (person?.email ?? personField).trim().toLowerCase();
  if (email === needle) return true;
  if (needle.includes("@")) return false;
  const domain = email.slice(email.indexOf("@") + 1);
  return domain.includes(needle);
}
