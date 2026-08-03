/**
 * The `show` rendering: an entity's metadata, description and comment thread.
 */

import {
  type CommentRecord,
  type EntityRecord,
  NAVBOOK_ROOT,
  readAssignees,
  readLabels,
  readMerged,
  readRevisions,
  threadOrder,
  toIsoSeconds,
} from "@navbook/core";
import type { Colors } from "./colors.ts";

export interface DetailOptions {
  colors: Colors;
}

/** Render one entity with its full comment thread. */
export function renderDetail(entity: EntityRecord, opts: DetailOptions): string {
  const c = opts.colors;
  const lines: string[] = [];
  lines.push(`${c.bold(`#${entity.id}`)} ${entity.title}`);

  const labelWidth = 11;
  for (const [label, value] of metadataRows(entity)) {
    // A continuation row (empty label) is indented to line up under the value.
    const cell = label === "" ? " ".repeat(labelWidth) : c.dim(`${label}:`.padEnd(labelWidth));
    lines.push(`${cell}${value}`);
  }

  const body = entity.body.trim();
  if (body !== "") {
    lines.push("");
    lines.push(body);
  }

  lines.push("");
  lines.push(c.dim(`comments (${entity.comments.length}):`));
  if (entity.comments.length === 0) {
    lines.push(c.dim("  none"));
  } else {
    for (const { comment, depth } of threadOrder(entity.comments)) {
      lines.push("");
      lines.push(...renderComment(comment, depth, c));
    }
  }
  return lines.join("\n");
}

function metadataRows(entity: EntityRecord): [string, string][] {
  const rows: [string, string][] = [];
  rows.push(["status", entity.archived ? `${entity.status} (archived)` : entity.status]);
  rows.push(["author", stringField(entity, "author")]);
  rows.push(["created", stringField(entity, "created")]);

  if (entity.kind === "pr") {
    rows.push(["target", stringField(entity, "target")]);
    const source = stringField(entity, "source");
    if (source !== "") rows.push(["source", source]);
    if (entity.fm.draft === true) rows.push(["draft", "yes"]);
    const revisions = readRevisions(entity.fm);
    revisions.forEach((revision, index) => {
      rows.push([
        index === 0 ? "revisions" : "",
        `${index + 1}. head ${revision.head.slice(0, 12)}  base ${revision.base.slice(0, 12)}  ${revision.date}`,
      ]);
    });
    const merged = readMerged(entity.fm);
    if (merged) {
      rows.push(["merged", `${merged.date ?? "?"} by ${merged.by ?? "?"}`]);
      if (typeof merged.commit === "string")
        rows.push(["", `commit ${merged.commit.slice(0, 12)}`]);
    }
  }

  const labels = readLabels(entity.fm);
  if (labels.length > 0) rows.push(["labels", labels.join(", ")]);
  const assignees = readAssignees(entity.fm);
  if (assignees.length > 0) rows.push(["assignee", assignees.join(", ")]);
  for (const key of ["milestone", "resolution", "duplicate-of", "superseded-by"]) {
    const value = stringField(entity, key);
    if (value !== "") rows.push([key, value]);
  }
  rows.push(["path", `${NAVBOOK_ROOT}/${entity.dirPath}/`]);
  return rows;
}

function stringField(entity: EntityRecord, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
}

function renderComment(comment: CommentRecord, depth: number, c: Colors): string[] {
  const indent = "  ".repeat(depth + 1);
  const head: string[] = [c.bold(`#${comment.id}`), comment.author, toIsoSeconds(comment.date)];
  const verdict = comment.parsed.fm.verdict;
  if (typeof verdict === "string") {
    const paint = verdict === "approve" ? c.green : c.yellow;
    head.push(paint(`[${verdict}]`));
  }
  const revision = comment.parsed.fm.revision;
  if (typeof revision === "string") head.push(c.dim(`@${revision.slice(0, 12)}`));
  const file = comment.parsed.fm.file;
  if (typeof file === "string") {
    const line = comment.parsed.fm.line;
    head.push(c.dim(`${file}${line === undefined ? "" : `:${line}`}`));
  }
  if (comment.replyTo) head.push(c.dim(`reply to #${comment.replyTo}`));

  const lines = [`${indent}${head.join("  ")}`];
  for (const line of comment.body.trim().split("\n")) {
    lines.push(line === "" ? "" : `${indent}  ${line}`);
  }
  return lines;
}
