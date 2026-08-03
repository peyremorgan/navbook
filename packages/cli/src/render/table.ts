/**
 * Column-aligned listings for `nav issue list` / `nav pr list`.
 */

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
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...rows.map((row) => displayWidth(row[index] ?? ""))),
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
  for (const row of rows) {
    lines.push(
      joinCells(
        columns.map((_, index) =>
          pad(truncate(row[index] ?? "", widths[index] as number), widths[index] as number),
        ),
      ),
    );
  }
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

function pad(text: string, width: number): string {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + " ".repeat(padding) : text;
}

/** Truncate to `width`, marking the cut with a single ellipsis character. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width === 1) return "~";
  return `${text.slice(0, width - 1)}~`;
}

function displayWidth(text: string): number {
  return [...text].length;
}
