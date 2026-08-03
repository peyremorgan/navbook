/**
 * References — spec 02 §2.9. `#<id>` in prose, `Refs:`/`Closes:` git trailers in
 * commit messages. Mentions never change state; they only document intent.
 */

import { isId } from "./id.ts";

const PROSE_REF = /(^|[^\w#/`])#([a-z][a-z0-9]{7})\b/g;
const TRAILER_LINE = /^(Refs|Closes):[ \t]*(.+?)[ \t]*$/gim;

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
 * The subject `nav {issue|pr} delete --commit` writes, as built by
 * `docsSubject(kind, "delete", id)`. Reading it back is what lets doctor tell
 * an entity that was deliberately removed from one that went missing.
 */
const DELETE_SUBJECT = /^docs\((?:issue|pr)\): delete #([a-z][a-z0-9]{7})$/;

/** The entity ID a commit deleted, or null when it deleted none. */
export function extractDeletedId(message: string): string | null {
  const subject = message.trimStart().split("\n", 1)[0] ?? "";
  const match = DELETE_SUBJECT.exec(subject);
  return match ? (match[1] as string) : null;
}

export interface TrailerRefs {
  refs: string[];
  closes: string[];
}

/** Extract `Refs:` and `Closes:` trailers from a commit message. */
export function extractTrailerRefs(message: string): TrailerRefs {
  const refs = new Set<string>();
  const closes = new Set<string>();
  for (const match of message.matchAll(TRAILER_LINE)) {
    const kind = (match[1] as string).toLowerCase();
    for (const token of (match[2] as string).split(/[\s,]+/)) {
      const id = token.replace(/^#/, "");
      if (!isId(id)) continue;
      if (kind === "closes") closes.add(id);
      else refs.add(id);
    }
  }
  return { refs: [...refs], closes: [...closes] };
}
