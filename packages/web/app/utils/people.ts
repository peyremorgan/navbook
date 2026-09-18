/**
 * Showing who someone is, for the length of one line.
 *
 * `author:` is an RFC 5322 address on disk — `Alice <alice@example.com>` or a
 * bare address (spec 02 §2.4) — and a list row wants the short half of that.
 * This splits it for display, and says whether two such fields name the same
 * person by carrying the same address. It does not validate an address, decide that
 * two different addresses are one person, or match one against a filter. Those
 * are format questions, and format questions are the server's (spec 06 §6.3);
 * the filter sends the string the person typed and lets the server answer, and
 * the one spelling this module ever prefers is a spelling the server sent.
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

/**
 * Up to two letters for an avatar.
 *
 * A bare address contributes only its local part: `someone@example.invalid`
 * says nothing about anybody through `example` or `invalid`, and initials
 * taken from a domain would be the same for a whole organisation.
 */
export function personInitials(field: string): string {
  const { label, email } = displayPerson(field);
  const source = label === email && email !== null ? (email.split("@")[0] ?? label) : label;
  const words = source.split(/[\s._-]+/).filter((word) => word !== "");
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return (words[0] ?? "").slice(0, 2).toUpperCase();
}

/** The signed-in person as the server answers them, from the token's claims. */
export interface Viewer {
  name: string | null;
  email: string;
}

/**
 * Whether a value that names a person names this one.
 *
 * Matched on the address rather than on the whole string, because the same
 * person is written both ways: `nav` writes whatever `user.name` says, the
 * web client writes what the token claims, and a file edited by hand may hold
 * a bare address where history has a named one. All three are the same
 * assignee, and a caller asking "am I on this list" wants "yes" for any of
 * them.
 *
 * That is not this module deciding who is whom. Two different addresses are
 * never the same person here, and the key — the address, lowercased — is the
 * one the server itself dedupes people on (`dedupePeople`, core). A value
 * carrying no address at all is only ever its own exact self.
 */
export function namesPerson(value: string, person: string): boolean {
  const wanted = displayPerson(person);
  if (wanted.email === null) return value.trim() === person.trim();
  return displayPerson(value).email?.toLowerCase() === wanted.email.toLowerCase();
}

/**
 * The list with this person added, or — if they are already on it — removed.
 *
 * Removing takes out every entry that names them, not the first one found: a
 * list that has come by both spellings of one address — the bare one `nav`
 * writes beside the named one the token claims — is one assignee twice, and
 * taking half of it off would leave the button still offering to remove you.
 */
export function togglePerson(values: readonly string[], person: string): string[] {
  const kept = values.filter((value) => !namesPerson(value, person));
  return kept.length === values.length ? [...values, person] : kept;
}

/**
 * How this repository spells the viewer, for a field that names a person.
 *
 * Composing `Name <address>` from the token is the obvious answer and the
 * wrong one: if the `name` claim differs from how git history spells the same
 * address — "M. Peyre" against "Morgan PEYRE" — the file gains a second
 * spelling of one person, and the panel shows both. So the spelling is taken
 * from `people`, which is the server's own merge of its history, its tree and
 * the viewer, already formatted (`packages/server`'s `people` resolver).
 *
 * The viewer is always in that answer, so the composed fallback is for the one
 * case where it cannot be: an address the server has not been asked about yet.
 * An empty list is that case rather than a repository with nobody in it, which
 * is why it yields nothing at all — a button written from a guess, offered for
 * the instant before the real answer lands, is worse than one that appears a
 * moment late.
 */
export function viewerField(people: readonly string[], viewer: Viewer | null): string | null {
  if (viewer === null || viewer.email.trim() === "") return null;
  if (people.length === 0) return null;
  return people.find((who) => namesPerson(who, viewer.email)) ?? formatViewer(viewer);
}

function formatViewer(viewer: Viewer): string {
  const name = viewer.name?.trim() ?? "";
  const email = viewer.email.trim();
  return name === "" ? email : `${name} <${email}>`;
}
