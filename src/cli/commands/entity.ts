/**
 * The verbs issues and pull requests share — spec 04 §4.3.
 *
 * One implementation serves both nouns; the entity kind only selects which
 * collection is searched, which file name is edited, and which words appear in
 * the report.
 */

import { readFileSync } from "node:fs";
import {
  type NewCommentInput,
  newCommentFile,
  parseFile,
  readAssignees,
  readLabels,
  validateComment,
  validateIssue,
  validatePr,
} from "../../core/files.ts";
import { commentJson, entityJson, NAVBOOK_ROOT, toNdjson } from "../../core/json.ts";
import { type CloseInput, planClose, planComment, planReopen } from "../../core/ops.ts";
import { isQueryError, matchesQuery, parseQuery, type Query } from "../../core/query.ts";
import { allIds, type EntityKind, type EntityRecord, type Repo } from "../../core/tree.ts";
import { commitReport, runPlan } from "../commit-flow.ts";
import type { Ctx } from "../context.ts";
import { openInEditor } from "../editor.ts";
import { fail } from "../errors.ts";
import { renderDetail } from "../render/detail.ts";
import { type Column, renderTable } from "../render/table.ts";
import { resolveComment, resolveEntity } from "../resolve.ts";
import { absPath, loadRepo, loadRepoForQuery, repoPath, stage } from "../workspace.ts";
import { composeFile } from "./compose.ts";

export interface GlobalFlags {
  json?: boolean;
  commit?: boolean;
}

const PLURAL: Record<EntityKind, string> = { issue: "issues", pr: "pull requests" };

/** Author string for the current git identity. */
export function currentAuthor(ctx: Ctx): string {
  const identity = ctx.identity();
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}

/** Entities of one kind from a parsed repository. */
export function selectEntities(repo: Repo, kind: EntityKind): EntityRecord[] {
  return kind === "issue" ? repo.issues : repo.prs;
}

