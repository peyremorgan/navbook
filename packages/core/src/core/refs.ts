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
  for (const paragraph of paragraphs(markdown.replace(/\r\n?/g, "\n"))) {
    for (const match of withoutCodeSpans(paragraph).matchAll(PROSE_REF)) {
      const id = match[2] as string;
      if (isId(id)) out.add(id);
    }
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
 * It reads as markdown-it does, a line at a time. Each line first gets past
 * the quotes and list items it is still inside, then may open new ones, and
 * what is left is code, a fence, a heading, a rule or prose. Only prose, which
 * is what paragraphs and headings hold, can name a reference.
 *
 * Known to differ: text inside a link is counted, where the web client leaves
 * it alone rather than nest one link in another, and so is text in a table.
 * Neither is code.
 */

/** Past this many quotes and list items inside one another, a marker is text. */
const MAX_NESTING = 64;

/** A run that opens a fence, and its info string (CommonMark §4.5). */
const FENCE = /^(`{3,}|~{3,})(.*)$/;

/** An ATX heading, which is a block of one line. */
const HEADING = /^#{1,6}(?: |$)/;

/** A thematic break: three or more of one of `-`, `*`, `_`, spaced as you like. */
const THEMATIC_BREAK = /^([-*_])(?: *\1){2,} *$/;

/** What turns the paragraph above it into a heading (CommonMark §4.3). */
const SETEXT_UNDERLINE = /^(?:=+|-+) *$/;

/** A list marker, which a space or the end of the line follows; group 1 numbers it. */
const LIST_MARKER = /^(?:[-+*]|(\d{1,9})[.)])(?= |$)/;

/**
 * Where a quote or a list item ends, a line has to say so: a quote goes on for
 * as long as its lines start with `>`, and a list item for as long as they are
 * indented to where its content starts. `width` is how far that is from where
 * the item itself starts.
 */
type Container = { kind: "quote" } | { kind: "item"; width: number; emptyAt: number };

/**
 * The prose of `markdown`, a paragraph or heading at a time, with the quote
 * markers and indentation of its container taken off each line.
 *
 * A fence is a run of three or more backticks or tildes (see {@link opensFence})
 * indented less than four columns past its container. It closes on a run of
 * its own character at least as long, indented the same way, with nothing
 * after, or when its container ends; one never closed runs to the end of the
 * document. A line indented four or more is code too, unless it carries on a
 * paragraph, and so are the lines after it for as long as they are blank or
 * as deeply indented. Tabs count to the next multiple of four columns.
 */
function paragraphs(markdown: string): string[] {
  const out: string[] = [];
  const stack: Container[] = [];
  let fence: { char: string; length: number } | null = null;
  let code = false;
  let paragraph: string[] | null = null;
  const endParagraph = () => {
    if (paragraph !== null) out.push(paragraph.join("\n"));
    paragraph = null;
  };

  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = expandTabs(lines[index] as string);
    let pos = 0;
    let matched = 0;
    for (const container of stack) {
      const indent = spaces(line, pos);
      if (container.kind === "quote") {
        // However far in, as markdown-it has it: only a quote's first `>`
        // must be indented less than four.
        if (line[pos + indent] !== ">") break;
        pos += indent + 1;
        if (line[pos] === " ") pos++;
      } else if (pos + indent === line.length) {
        // A blank line stays in a list item, unless the item began blank:
        // then it has no content, and this ends it.
        if (container.emptyAt === index - 1) break;
      } else if (indent >= container.width) {
        pos += container.width;
      } else {
        break;
      }
      matched++;
    }

    if (fence !== null || code) {
      const rest = line.slice(pos);
      const indent = spaces(rest, 0);
      if (matched === stack.length) {
        if (fence !== null) {
          const run = rest.slice(indent).trimEnd();
          const closes =
            indent < 4 && run.length >= fence.length && run.split(fence.char).join("") === "";
          if (closes) fence = null;
          continue;
        }
        if (indent === rest.length || indent >= 4) continue;
      }
      fence = null;
      code = false;
    }

    if (matched < stack.length) {
      // A line that opens no block of its own carries on the paragraph above,
      // whatever it sits in: CommonMark's lazy continuation.
      if (paragraph !== null && !interrupts(line.slice(pos), stack.slice(matched))) {
        paragraph.push(line.slice(pos).trimStart());
        continue;
      }
      endParagraph();
      stack.length = matched;
    }

    while (stack.length < MAX_NESTING) {
      const indent = spaces(line, pos);
      const text = line.slice(pos + indent);
      if (indent > 3) break;
      if (text[0] === ">") {
        endParagraph();
        stack.push({ kind: "quote" });
        pos += indent + 1;
        if (line[pos] === " ") pos++;
        continue;
      }
      const marker = LIST_MARKER.exec(text);
      if (marker === null || THEMATIC_BREAK.test(text)) break;
      const after = pos + indent + marker[0].length;
      const gap = spaces(line, after);
      const empty = after + gap === line.length;
      // Only a list that starts at one, with something in it, may interrupt
      // a paragraph.
      if (paragraph !== null && (empty || (marker[1] !== undefined && Number(marker[1]) !== 1))) {
        break;
      }
      endParagraph();
      // The content starts a column past the marker when the item is blank
      // or when what follows the marker is code, indented four or more.
      const width = after + (empty || gap > 4 ? 1 : gap) - pos;
      stack.push({ kind: "item", width, emptyAt: empty ? index : -1 });
      pos = Math.min(pos + width, line.length);
    }

    const rest = line.slice(pos);
    const indent = spaces(rest, 0);
    const text = rest.slice(indent);
    const run = indent < 4 ? opensFence(text) : null;
    if (text === "") {
      endParagraph();
    } else if (indent >= 4) {
      if (paragraph !== null) paragraph.push(text);
      else code = true;
    } else if (run !== null) {
      endParagraph();
      fence = { char: run[0] as string, length: run.length };
    } else if (HEADING.test(text)) {
      endParagraph();
      out.push(text);
    } else if (paragraph !== null && SETEXT_UNDERLINE.test(text)) {
      endParagraph();
    } else if (THEMATIC_BREAK.test(text)) {
      endParagraph();
    } else {
      if (paragraph === null) paragraph = [];
      paragraph.push(text);
    }
  }
  endParagraph();
  return out;
}

/**
 * Whether `line`, which has `left` the containers the paragraph above it is
 * in, starts a block and so ends that paragraph rather than carrying it on.
 *
 * Each quote it left asks in turn, from inside whatever holds that quote, and
 * then the paragraph itself. A list marker may start a list there, even one
 * that could not interrupt a paragraph from inside it, and whether the line
 * is indented too far to start anything is judged from where the content of
 * what asks begins, as markdown-it has it: a list item's content begins past
 * the line's start, and to anything inside a quote the line has already left,
 * the line is not indented at all.
 */
function interrupts(line: string, left: Container[]): boolean {
  const indent = spaces(line, 0);
  const text = line.slice(indent);
  if (text === "") return true;
  const list = LIST_MARKER.test(text);
  const block =
    text[0] === ">" || HEADING.test(text) || THEMATIC_BREAK.test(text) || opensFence(text) !== null;
  // Where the content of what asks begins, and of what holds that.
  let from = 0;
  let listFrom = 0;
  let quoted = false;
  const asks = () => {
    if (quoted) return list || block;
    if (indent - from >= 4) return false;
    return block || (list && !(indent - listFrom >= 4 && indent < from));
  };
  for (const container of left) {
    if (container.kind === "item") {
      listFrom = from;
      from += container.width;
      continue;
    }
    if (asks()) return true;
    quoted = true;
  }
  return !quoted && asks();
}

/**
 * The run that opens a fence at the start of `text`, or null. A backtick
 * fence's info string cannot hold a backtick, which is what tells
 * ```` ```x``` ```` on one line apart from a fence.
 */
function opensFence(text: string): string | null {
  const fence = FENCE.exec(text);
  if (fence === null) return null;
  const run = fence[1] as string;
  return run[0] === "`" && (fence[2] as string).includes("`") ? null : run;
}

/** How many spaces `line` has from `pos` on. */
function spaces(line: string, pos: number): number {
  let end = pos;
  while (line[end] === " ") end++;
  return end - pos;
}

/** `line` with each tab replaced by the spaces to the next multiple of four. */
function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const char of line) {
    out += char === "\t" ? " ".repeat(4 - (out.length % 4)) : char;
  }
  return out;
}

/** ASCII punctuation, which a backslash escapes (CommonMark §2.4). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * A paragraph with every code span blanked (CommonMark §6.1), and every
 * character a backslash escapes: an escaped `` ` `` opens no span, and an
 * escaped `#` is no reference, as the web client already has it.
 *
 * A span is a run of backticks, then anything up to a run of exactly as many.
 * A run with no partner is literal text.
 *
 * Linear, because a body is untrusted input: the search for a partner never
 * looks at a run twice.
 */
function withoutCodeSpans(text: string): string {
  const out = text.split("");
  const partners = new Partners(text);
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
      out[i + 1] = " ";
      i += 2;
      continue;
    }
    if (char !== "`") {
      i++;
      continue;
    }
    let length = 1;
    while (text[i + length] === "`") length++;
    const close = partners.after(i + length, length);
    if (close === -1) {
      i += length;
      continue;
    }
    for (let k = i; k < close + length; k++) if (out[k] !== "\n") out[k] = " ";
    i = close + length;
  }
  return out.join("");
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
