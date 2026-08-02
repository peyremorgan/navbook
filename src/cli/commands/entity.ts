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
import { FrontmatterError } from "../../core/frontmatter.ts";
import { commentJson, entityJson, NAVBOOK_ROOT, toNdjson } from "../../core/json.ts";
import {
  type CloseInput,
  docsSubject,
  type Plan,
  planClose,
  planComment,
  planDelete,
  planPaths,
  planReopen,
} from "../../core/ops.ts";
import { isQueryError, matchesQuery, parseQuery, type Query } from "../../core/query.ts";
import type { EntityKind, EntityRecord, Repo } from "../../core/tree.ts";
import { uncommittedPaths } from "../../git/index-ops.ts";
import { assertNoUnrelatedStaged, commitReport, runPlan } from "../commit-flow.ts";
import type { Ctx } from "../context.ts";
import { openInEditor } from "../editor.ts";
import { fail } from "../errors.ts";
import { askYesNo } from "../prompt.ts";
import { renderDetail } from "../render/detail.ts";
import { type Column, renderTable } from "../render/table.ts";
import { resolveComment, resolveEntity } from "../resolve.ts";
import { absPath, loadRepo, loadRepoForQuery, repoPath, scanAllIds } from "../workspace.ts";
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

  // The edited file is the operation's own output, so it belongs in the plan:
  // that is what tells the --commit guard which staged path is expected.
  const plan: Plan = {
    ops: [{ op: "write", path: entity.filePath, content: readFileSync(target, "utf8") }],
    message: docsSubject(entity.kind, "edit", entity.id),
    trailers: [{ key: "Refs", id: entity.id }],
  };
  const result = runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Edited #${entity.id}  ${NAVBOOK_ROOT}/${entity.filePath}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
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

  const id = ctx.mintId(scanAllIds(ctx.navRoot));
  const { plan, path } = planComment(entity, id, ctx.now(), composed.content, { review: isReview });
  const result = runPlan(ctx, plan, { commit: opts.commit });

  ctx.stdout.write(
    `${isReview ? "Reviewed" : "Commented on"} #${entity.id}  ${NAVBOOK_ROOT}/${path}  (#${id})\n`,
  );
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
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

  const plan = rewritePlan(entity, () => planClose(entity, input));
  const result = runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Closed #${entity.id}  ${NAVBOOK_ROOT}/${destination(entity, "closed")}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
}

export function cmdReopen(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, kind);
  if (entity.status === "open") fail(`#${entity.id} is already open`);
  if (entity.status === "merged") {
    fail(`#${entity.id} is merged; a merged pull request cannot be reopened`);
  }

  const plan = rewritePlan(entity, () => planReopen(entity));
  const result = runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Reopened #${entity.id}  ${NAVBOOK_ROOT}/${destination(entity, "open")}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
}

/**
 * Build a plan that rewrites an entity file, turning a malformed-frontmatter
 * failure into an operational error that names the file and the way out.
 */
export function rewritePlan(entity: EntityRecord, build: () => Plan): Plan {
  try {
    return build();
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    fail(`${NAVBOOK_ROOT}/${entity.filePath}: ${error.message}`, [
      "fix the file by hand, or run 'nav doctor' to see what is wrong",
    ]);
  }
}

function destination(entity: EntityRecord, status: string): string {
  return `${entity.kind === "issue" ? "issues" : "prs"}/${status}/${entity.dirName}`;
}

/* ------------------------------------------------------------------- delete */

export interface DeleteOptions extends GlobalFlags {
  force?: boolean;
}

/**
 * Remove an entity's directory — spec 04 §4.3.
 *
 * Closing records how work ended; deleting says it should never have been
 * filed, which is why it takes the directory rather than moving it, and why it
 * works whatever the status. Whatever git already holds can be recovered from
 * history, so the command only stops to ask when it would destroy something
 * git could not give back.
 */
export function cmdDelete(ctx: Ctx, kind: EntityKind, prefix: string, opts: DeleteOptions): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, kind);
  const plan = planDelete(entity);

  // Ahead of the question, not after it: --commit refuses outright while
  // unrelated work is staged, and confirming a deletion that then cannot
  // happen is a worse experience than being told why up front. runPlan checks
  // again below, against an index nothing has touched in between.
  if (opts.commit) assertNoUnrelatedStaged(ctx, planPaths(plan).map(repoPath));
  if (!opts.force) confirmLoss(ctx, entity);

  const result = runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Deleted #${entity.id}  ${NAVBOOK_ROOT}/${entity.dirPath}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
}

/** Ask before destroying content that is not in git yet. */
function confirmLoss(ctx: Ctx, entity: EntityRecord): void {
  const uncommitted = uncommittedPaths(ctx.repoRoot, repoPath(entity.dirPath));
  if (uncommitted.length === 0) return;

  ctx.stdout.write(`#${entity.id} has changes that are not committed:\n`);
  for (const entry of uncommitted) ctx.stdout.write(`  ${entry}\n`);
  ctx.stdout.write("Deleting it loses them; everything else can be recovered from history.\n");
  if (!askYesNo(ctx, `Delete ${NAVBOOK_ROOT}/${entity.dirPath}/ anyway? [y/N] `)) {
    fail(`#${entity.id} was not deleted`);
  }
}
