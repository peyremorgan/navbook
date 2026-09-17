/**
 * What a reference to an issue or a pull request looks like in prose.
 *
 * The format spells one `#<id>` — "duplicate of #t4mwvm2j" — and `nav doctor`
 * reads them back to warn about the ones that match nothing (spec 02 §2.9,
 * check D8). Here the same spelling is recognised for one purpose only: to
 * turn it into a link somebody can follow.
 *
 * This is the one thing about the format the browser is told, and it is worth
 * saying why, because the rule is otherwise that nothing about it ships here
 * (spec 06 §6.3, `nuxt.config.ts`). That rule is about *composing* files: the
 * client sends fields and the server writes them, so no two implementations
 * can disagree about what lands on disk. Finding a reference in text it is
 * already rendering composes nothing. What the reference *means* — which
 * entity it names, whether it names one at all — is still asked of the server,
 * on `/ref/:id`, because that is the answer this side could not compute.
 *
 * The grammar is `PROSE_REF` and `isId` in `packages/core`, and
 * `test/node/references.test.ts` holds the two to each other: a client that
 * linked something `doctor` does not count as a reference, or skipped one it
 * does, would be a second opinion about the format, which is exactly what is
 * not wanted.
 */

/**
 * `#` followed by eight id-shaped characters, when it opens a word.
 *
 * Group 1 is the character before it, which is matched rather than looked
 * behind so that `x#abcdefg1`, a URL fragment and a path segment are all left
 * alone; group 2 is the candidate. A reference at the very start of a line is
 * a Markdown heading, which is why the format asks for them mid-line — but the
 * grammar accepts one there, and so does this, since by the time text reaches
 * a renderer the heading marker has already been parsed away.
 *
 * Shape only: {@link isReferenceId} decides whether what it caught is an id.
 */
const PROSE_REFERENCE = /(^|[^\w#/`])#([a-z][a-z0-9]{7})\b/g;

/**
 * An id is eight characters, opens with a letter, and holds a digit.
 *
 * The digit is the part worth naming. It is what the format has instead of a
 * rule about vocabulary: without it `#deadline` and `#reverted` are both
 * perfectly good ids, and every eight-letter hashtag anybody writes becomes a
 * link to nothing.
 */
function isReferenceId(candidate: string): boolean {
  return /^[a-z][a-z0-9]{7}$/.test(candidate) && /[0-9]/.test(candidate);
}

/** One `#id` found in prose, and where it sits. */
export interface ProseReference {
  /** The id, without the `#`. */
  id: string;
  /** The offset of the `#`. */
  start: number;
  /** One past the last character of the id. */
  end: number;
}

/** Every reference in a run of text, in the order they appear. */
export function findProseReferences(text: string): ProseReference[] {
  const found: ProseReference[] = [];
  // `matchAll` works on a copy of the expression, so the `g` flag's position
  // is not carried from one call to the next.
  for (const match of text.matchAll(PROSE_REFERENCE)) {
    const id = match[2] as string;
    if (!isReferenceId(id)) continue;
    // Group 1 is the character before the `#`, matched rather than looked
    // behind, so the `#` starts after it.
    const start = (match.index ?? 0) + (match[1] ?? "").length;
    found.push({ id, start, end: start + id.length + 1 });
  }
  return found;
}

/**
 * Where a reference points before anyone knows what it names.
 *
 * An id says nothing about its kind — issues and pull requests are minted from
 * one space of 8 random characters (spec 02 §2.2) — so a link built from the
 * text alone cannot name `/issues/:ref` or `/prs/:ref`. It names the route
 * that asks.
 */
export function referencePath(id: string): string {
  return `/ref/${id}`;
}
