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
  const prose = withoutCodeSpans(withoutFences(markdown.replace(/\r\n?/g, "\n")));
  for (const match of prose.matchAll(PROSE_REF)) {
    const id = match[2] as string;
    if (isId(id)) out.add(id);
  }
  return [...out];
}

/*
 * Code is not prose. Pasted terminal output names whatever IDs the terminal
 * printed, and the web client, which renders with markdown-it, links none of
 * them, so neither does this. What follows is the part of CommonMark that
 * decides where code is, and no more: spec 05 keeps the core to one dependency,
 * and `packages/web/test/nuxt/markdown.test.ts` holds this to markdown-it.
 *
 * Known to differ, both rare: a fence indented two or three spaces at the top
 * level of a list item's continuation is closed by the item's end rather than
 * its own, and a code span does not continue onto the next `>` line of a quote.
 */

/**
 * A line that opens or closes a fenced code block (CommonMark §4.5): what may
 * stand before the run on the same line — indentation, `>` markers, a list
 * marker — then a run of three or more backticks or tildes, then the info
 * string.
 */
const FENCE_LINE = /^((?:[ \t]|>|[-*+][ \t]|\d{1,9}[.)][ \t])*)(`{3,}|~{3,})(.*)$/;

/** A line that opens a list item; group 1 runs to where its content starts. */
const LIST_ITEM = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\S/;

/** An ATX heading, which is a block of one line. */
const HEADING = /^(?:[ \t]*>)*[ \t]*#{1,6}(?:[ \t]|$)/;

/** A line that begins a block of its own, so no paragraph runs onto it. */
const BLOCK_START = /^[ \t]*(?:$|>|#{1,6}(?:[ \t]|$)|[-*+][ \t]|\d{1,9}[.)][ \t]|`{3,}|~{3,})/;

/** What opens a line before its content: `>` markers and the space around them. */
const QUOTES = /^(?:[ \t]*>)*/;

/** How many `>` markers open a line. */
function quoteDepth(line: string): number {
  return (QUOTES.exec(line)?.[0].match(/>/g) ?? []).length;
}

/** The indentation of a line once its `>` markers are set aside. */
function indentAfterQuotes(line: string): number {
  const rest = line.slice(QUOTES.exec(line)?.[0].length ?? 0);
  return rest.length - rest.trimStart().length;
}

/**
 * `markdown` with every fenced code block blanked, fences included.
 *
 * A fence closes on a run of its own character at least as long as the one
 * that opened it with nothing after, or when the quote or list item it sits
 * in ends; one never closed runs to the end of the document. A backtick
 * fence's info string cannot hold a backtick, which is what tells ```` ```x```
 * ```` on one line apart from a fence. A run indented four or more past where
 * a fence could open only continues the paragraph above it.
 */
function withoutFences(markdown: string): string {
  // The fence being blanked: its run, and the quote and list item it is in.
  let open: { run: string; quotes: number; column: number } | null = null;
  // Where the content of the list item the text is in starts, past its `>`
  // markers, and how many of those it has; null outside a list.
  let list: { column: number; quotes: number } | null = null;
  let previousBlank = true;
  const out: string[] = [];

  for (const line of markdown.split("\n")) {
    const blank = line.trim() === "";
    if (open !== null) {
      const left =
        quoteDepth(line) < open.quotes ||
        (!blank && open.column > 0 && indentAfterQuotes(line) < open.column);
      if (!left) {
        const fence = FENCE_LINE.exec(line);
        const run = fence?.[2] ?? "";
        const closes =
          fence !== null &&
          run[0] === open.run[0] &&
          run.length >= open.run.length &&
          (fence[3] ?? "").trim() === "";
        if (closes) open = null;
        out.push("");
        previousBlank = true;
        continue;
      }
      // The quote or list item ended, and the fence with it.
      open = null;
    }

    const item = LIST_ITEM.exec(line);
    const quotes = quoteDepth(line);
    if (item) {
      const markers = QUOTES.exec(line)?.[0].length ?? 0;
      list = { column: (item[1] ?? "").length - markers, quotes };
    } else if (
      !blank &&
      list !== null &&
      (quotes !== list.quotes || indentAfterQuotes(line) < list.column)
    ) {
      list = null;
    }

    const fence = FENCE_LINE.exec(line);
    const run = fence?.[2] ?? "";
    const column = indentAfterQuotes(line);
    const infoHoldsBacktick = run.startsWith("`") && (fence?.[3] ?? "").includes("`");
    const continuesParagraph = !item && !previousBlank && column >= (list?.column ?? 0) + 4;
    if (!fence || infoHoldsBacktick || continuesParagraph) {
      out.push(line);
      previousBlank = blank;
      continue;
    }
    open = { run, quotes, column: list?.column ?? 0 };
    out.push("");
    previousBlank = true;
  }
  return out.join("\n");
}

