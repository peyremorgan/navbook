/**
 * The verbs issues and pull requests share — spec 04 §4.3.
 *
 * One implementation serves both nouns; the entity kind only selects which
 * collection is searched, which file name is edited, and which words appear in
 * the report. The work itself is in `ops/entity.ts` — what is left here is
 * gathering what the user typed and phrasing what came back.
 */

import {
  applyComment,
  applyEntityEdit,
  type CloseInput,
  closeEntity,
  commentJson,
  commitReport,
  currentAuthor,
  type EntityDeletePlan,
  type EntityKind,
  type EntityRecord,
  entityJson,
  executeEntityDelete,
  findEntity,
  listEntities,
  loadRepo,
  type NewCommentInput,
  newCommentFile,
  parentNode,
  parseListQuery,
  planEntityDelete,
  readAssignees,
  readLabels,
  reopenEntity,
  resolveComment,
  resolveEntity,
  resolveEntityForEdit,
  revalidateEntityFile,
  reviewSummary,
  subtaskTree,
  toNdjson,
  uncommittedUnder,
  validateComment,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { openInEditor } from "../editor.ts";
import { fail } from "../errors.ts";
import { askYesNo } from "../prompt.ts";
import { renderDetail } from "../render/detail.ts";
import { type Column, renderTable } from "../render/table.ts";
import { composeFile } from "./compose.ts";
import { warnPolicyProblems } from "./policy.ts";

export interface GlobalFlags {
  json?: boolean;
  commit?: boolean;
}

const PLURAL: Record<EntityKind, string> = { issue: "issues", pr: "pull requests" };

/* --------------------------------------------------------------------- list */

export interface ExtraColumn {
  header: string;
  value: (entity: EntityRecord) => string;
  /** Shown only when this holds of some entity listed; always, when absent. */
  when?: (entities: readonly EntityRecord[]) => boolean;
  /** Grown to fill the terminal, like `title`, rather than sized to content. */
  flexible?: boolean;
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
  const query = parseListQuery(ctx, terms, kind);
  const matched = listEntities(ctx, kind, query, {
    ...(opts.entities ? { entities: opts.entities } : {}),
  });
  reportList(ctx, kind, matched, opts);
}

/** Render a listing whose entities have already been collected. */
export function reportList(
  ctx: Ctx,
  kind: EntityKind,
  matched: readonly EntityRecord[],
  opts: ListOptions,
): void {
  if (opts.json) {
    if (matched.length === 0) return;
    const objects = matched.map((entity) =>
      entityJson(ctx.navDir, entity, opts.jsonExtra?.(entity) ?? {}),
    );
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
    if (column.when && !column.when(entities)) continue;
    columns.push({
      header: column.header,
      ...(column.flexible ? { flexible: true, minWidth: 6 } : {}),
    });
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

/* --------------------------------------------------------------------- show */

export interface ShowOptions extends GlobalFlags {
  /** Levels of subtasks to render; issue-only, one by default. */
  depth?: number;
}

export function cmdShow(ctx: Ctx, kind: EntityKind, prefix: string, opts: ShowOptions): void {
  const repo = loadRepo(ctx);
  const entity = resolveEntity(repo, prefix, kind);
  const reading = repo.reviewPolicy;
  if (kind === "pr") warnPolicyProblems(ctx, reading);
  if (opts.json) {
    // `parent` and `subtasks` are frontmatter, so they are already in the
    // object; resolving them would be a second, differently-shaped answer.
    // `review` is not frontmatter at all — it is the derived state of spec 02
    // §2.7, and it is here rather than in `list` because `show` is the command
    // that has already read every comment it is computed from.
    ctx.stdout.write(
      `${JSON.stringify(
        entityJson(ctx.navDir, entity, {
          ...(kind === "pr"
            ? {
                review: reviewSummary(entity, reading.policy),
                reviewPolicy: {
                  selfReview: reading.policy.selfReview,
                  minApprovals: reading.policy.minApprovals,
                  declared: reading.declared,
                },
              }
            : {}),
          comments: entity.comments.map((comment) => commentJson(ctx.navDir, comment)),
        }),
      )}\n`,
    );
    return;
  }
  const depth = opts.depth ?? 1;
  if (!Number.isInteger(depth) || depth < 0) fail("--depth takes a whole number of levels");
  ctx.stdout.write(
    `${renderDetail(entity, {
      colors: ctx.colors,
      navDir: ctx.navDir,
      ...(kind === "issue"
        ? {
            links: { parent: parentNode(repo, entity), subtasks: subtaskTree(repo, entity, depth) },
          }
        : { reviewPolicy: reading }),
    })}\n`,
  );
}

/* --------------------------------------------------------------------- edit */

export function cmdEdit(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const { entity, path } = resolveEntityForEdit(ctx, kind, prefix);
  openInEditor(ctx, path);

  for (const problem of revalidateEntityFile(path, kind)) {
    ctx.stderr.write(`${ctx.colors.yellow("warning:")} ${entity.filePath}: ${problem}\n`);
  }

  const result = applyEntityEdit(ctx, entity, { commit: opts.commit });
  ctx.stdout.write(`Edited #${entity.id}  ${ctx.navDir}/${entity.filePath}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
}

/* ------------------------------------------------------------------ comment */

export interface CommentOptions extends GlobalFlags {
  message?: string;
  replyTo?: string;
  /** Review fields, supplied by `nav pr review`. */
  review?: Pick<NewCommentInput, "verdict" | "revision" | "file" | "line">;
}

export function cmdComment(ctx: Ctx, kind: EntityKind, prefix: string, opts: CommentOptions): void {
  const entity = findEntity(ctx, kind, prefix);
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

  const { id, path, run } = applyComment(
    ctx,
    entity,
    { content: composed.content, review: isReview },
    { commit: opts.commit },
  );

  ctx.stdout.write(
    `${isReview ? "Reviewed" : "Commented on"} #${entity.id}  ${ctx.navDir}/${path}  (#${id})\n`,
  );
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* ------------------------------------------------------------ close/reopen */

export interface CloseOptions extends GlobalFlags, CloseInput {}

export function cmdClose(ctx: Ctx, kind: EntityKind, prefix: string, opts: CloseOptions): void {
  const { entity, destination, run } = closeEntity(ctx, kind, prefix, opts, {
    commit: opts.commit,
  });
  ctx.stdout.write(`Closed #${entity.id}  ${ctx.navDir}/${destination}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

export function cmdReopen(ctx: Ctx, kind: EntityKind, prefix: string, opts: GlobalFlags): void {
  const { entity, destination, run } = reopenEntity(ctx, kind, prefix, { commit: opts.commit });
  ctx.stdout.write(`Reopened #${entity.id}  ${ctx.navDir}/${destination}/\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* ------------------------------------------------------------------- delete */

export interface DeleteCommandOptions extends GlobalFlags {
  force?: boolean;
  /** Take the issue's subtasks with it, to any depth; issue-only. */
  recursive?: boolean;
}

/**
 * Remove an entity's directory — spec 04 §4.3.
 *
 * Closing records how work ended; deleting says it should never have been
 * filed. Whatever git already holds can be recovered from history, so the
 * command only stops to ask when it would destroy something git could not give
 * back.
 */
export function cmdDelete(
  ctx: Ctx,
  kind: EntityKind,
  prefix: string,
  opts: DeleteCommandOptions,
): void {
  const deletion = planEntityDelete(ctx, kind, prefix, {
    commit: opts.commit,
    recursive: opts.recursive,
  });
  const { entity, alsoRemoved, detached } = deletion;
  // Only look for work git could not give back when there is a question to
  // ask: the scan is a full `git status`, and --force says not to ask.
  if (!opts.force) confirmLoss(ctx, deletion, uncommittedUnder(ctx, deletion));

  const result = executeEntityDelete(ctx, deletion, { commit: opts.commit });
  ctx.stdout.write(`Deleted #${entity.id}  ${ctx.navDir}/${entity.dirPath}/\n`);
  for (const target of alsoRemoved) {
    ctx.stdout.write(`Deleted #${target.id}  ${ctx.navDir}/${target.dirPath}/\n`);
  }
  // Subtasks kept are now top-level, which is easy to miss and hard to undo
  // from memory, so they are named rather than merely implied.
  if (detached.length > 0) {
    ctx.stdout.write(`${detached.length} subtask(s) are now top-level issues:\n`);
    for (const child of detached) ctx.stdout.write(`  #${child.id}  ${child.title}\n`);
  }
  if (opts.commit) ctx.stdout.write(`${commitReport(result)}\n`);
}

/** Ask before destroying content that is not in git yet. */
function confirmLoss(ctx: Ctx, deletion: EntityDeletePlan, uncommitted: readonly string[]): void {
  if (uncommitted.length === 0) return;
  const { entity, alsoRemoved } = deletion;
  const what =
    alsoRemoved.length === 0
      ? `#${entity.id}`
      : `#${entity.id} and its ${alsoRemoved.length} subtask(s)`;

  ctx.stdout.write(
    `${what} ${alsoRemoved.length === 0 ? "has" : "have"} changes that are not committed:\n`,
  );
  for (const entry of uncommitted) ctx.stdout.write(`  ${entry}\n`);
  ctx.stdout.write("Deleting it loses them; everything else can be recovered from history.\n");
  const target =
    alsoRemoved.length === 0
      ? `${ctx.navDir}/${entity.dirPath}/`
      : `${ctx.navDir}/${entity.dirPath}/ and ${alsoRemoved.length} more`;
  if (!askYesNo(ctx, `Delete ${target} anyway? [y/N] `)) {
    fail(`#${entity.id} was not deleted`);
  }
}
