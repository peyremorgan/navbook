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
 * Match a person against an `author:`/`assignee:` query value: an address,
 * bare or named, matches by its address case-insensitively, and a bare domain
 * fragment matches as a substring of the part after `@` (spec 04, query
 * grammar).
 *
 * A named value is matched by its address alone, because the address is the
 * identity key (§2.4) — and because it is the form every person field is
 * written and listed in, so a value picked from a listing has to find the
 * people it came from.
 */
export function personMatches(queryValue: string, personField: string): boolean {
  const text = queryValue.trim();
  if (text === "") return false;
  const needle = (parsePerson(text)?.email ?? text).toLowerCase();
  const person = parsePerson(personField);
  const email = (person?.email ?? personField).trim().toLowerCase();
  if (email === needle) return true;
  if (needle.includes("@")) return false;
  const domain = email.slice(email.indexOf("@") + 1);
  return domain.includes(needle);
}

/**
 * One entry per address, in the order the addresses first appear.
 *
 * The name is the first one any entry for that address carried, so a source
 * listed before another names a person that later source cannot rename — while
 * a later source may still name an address every earlier one left bare. That
 * is what makes {@link mergePeople}'s argument order a precedence order.
 */
export function dedupePeople(people: Iterable<Person>): Person[] {
  const byEmail = new Map<string, Person>();
  for (const person of people) {
    const key = person.email.trim().toLowerCase();
    const seen = byEmail.get(key);
    if (seen === undefined) {
      byEmail.set(key, person);
      continue;
    }
    // A bare entry is completed by a later one that has a name; a named entry
    // is never renamed.
    if (seen.name === undefined && person.name !== undefined) {
      byEmail.set(key, { name: person.name, email: seen.email });
    }
  }
  return [...byEmail.values()];
}

/**
 * Order two people for a menu: by what is shown, then by what they are.
 *
 * Compared lowercased rather than through `localeCompare`, because the answer
 * is computed once and read everywhere: a listing that depended on the locale
 * of whichever process built it would not be one answer.
 */
export function comparePeople(a: Person, b: Person): number {
  const left = (a.name ?? a.email).toLowerCase();
  const right = (b.name ?? b.email).toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  const leftEmail = a.email.toLowerCase();
  const rightEmail = b.email.toLowerCase();
  if (leftEmail === rightEmail) return 0;
  return leftEmail < rightEmail ? -1 : 1;
}

/**
 * Several sources of people as one sorted directory, earlier sources first.
 *
 * "First" is about names rather than membership: every source contributes
 * everybody it knows, and the earliest one that has a name for an address is
 * the one that names it (see {@link dedupePeople}).
 */
export function mergePeople(...sources: readonly (readonly Person[])[]): Person[] {
  return dedupePeople(sources.flat()).sort(comparePeople);
}