/** ASCII punctuation, which a backslash escapes (CommonMark §2.4). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * `text` with every code span blanked (CommonMark §6.1), and every character
 * a backslash escapes: an escaped `` ` `` opens no span, and an escaped `#`
 * is no reference, as the web client already has it.
 *
 * A span is a run of backticks, then anything up to a run of exactly as many,
 * within the one paragraph: it goes on to the next line only when that line
 * starts no block of its own. A run with no partner is literal text.
 *
 * Linear, because a body is untrusted input: where each paragraph ends is
 * worked out once, and the search for a partner never looks at a run twice.
 */
function withoutCodeSpans(text: string): string {
  const out = text.split("");
  const ends = paragraphEnds(text);
  const partners = new Partners(text);
  let line = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      out[i + 1] = " ";
      i += 2;
      continue;
    }
    if (char === "\n") line++;
    if (char !== "`") {
      i++;
      continue;
    }
    let length = 1;
    while (text[i + length] === "`") length++;
    const close = partners.after(i + length, length);
    if (close === -1 || close + length > (ends[line] as number)) {
      i += length;
      continue;
    }
    for (let k = i; k < close + length; k++) {
      if (out[k] === "\n") line++;
      else out[k] = " ";
    }
    i = close + length;
  }
  return out.join("");
}

/**
 * For each line of `text`, where the paragraph holding it ends: before the
 * next line that starts a block, or with its own line when that is a heading,
 * which is one line long.
 */
function paragraphEnds(text: string): number[] {
  const lines = text.split("\n");
  const ends: number[] = new Array(lines.length);
  let end = text.length;
  for (let k = lines.length - 1; k >= 0; k--) {
    const line = lines[k] as string;
    const next = lines[k + 1];
    if (next === undefined || BLOCK_START.test(next) || HEADING.test(line)) {
      ends[k] = end;
    } else {
      ends[k] = ends[k + 1] as number;
    }
    end -= line.length + 1;
  }
  return ends;
}

/**
 * The runs of backticks in a text, by length, for finding the partner of one.
 *
 * Asked in the order the text is read, so each length's list is walked once:
 * a run before the one asked about can never be a later run's partner either.
 */
class Partners {
  private readonly runs = new Map<number, { starts: number[]; next: number }>();

  constructor(text: string) {
    let i = text.indexOf("`");
    while (i !== -1) {
      let length = 1;
      while (text[i + length] === "`") length++;
      const runs = this.runs.get(length) ?? { starts: [], next: 0 };
      runs.starts.push(i);
      this.runs.set(length, runs);
      i = text.indexOf("`", i + length);
    }
  }

  /** The start of the first run of exactly `length` backticks at or after `from`, or -1. */
  after(from: number, length: number): number {
    const runs = this.runs.get(length);
    if (runs === undefined) return -1;
    while (runs.next < runs.starts.length && (runs.starts[runs.next] as number) < from) runs.next++;
    return runs.starts[runs.next] ?? -1;
  }
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
