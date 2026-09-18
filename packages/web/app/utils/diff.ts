/**
 * Reading a file's hunks into the rows a diff table shows.
 *
 * The server sends what `git diff` printed for the file, from its first `@@`:
 * a string, not a tree, because a 5,000-line diff as JSON objects would be
 * several times the bytes of the same diff as text, and the browser can split
 * lines faster than it can download objects. So the split happens here, once
 * per file, when the file is first shown. This is presentation — what git
 * said is not reinterpreted, only laid out — which is the one kind of work
 * spec 06 §6.3 leaves to a browser.
 *
 * Two things are worked out beyond the split. Line numbers, which the hunk
 * header gives the start of and every row advances. And, for a deleted line
 * that a line was added in place of, the span in which the two differ, so
 * that a one-word change reads as one word rather than two whole lines.
 */

export type RowKind = "hunk" | "context" | "del" | "add" | "note";

export interface DiffRow {
  kind: RowKind;
  /** Line number on the old side; null for an added line and a hunk header. */
  oldNo: number | null;
  /** Line number on the new side; null for a deleted line and a hunk header. */
  newNo: number | null;
  /** The line without its leading marker; for a hunk row, the whole header. */
  text: string;
  /**
   * Where a changed line differs from its counterpart, as `[start, end)`
   * within `text`; null when the whole line is new, or nothing pairs with it.
   */
  mark: [number, number] | null;
}

/**
 * Longer than this and a line is cut, with a note of how much was left out.
 *
 * A minified bundle can put a whole program on one line, and a row a hundred
 * thousand characters wide costs the layout more than the rest of the file
 * (Gitea cuts at 5,000 too).
 */
export const MAX_LINE_CHARS = 5_000;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The rows of one file's patch, in order. */
export function parseHunks(patch: string, maxChars = MAX_LINE_CHARS): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const raw of lines) {
    const marker = raw.charAt(0);
    const line =
      raw.length > maxChars + 1
        ? `${raw.slice(0, maxChars + 1)} … ${raw.length - maxChars - 1} more characters`
        : raw;
    if (marker === "@") {
      const header = HUNK.exec(line);
      if (header) {
        oldNo = Number(header[1]);
        newNo = Number(header[2]);
      }
      rows.push({ kind: "hunk", oldNo: null, newNo: null, text: line, mark: null });
    } else if (marker === "+") {
      rows.push({ kind: "add", oldNo: null, newNo, text: line.slice(1), mark: null });
      newNo += 1;
    } else if (marker === "-") {
      rows.push({ kind: "del", oldNo, newNo: null, text: line.slice(1), mark: null });
      oldNo += 1;
    } else if (marker === "\\") {
      rows.push({ kind: "note", oldNo: null, newNo: null, text: line.slice(2), mark: null });
    } else {
      rows.push({ kind: "context", oldNo, newNo, text: line.slice(1), mark: null });
      oldNo += 1;
      newNo += 1;
    }
  }
  markChanges(rows);
  return rows;
}

/**
 * Mark what changed within each deleted line and the added line that replaced it.
 *
 * A run of deletions followed by a run of additions is a replacement, and
 * its i-th deleted line pairs with its i-th added line, which is how every
 * forge reads it. For each pair, the common prefix and suffix are what stayed;
 * the rest is marked, on both sides. Nothing is marked when the two lines
 * share nothing worth the name — the mark would then cover both lines whole,
 * which the row colours already say.
 */
export function markChanges(rows: DiffRow[]): void {
  let i = 0;
  while (i < rows.length) {
    if (rows[i]?.kind !== "del") {
      i += 1;
      continue;
    }
    const delStart = i;
    while (rows[i]?.kind === "del") i += 1;
    const addStart = i;
    while (rows[i]?.kind === "add") i += 1;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k += 1) {
      const del = rows[delStart + k] as DiffRow;
      const add = rows[addStart + k] as DiffRow;
      const marks = differingSpan(del.text, add.text);
      if (marks === null) continue;
      del.mark = marks[0];
      add.mark = marks[1];
    }
  }
}

/**
 * The spans in which two lines differ, or null when marking would not help.
 *
 * Not marked: identical lines (a whitespace-only change shows as none, which
 * is honest), and lines with no common prefix or suffix at all.
 */
function differingSpan(a: string, b: string): [[number, number], [number, number]] | null {
  if (a === b) return null;
  let prefix = 0;
  const shortest = Math.min(a.length, b.length);
  while (prefix < shortest && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (prefix === 0 && suffix === 0) return null;
  return [
    [prefix, a.length - suffix],
    [prefix, b.length - suffix],
  ];
}

/** `+12 −3`, for a header or a summary line. */
export function countsLabel(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

/** Roughly how tall one file's row is, and its header, on screen. */
const ROW_PX = 20;
const HEADER_PX = 44;

/**
 * The height a file will take once rendered, from what the listing says.
 *
 * Given to `contain-intrinsic-size`, and to the placeholder that stands in
 * for a file not yet rendered, so the scrollbar and the anchors are honest
 * before any row exists. A withheld or empty body is one line of text.
 */
export function estimatedHeight(
  file: { patch: string | null; lines: number },
  collapsed = false,
): number {
  if (collapsed) return HEADER_PX;
  return HEADER_PX + (file.patch === null ? ROW_PX * 2 : file.lines * ROW_PX);
}