/** Newest first, with a stable tie-break on ID. */
export function sortEntities(entities: readonly EntityRecord[]): EntityRecord[] {
  return [...entities].sort((a, b) => {
    const aCreated = typeof a.fm.created === "string" ? a.fm.created : "";
    const bCreated = typeof b.fm.created === "string" ? b.fm.created : "";
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/* --------------------------------------------------------------------- list */

export interface ExtraColumn {
  header: string;
  value: (entity: EntityRecord) => string;
}

export interface ListOptions extends GlobalFlags {
  /** Columns appended by PR-specific listings. */
  extraColumns?: ExtraColumn[];
  /** Pre-collected entities, used by `nav pr list --all-refs`. */
  entities?: EntityRecord[];
  /** Extra JSON keys per entity, keyed by entity identity. */
  jsonExtra?: (entity: EntityRecord) => Record<string, unknown>;
}

export function cmdList(ctx: Ctx, kind: EntityKind, terms: string[], opts: ListOptions): void {
  const query = parseQuery(terms, kind);
  if (isQueryError(query)) fail(query.message);

  const source = opts.entities ?? selectEntities(loadRepoForQuery(ctx, query), kind);
  const matched = sortEntities(source.filter((entity) => matchesQuery(query, entity)));

  if (opts.json) {
    if (matched.length === 0) return;
    const objects = matched.map((entity) => entityJson(entity, opts.jsonExtra?.(entity) ?? {}));
    ctx.stdout.write(`${toNdjson(objects)}\n`);
    return;
  }
  if (matched.length === 0) {
    ctx.stdout.write(`No ${PLURAL[kind]} match this query.\n`);
    return;
  }
  ctx.stdout.write(`${renderList(ctx, matched, opts.extraColumns ?? [])}\n`);
}

function renderList(
  ctx: Ctx,
  entities: readonly EntityRecord[],
  extra: readonly ExtraColumn[],
): string {
  const columns: Column[] = [{ header: "id" }, { header: "status" }];
  const values: ((entity: EntityRecord) => string)[] = [(e) => `#${e.id}`, (e) => e.status];
  for (const column of extra) {
    columns.push({ header: column.header });
    values.push(column.value);
  }
  columns.push({ header: "title", flexible: true, minWidth: 20 });
  values.push((e) => e.title);
  if (entities.some((e) => readLabels(e.fm).length > 0)) {
    columns.push({ header: "labels", flexible: true, minWidth: 6 });
    values.push((e) => readLabels(e.fm).join(","));
  }
  if (entities.some((e) => readAssignees(e.fm).length > 0)) {
    columns.push({ header: "assignee", flexible: true, minWidth: 6 });
    values.push((e) => readAssignees(e.fm).join(","));
  }
  const rows = entities.map((entity) => values.map((value) => value(entity)));
  return renderTable(columns, rows, { colors: ctx.colors, width: terminalWidth(ctx) });
}

function terminalWidth(ctx: Ctx): number | undefined {
  const columns = ctx.stdout.columns;
  return typeof columns === "number" && columns > 20 ? columns : undefined;
}

/** The query a listing will run, for callers that need it before loading. */
export function parseListQuery(terms: string[], kind: EntityKind): Query {
  const query = parseQuery(terms, kind);
  if (isQueryError(query)) fail(query.message);
  return query;
}

/* --------------------------------------------------------------------- show */

export function cmdShow(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, kind);
  if (opts.json) {
    ctx.stdout.write(
      `${JSON.stringify(entityJson(entity, { comments: entity.comments.map(commentJson) }))}\n`,
    );
    return;
  }
  ctx.stdout.write(`${renderDetail(entity, { colors: ctx.colors })}\n`);
}

/* --------------------------------------------------------------------- edit */

export function cmdEdit(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, kind);
  const target = absPath(ctx, entity.filePath);
  openInEditor(ctx, target);

  for (const problem of revalidate(target, kind)) {
    ctx.stderr.write(`${ctx.colors.yellow("warning:")} ${entity.filePath}: ${problem}\n`);
  }

  const plan = {
    ops: [],
    message: `nb: edit #${entity.id}`,
    trailers: [{ key: "Refs" as const, id: entity.id }],
  };
  stage(ctx, [repoPath(entity.filePath)]);
  ctx.stdout.write(`Edited #${entity.id}  ${NAVBOOK_ROOT}/${entity.filePath}\n`);
  if (opts.commit) {
    runPlan(ctx, plan, { commit: true });
    ctx.stdout.write(`${commitReport(plan)}\n`);
  }
}

function revalidate(path: string, kind: EntityKind): string[] {
  try {
    const parsed = parseFile(readFileSync(path, "utf8"));
    const problems = kind === "issue" ? validateIssue(parsed) : validatePr(parsed);
    return problems.map((problem) => problem.message);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/* ------------------------------------------------------------------ comment */

export interface CommentOptions extends GlobalFlags {
  message?: string;
  replyTo?: string;
  /** Review fields, supplied by `nav pr review`. */
  review?: Pick<NewCommentInput, "verdict" | "revision" | "file" | "line">;
}

export function cmdComment(ctx: Ctx, kind: EntityKind, prefix: string, opts: CommentOptions): void {
  const repo = loadRepo(ctx);
  const entity = resolveEntity(repo, prefix, kind);
  const replyTo = opts.replyTo ? resolveComment(entity, opts.replyTo) : undefined;
  const isReview = opts.review?.verdict !== undefined;
  const noun = isReview ? "review" : "comment";

  const base: NewCommentInput = {
    author: currentAuthor(ctx),
    body: "",
    ...(replyTo ? { replyTo } : {}),
    ...(opts.review ?? {}),
  };

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_COMMENT.md",
    noun,
    render: (body) => newCommentFile({ ...base, body }),
    validate: (parsed) => validateComment(parsed, { onPr: kind === "pr" }),
  });

  const id = ctx.mintId(new Set(allIds(repo).map((entry) => entry.id)));
  const { plan, path } = planComment(entity, id, ctx.now(), composed.content, { review: isReview });
  runPlan(ctx, plan, { commit: opts.commit });

  ctx.stdout.write(
    `${isReview ? "Reviewed" : "Commented on"} #${entity.id}  ${NAVBOOK_ROOT}/${path}  (#${id})\n`,
  );
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

/* ------------------------------------------------------------ close/reopen */

export interface CloseOptions extends GlobalFlags, CloseInput {}

export function cmdClose(ctx: Ctx, kind: EntityKind, prefix: string, opts: CloseOptions): void {
  const repo = loadRepo(ctx);
  const entity = resolveEntity(repo, prefix, kind);
  if (entity.status === "closed") fail(`#${entity.id} is already closed`);
  if (entity.status === "merged") fail(`#${entity.id} is merged and cannot be closed`);

  const input: CloseInput = { ...opts };
  if (input.duplicateOf) {
    const target = resolveEntity(repo, input.duplicateOf, kind);
    if (target.id === entity.id) fail(`#${entity.id} cannot be a duplicate of itself`);
    input.duplicateOf = target.id;
  }

  const plan = planClose(entity, input);
  runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Closed #${entity.id}  ${NAVBOOK_ROOT}/${destination(entity, "closed")}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

export function cmdReopen(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, kind);
  if (entity.status === "open") fail(`#${entity.id} is already open`);
  if (entity.status === "merged") {
    fail(`#${entity.id} is merged; a merged pull request cannot be reopened`);
  }

  const plan = planReopen(entity);
  runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Reopened #${entity.id}  ${NAVBOOK_ROOT}/${destination(entity, "open")}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

function destination(entity: EntityRecord, status: string): string {
  return `${entity.kind === "issue" ? "issues" : "prs"}/${status}/${entity.dirName}`;
}
