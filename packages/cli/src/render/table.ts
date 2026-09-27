/**
 * Column-aligned listings for `nav issue list` / `nav pr list`.
 */

import { createRequire } from "node:module";
import type { Colors } from "./colors.ts";

export interface Column {
  header: string;
  /** Cells are truncated to this width when the terminal is narrow. */
  flexible?: boolean;
  minWidth?: number;
}

export interface TableOptions {
  colors: Colors;
  /** Total width available; unlimited when undefined. */
  width?: number;
}

const GAP = "  ";

/** Render a table, shrinking flexible columns to fit the terminal width. */
export function renderTable(
  columns: readonly Column[],
  rows: readonly string[][],
  opts: TableOptions,
): string {
  if (rows.length === 0) return "";
  const cells = rows.map((row) => columns.map((_, index) => printable(row[index] ?? "")));
  const measured = cells.map((row) => row.map(displayWidth));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...measured.map((row) => row[index] as number)),
  );

  const available = opts.width;
  if (available !== undefined) shrinkToFit(columns, widths, available);

  const lines: string[] = [];
  lines.push(
    opts.colors.dim(
      joinCells(
        columns.map((column, index) => pad(column.header.toUpperCase(), widths[index] as number)),
      ),
    ),
  );
  cells.forEach((row, rowIndex) => {
    lines.push(
      joinCells(
        row.map((text, index) => {
          const width = widths[index] as number;
          const fitted = fit(text, measured[rowIndex]?.[index] as number, width);
          return padTo(fitted.text, fitted.width, width);
        }),
      ),
    );
  });
  return lines.join("\n");
}

function shrinkToFit(columns: readonly Column[], widths: number[], available: number): void {
  const gaps = GAP.length * (columns.length - 1);
  const flexible = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.flexible);
  if (flexible.length === 0) return;

  let total = widths.reduce((sum, w) => sum + w, 0) + gaps;
  for (const { column, index } of flexible) {
    if (total <= available) break;
    const minWidth = column.minWidth ?? 8;
    const current = widths[index] as number;
    const reduced = Math.max(minWidth, current - (total - available));
    total -= current - reduced;
    widths[index] = reduced;
  }
}

function joinCells(cells: readonly string[]): string {
  return cells.join(GAP).replace(/\s+$/, "");
}

/** Pad `text` with spaces to `width` terminal columns. */
export function pad(text: string, width: number): string {
  return padTo(text, displayWidth(text), width);
}

function padTo(text: string, measured: number, width: number): string {
  const padding = width - measured;
  return padding > 0 ? text + " ".repeat(padding) : text;
}

/**
 * A cell as it should be shown rather than obeyed.
 *
 * Titles and labels are text people wrote, and YAML lets them hold control
 * characters: a tab moves the cursor by as much as eight columns, and an
 * escape sequence recolours the rest of the listing. Neither has a width a
 * table can reserve, so whitespace becomes a space and anything else a
 * replacement character, which at least says something was there.
 */
function printable(text: string): string {
  return text.replace(/[\t\n\r]/g, " ").replace(/\p{Cc}/gu, "\uFFFD");
}

/** Truncate to `width` columns, marking the cut with a single ellipsis character. */
export function truncate(text: string, width: number): string {
  return fit(text, displayWidth(text), width).text;
}

/**
 * Cut `text`, which is `measured` columns wide, to at most `width` columns.
 *
 * By grapheme cluster, not by code unit: `slice` cuts between the halves of a
 * surrogate pair, leaving a lone surrogate that is not valid UTF-8, and takes a
 * ZWJ sequence apart into the people it is made of. By column, not by count,
 * for the reason `displayWidth` is: a wide character needs two, so the result
 * can be a column short of `width` when one does not fit beside the ellipsis.
 * Returns the width it came to, so the caller need not measure it again.
 */
function fit(text: string, measured: number, width: number): { text: string; width: number } {
  if (width <= 0) return { text: "", width: 0 };
  if (measured <= width) return { text, width: measured };
  if (width === 1) return { text: "~", width: 1 };

  const budget = width - 1;
  let used = 0;
  let kept = "";
  for (const { segment } of graphemes(text)) {
    const cost = graphemeWidth(segment);
    if (used + cost > budget) break;
    used += cost;
    kept += segment;
  }
  return { text: `${kept}~`, width: used + 1 };
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
let segmenter: Intl.Segmenter | undefined;

/** Grapheme clusters, with the segmenter built on first use: it costs ~13 ms. */
function graphemes(text: string): Iterable<{ segment: string }> {
  segmenter ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return segmenter.segment(text);
}

/**
 * How many terminal columns `text` occupies.
 *
 * Not code points: UAX #11 gives East Asian Wide and Fullwidth characters two
 * columns and combining marks none, so a Japanese title counted by code point
 * is padded to half the space it takes and every column after it shifts.
 * Summed grapheme by grapheme, which is how `string-width` counts too, so that
 * a string and the cut `fit` makes of it are measured the same way.
 */
function displayWidth(text: string): number {
  if (PRINTABLE_ASCII.test(text)) return text.length;
  let width = 0;
  for (const { segment } of graphemes(text)) width += graphemeWidth(segment);
  return width;
}

const graphemeWidths = new Map<string, number>();

/**
 * One grapheme's width, from `string-width`'s UAX #11 table.
 *
 * Remembered, because a listing's titles draw on far fewer characters than
 * they hold and each lookup segments and tests its input again. A second
 * implementation lays out the same table from the same data (`unicode-width`
 * in Rust).
 */
function graphemeWidth(grapheme: string): number {
  if (grapheme.length === 1 && PRINTABLE_ASCII.test(grapheme)) return 1;
  let width = graphemeWidths.get(grapheme);
  if (width === undefined) {
    width = stringWidth()(grapheme);
    graphemeWidths.set(grapheme, width);
  }
  return width;
}

const require = createRequire(import.meta.url);
let loaded: ((text: string) => number) | undefined;

/**
 * `string-width`, loaded on first use rather than with the module.
 *
 * Importing it compiles its Unicode property patterns, about 40 ms, and every
 * command loads this module; a listing whose text is all ASCII never needs it.
 */
function stringWidth(): (text: string) => number {
  loaded ??= (require("string-width") as typeof import("string-width")).default;
  return loaded;
}
