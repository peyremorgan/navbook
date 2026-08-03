/**
 * `nav pr <verb>` — spec 04 §4.3.
 *
 * The eight shared verbs come from `entity.ts`; this module adds the three that
 * only pull requests have (`update`, `review`, `merge`) and the parts of the
 * shared verbs that must reach across branches, because a PR's files live on
 * the branch it proposes to merge (spec 03 §3.5).
 */

import {
  applyComment,
  bindReviewRevision,
  commitReport,
  continuePrMerge,
  currentAuthor,
  type EntityRecord,
  entityJson,
  executePrMerge,
  findEntity,
  listEntities,
  listPrsAcrossRefs,
  type MergeResult,
  materializePrIfAbsent,
  NAVBOOK_ROOT,
  type NewCommentInput,
  newCommentFile,
  newPrFile,
  openPr,
  parseListQuery,
  planPrMerge,
  preparePrOpen,
  stringField,
  toNdjson,
  updatePr,
  type Verdict,
  validateComment,
  validatePr,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { composeFile } from "./compose.ts";
import {
  type CloseOptions,
  cmdClose,
  type GlobalFlags,
  type ListOptions,
  reportList,
} from "./entity.ts";

/* --------------------------------------------------------------------- open */

export interface PrOpenOptions extends GlobalFlags {
  target?: string;
  title?: string;
  message?: string;
  draft?: boolean;
  label?: string[];
  assignee?: string[];
  milestone?: string;
}

export function cmdPrOpen(ctx: Ctx, opts: PrOpenOptions): void {
  const draft = preparePrOpen(ctx, { target: opts.target });
  const title = opts.title ?? draft.defaultTitle;

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_PR.md",
    noun: "pull request",
    render: (body) =>
      newPrFile({
        title,
        author: currentAuthor(ctx),
        created: draft.created,
        target: draft.target,
        source: draft.source,
        revisions: [draft.revision],
        body,
        draft: opts.draft,
        labels: opts.label,
        assignee: opts.assignee,
        milestone: opts.milestone,
      }),
    validate: validatePr,
  });

  const { id, dirPath, run } = openPr(
    ctx,
    { content: composed.content, fallbackTitle: title },
    { commit: opts.commit },
  );

  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/${dirPath}/  (#${id})\n`);
  ctx.stdout.write(`Targets ${draft.target}, from ${draft.source} at ${draft.head.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* ------------------------------------------------------------------- update */

export function cmdPrUpdate(ctx: Ctx, prefix: string, opts: GlobalFlags): void {
  const { entity, head, revisionCount, run } = updatePr(ctx, prefix, { commit: opts.commit });
  ctx.stdout.write(
    `Recorded revision ${revisionCount} of #${entity.id}  head ${head.slice(0, 12)}\n`,
  );
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* ------------------------------------------------------------------- review */

export interface ReviewOptions extends GlobalFlags {
  approve?: boolean;
  requestChanges?: boolean;
  message?: string;
  revision?: string;
  file?: string;
  line?: string;
}

export function cmdPrReview(ctx: Ctx, prefix: string, opts: ReviewOptions): void {
  const entity = findEntity(ctx, "pr", prefix);
  if (opts.approve && opts.requestChanges) {
    fail("choose either --approve or --request-changes, not both");
  }

  const revision = bindReviewRevision(entity, opts.revision);
  if (opts.line && !opts.file) fail("--line needs --file");

  const verdict: Verdict | undefined = opts.approve
    ? "approve"
    : opts.requestChanges
      ? "request-changes"
      : undefined;
  const isReview = verdict !== undefined || opts.file !== undefined;

  const base: NewCommentInput = {
    author: currentAuthor(ctx),
    body: "",
    ...(verdict ? { verdict } : {}),
    ...(isReview ? { revision } : {}),
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.line ? { line: opts.line } : {}),
  };

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_REVIEW.md",
    noun: verdict ? "review" : "comment",
    render: (body) => newCommentFile({ ...base, body }),
    validate: (parsed) => validateComment(parsed, { onPr: true }),
  });

  const { id, path, run } = applyComment(
    ctx,
    entity,
    { content: composed.content, review: isReview },
    { commit: opts.commit },
  );

  const label = verdict ? `Reviewed (${verdict})` : "Commented on";
  ctx.stdout.write(`${label} #${entity.id}  ${NAVBOOK_ROOT}/${path}  (#${id})\n`);
  if (isReview) ctx.stdout.write(`Bound to revision ${revision.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* --------------------------------------------------------------------- list */

export interface PrListOptions extends ListOptions {
  allRefs?: boolean;
}

export function cmdPrList(ctx: Ctx, terms: string[], opts: PrListOptions): void {
  const extraColumns = [
    { header: "target", value: (entity: EntityRecord) => stringField(entity, "target") },
  ];
  const query = parseListQuery(terms, "pr");

  if (!opts.allRefs) {
    reportList(ctx, "pr", listEntities(ctx, "pr", query), { ...opts, extraColumns });
    return;
  }

  const matched = listPrsAcrossRefs(ctx, query);
  if (opts.json) {
    if (matched.length === 0) return;
    ctx.stdout.write(
      `${toNdjson(
        matched.map((entry) =>
          entityJson(entry.entity, { refs: entry.refs.map((ref) => ref.short) }),
        ),
      )}\n`,
    );
    return;
  }
  if (matched.length === 0) {
    ctx.stdout.write("No pull requests match this query on any fetched branch.\n");
    return;
  }

  reportList(
    ctx,
    "pr",
    listEntities(ctx, "pr", query, { entities: matched.map((e) => e.entity) }),
    {
      ...opts,
      extraColumns: [
        ...extraColumns,
        {
          header: "refs",
          value: (entity: EntityRecord) =>
            (matched.find((entry) => entry.entity.id === entity.id)?.refs ?? [])
              .map((ref) => ref.short)
              .join(","),
        },
      ],
    },
  );
}

/* -------------------------------------------------------------------- merge */

export interface MergeOptions extends GlobalFlags {
  noFf?: boolean;
  continue?: boolean;
}

export function cmdPrMerge(ctx: Ctx, prefix: string | undefined, opts: MergeOptions): void {
  if (opts.continue) {
    reportMerge(ctx, continuePrMerge(ctx, prefix));
    return;
  }
  if (!prefix) fail("nav pr merge needs the ID of the pull request to merge");

  const plan = planPrMerge(ctx, prefix, { noFf: opts.noFf });
  reportMerge(ctx, executePrMerge(ctx, plan));
}

function reportMerge(ctx: Ctx, result: MergeResult): void {
  ctx.stdout.write(`Merged #${result.entity.id}  ${NAVBOOK_ROOT}/${result.dirPath}/\n`);
  if (result.mergeSha) ctx.stdout.write(`Merge commit ${result.mergeSha.slice(0, 12)}\n`);
}

/* --------------------------------------------------------------------- close */

/**
 * Decline a pull request.
 *
 * Its files usually live on the source branch, so when the ID is not in the
 * current tree the directory is first checked out from the ref that has it —
 * which is exactly the manual recipe spec 02 §2.8 describes for keeping a
 * durable record of a declined PR on the default branch.
 */
export function cmdPrClose(ctx: Ctx, prefix: string, opts: CloseOptions): void {
  const materialized = materializePrIfAbsent(ctx, prefix);
  if (materialized) {
    ctx.stdout.write(
      `Brought #${materialized.id} onto this branch from ${materialized.ref} so it can be recorded\n`,
    );
  }
  cmdClose(ctx, "pr", prefix, opts);
}
