/**
 * What the browser calls the page.
 *
 * Every page used to be called `Navbook`, because the only title there was is
 * the one `nuxt.config.ts` puts in the static shell and no page replaced it.
 * A browser history, a bookmark bar and a row of open tabs were therefore rows
 * of identical entries, and the issue you read yesterday could not be found
 * again by name.
 *
 * So each page names itself, and does it by calling `useHead` with what this
 * composes. The parts are ordered the way an address is: the thing you are
 * looking at, then what it belongs to, then the application — narrowest first,
 * because a tab strip truncates from the right and the left is what survives
 * being narrow. The application comes last for the same reason it appears at
 * all: it is what makes a history row identifiable as Navbook's, and it is the
 * part you least need to read.
 *
 * Nothing here is reactive. A detail page's subject arrives with its query, so
 * the page wraps this in a `computed` and `useHead` follows it; keeping the
 * composition pure is what lets it be unit-tested without mounting anything,
 * which is this package's rule for its utilities.
 */

import { shortId } from "~/utils/entities";

/** The application, last in every title and the whole of the shell's. */
export const TITLE_SUFFIX = "Navbook";

/** Between a page and what contains it. */
const PART_SEPARATOR = " — ";
/** Between the whole of a page's name and the application. */
const SUFFIX_SEPARATOR = " · ";

/**
 * One document title, narrowest part first.
 *
 * `pageTitle()` is the application on its own, which is also what a part that
 * is missing or blank leaves behind: a page whose subject has not arrived yet
 * says `Navbook` rather than `undefined · Navbook`.
 *
 * Whitespace is collapsed because a title is one line wherever it is shown,
 * and frontmatter is a text file somebody may have wrapped by hand.
 */
export function pageTitle(...parts: readonly (string | null | undefined)[]): string {
  const named = parts
    .map((part) => (typeof part === "string" ? part.replace(/\s+/g, " ").trim() : ""))
    .filter((part) => part !== "");
  if (named.length === 0) return TITLE_SUFFIX;
  return `${named.join(PART_SEPARATOR)}${SUFFIX_SEPARATOR}${TITLE_SUFFIX}`;
}

/**
 * An issue or a pull request, as a title names it.
 *
 * The reference comes first because it is the part that is known immediately —
 * it is in the address — so a detail page can be named before its query
 * answers and gain the subject's title when it does, rather than showing a
 * flash of the bare application name. It is also what people search their
 * history for, and what they say to each other.
 *
 * `reference` is whatever the route carried, which the format allows to be any
 * unambiguous prefix of four characters or more, or a whole directory name. It
 * is shown as it was typed until the entity itself arrives, at which point its
 * id is what gets shortened — so the title settles on the prefix everybody
 * else in this client displays.
 */
export function entityTitle(reference: string, title?: string | null): string {
  const id = reference.trim();
  const named = id === "" ? "" : `#${shortId(id)}`;
  return pageTitle([named, title?.trim() ?? ""].filter((part) => part !== "").join(" "));
}
