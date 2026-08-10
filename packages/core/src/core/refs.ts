/**
 * References — spec 02 §2.9. `#<id>` in prose, `Refs:`/`Closes:` git trailers in
 * commit messages. Mentions never change state; they only document intent.
 */

import { isId } from "./id.ts";

const PROSE_REF = /(^|[^\w#/`])#([a-z][a-z0-9]{7})\b/g;

/**
 * A git trailer Navbook writes. `Refs:` and `Closes:` name entities a commit
 * relates to; `Deletes:` names ones it took away, which is the opposite of a
 * reference and is why it is read separately (see {@link extractDeletedIds}).
 */
const TRAILER_LINE = /^(Refs|Closes|Deletes):[ \t]*(.+?)[ \t]*$/gim;

/** Extract `#id` references from Markdown prose, ignoring English words. */
export function extractProseRefs(markdown: string): string[] {
  const out = new Set<string>();
  for (const match of markdown.matchAll(PROSE_REF)) {
    const id = match[2] as string;
    if (isId(id)) out.add(id);
  }
  return [...out];
}

/**
 * The IDs one kind of trailer names, in order.
 *
 * One grammar for all of them: the key is matched case-insensitively, several
 * IDs may share a line separated by spaces or commas, and a leading `#` is
 * tolerated because that is how people write them in prose.
 */
function trailerIds(message: string, key: string): string[] {
  const out: string[] = [];
  for (const match of message.matchAll(TRAILER_LINE)) {
    if ((match[1] as string).toLowerCase() !== key) continue;
    for (const token of (match[2] as string).split(/[\s,]+/)) {
      const id = token.replace(/^#/, "");
      if (isId(id)) out.push(id);
    }
  }
  return out;
}

/**
 * The subject `nav {issue|pr} delete --commit` writes, as built by
 * `docsSubject(kind, "delete", id)`. Reading it back is what lets doctor tell
 * an entity that was deliberately removed from one that went missing.
 */
const DELETE_SUBJECT = /^docs\((?:issue|pr)\): delete #([a-z][a-z0-9]{7})$/;

/**
 * Every entity ID a commit deleted; empty when it deleted none.
 *
 * A recursive delete takes entities its subject cannot name, and records each
 * of them as a `Deletes:` trailer. That trailer is read only from a commit
 * whose subject already says it deleted something: suppressing a warning is not
 * a power an arbitrary commit gets to claim by writing one line.
 */
export function extractDeletedIds(message: string): string[] {
  const subject = message.trimStart().split("\n", 1)[0] ?? "";
  const match = DELETE_SUBJECT.exec(subject);
  if (!match) return [];
  return [...new Set([match[1] as string, ...trailerIds(message, "deletes")])];
}

export interface TrailerRefs {
  refs: string[];
  closes: string[];
}

/** Extract `Refs:` and `Closes:` trailers from a commit message. */
export function extractTrailerRefs(message: string): TrailerRefs {
  return {
    refs: [...new Set(trailerIds(message, "refs"))],
    closes: [...new Set(trailerIds(message, "closes"))],
  };
}
