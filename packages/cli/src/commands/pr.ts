/**
 * `nav pr <verb>` — spec 04 §4.3.
 *
 * The eight shared verbs come from `entity.ts`; this module adds the four that
 * only pull requests have (`update`, `request`, `review`, `merge`) and the
 * parts of the shared verbs that must reach across branches, because a PR's
 * files live on the branch it proposes to merge (spec 03 §3.5).
 */

import {
  applyComment,
  bindReviewRevision,
  commitReport,
  continuePrMerge,
  countOpenPrsOnOtherRefs,
  currentAuthor,
  type EntityRecord,
  entityJson,
  executePrMerge,
  findEntity,
  listEntities,
  listPrsAcrossRefs,
  type MergeResult,
  type MergeReview,
  materializePrIfAbsent,
  type NewCommentInput,
  newCommentFile,
  newPrFile,
  openPr,
  parseListQuery,
  parsePerson,
  planPrMerge,
  preparePrOpen,
  type ReviewSummary,
  readReviewers,
  readReviewPolicy,
  requestReview,
  reviewSummary,
  sameEmail,
  stringField,
  toNdjson,
  updatePr,
  type Verdict,
  validateComment,
  validatePr,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { askYesNo, isInteractive } from "../prompt.ts";
import { composeFile } from "./compose.ts";
import {
  type CloseOptions,
  cmdClose,
  type ExtraColumn,
  type GlobalFlags,
  type ListOptions,
  reportList,
} from "./entity.ts";
import { describeShortfall, mergeAction, warnPolicyProblems } from "./policy.ts";

/* --------------------------------------------------------------------- open */

export interface PrOpenOptions extends GlobalFlags {
  target?: string;
  title?: string;
  message?: string;
  draft?: boolean;
  label?: string[];
  assignee?: string[];
  reviewer?: string[];
  milestone?: string;
  feature?: string[];
}

export function cmdPrOpen(ctx: Ctx, opts: PrOpenOptions): void {
  const draft = preparePrOpen(ctx, { target: opts.target, title: opts.title });

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_PR.md",
    noun: "pull request",
    render: (body) =>
      newPrFile({
        title: draft.title,
        author: currentAuthor(ctx),
        created: draft.created,
        target: draft.target,
        source: draft.source,
        revisions: [draft.revision],
        body,
        draft: opts.draft,
        reviewers: opts.reviewer,
        labels: opts.label,
        assignee: opts.assignee,
        milestone: opts.milestone,
        features: opts.feature,
      }),
    validate: validatePr,
  });

  const { id, dirPath, run } = openPr(
    ctx,
    { content: composed.content, fallbackTitle: draft.title },
    { commit: opts.commit },
  );

  ctx.stdout.write(`Created ${ctx.navDir}/${dirPath}/  (#${id})\n`);
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

/* ------------------------------------------------------------------ request */

export interface RequestOptions extends GlobalFlags {
  remove?: boolean;
}

export function cmdPrRequest(
  ctx: Ctx,
  prefix: string,
  people: string[],
  opts: RequestOptions,
): void {
  const { entity, changed, unchanged, run } = requestReview(ctx, prefix, people, {
    commit: opts.commit,
    remove: opts.remove,
  });

  const verb = opts.remove ? "No longer reviewing" : "Asked to review";
  ctx.stdout.write(`${verb} #${entity.id}: ${changed.join(", ")}\n`);
  // Naming who was already there matters most when only some of a list moved:
  // the count alone would leave the caller counting names themselves.
  for (const person of unchanged) {
    ctx.stdout.write(
      `${ctx.colors.dim(opts.remove ? "not listed:" : "already listed:")} ${person}\n`,
    );
  }
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* ------------------------------------------------------------------- review */

export interface ReviewOptions extends GlobalFlags {
  approve?: boolean;
  requestChanges?: boolean;
  comment?: boolean;
  message?: string;
  revision?: string;
  file?: string;
  line?: string;
}

export function cmdPrReview(ctx: Ctx, prefix: string, opts: ReviewOptions): void {
  const entity = findEntity(ctx, "pr", prefix);
  const chosen = [opts.approve, opts.requestChanges, opts.comment].filter(Boolean).length;
  if (chosen > 1) {
    fail("choose one of --approve, --request-changes or --comment, not several");
  }

  const revision = bindReviewRevision(entity, opts.revision);
  if (opts.line && !opts.file) fail("--line needs --file");

  // This verb files reviews, so with no flag the verdict is the one that judges
  // nothing (spec 04 §4.3). The exception is an inline anchor: a note about one
  // line is discussion, and recording it as a review would say its author had
  // read the whole revision. `nav pr comment` remains the unbound comment.
  const verdict: Verdict | undefined = opts.approve
    ? "approve"
    : opts.requestChanges
      ? "request-changes"
      : opts.file === undefined || opts.comment
        ? "comment"
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
  ctx.stdout.write(`${label} #${entity.id}  ${ctx.navDir}/${path}  (#${id})\n`);
  if (isReview) ctx.stdout.write(`Bound to revision ${revision.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
  warnIfOwnVerdict(ctx, entity, verdict);
}

/**
 * Warn an author that their own verdict will not be counted.
 *
 * After the file is written, never instead of it: the review is a record of
 * what somebody said and it is never refused (spec 02 §2.7). What the warning
 * prevents is approving your own work and believing you moved the decision —
 * which is exactly what a repository allowing self-review did decide to let
 * you do, so it says nothing there.
 */
function warnIfOwnVerdict(ctx: Ctx, entity: EntityRecord, verdict: Verdict | undefined): void {
  if (verdict === undefined || verdict === "comment") return;
  const { policy } = readReviewPolicy(ctx);
  if (policy.selfReview) return;
  const author = parsePerson(stringField(entity, "author"))?.email;
  const mine = parsePerson(currentAuthor(ctx))?.email;
  if (!author || !mine || !sameEmail(author, mine)) return;
  ctx.stderr.write(
    `${ctx.colors.yellow("warning:")} #${entity.id} is your own pull request; ` +
      `this ${verdict} will not count toward its review\n`,
  );
}

/* --------------------------------------------------------------------- list */

export interface PrListOptions extends ListOptions {
  allRefs?: boolean;
}

export function cmdPrList(ctx: Ctx, terms: string[], opts: PrListOptions): void {
  const reading = readReviewPolicy(ctx);
  warnPolicyProblems(ctx, reading);

  // Read once per entity: the decision decides both whether the column appears
  // and what every row of it says, and each reading walks the comment files.
  const summaries = new Map<string, ReviewSummary>();
  const summaryOf = (entity: EntityRecord): ReviewSummary => {
    const cached = summaries.get(entity.id);
    if (cached) return cached;
    const summary = reviewSummary(entity, reading.policy);
    summaries.set(entity.id, summary);
    return summary;
  };

  const extraColumns: ExtraColumn[] = [
    { header: "target", value: (entity: EntityRecord) => stringField(entity, "target") },
    // Derived rather than stored (spec 02 §2.7), and shown only where there is
    // something to show: a listing of pull requests nobody was asked to review
    // says nothing about reviews.
    {
      header: "reviewer",
      value: (entity) => readReviewers(entity.fm).join(","),
      when: (entities) => entities.some((entity) => readReviewers(entity.fm).length > 0),
      flexible: true,
    },
    {
      header: "review",
      value: (entity) => summaryOf(entity).decision,
      when: (entities) => entities.some((entity) => summaryOf(entity).reviewers.length > 0),
    },
  ];
  const query = parseListQuery(ctx, terms, "pr");

  if (!opts.allRefs) {
    const here = listEntities(ctx, "pr", query);
    reportList(ctx, "pr", here, { ...opts, extraColumns });
    if (here.length === 0) hintOtherRefs(ctx, opts);
    return;
  }

  const matched = listPrsAcrossRefs(ctx, query);
  if (opts.json) {
    if (matched.length === 0) return;
    ctx.stdout.write(
      `${toNdjson(
        matched.map((entry) =>
          entityJson(ctx.navDir, entry.entity, { refs: entry.refs.map((ref) => ref.short) }),
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

/**
 * Point at `--all-refs` when this checkout has nothing to show and other
 * branches do.
 *
 * An open pull request's files live on its source branch (spec 03 §3.5), so a
 * listing run from the default branch — or from any worktree but the one the
 * work is on — is empty however many are in flight, and "No pull requests
 * match this query." reads as "there are none". The hint is a signpost, not a
 * listing: the count is all it says, the table still reports this branch and
 * this branch only, and it goes to stderr so a pipe sees the same bytes as
 * before.
 */
function hintOtherRefs(ctx: Ctx, opts: PrListOptions): void {
  if (opts.json) return;
  const count = countOpenPrsOnOtherRefs(ctx);
  if (count === 0) return;
  ctx.stderr.write(
    `${ctx.colors.dim(
      `${count} open pull ${count === 1 ? "request" : "requests"} on other branches; ` +
        "nav pr list --all-refs to see them",
    )}\n`,
  );
}

/* -------------------------------------------------------------------- merge */

export interface MergeOptions extends GlobalFlags {
  noFf?: boolean;
  continue?: boolean;
  /** Answer the review-policy question in advance. */
  yes?: boolean;
}

export function cmdPrMerge(ctx: Ctx, prefix: string | undefined, opts: MergeOptions): void {
  if (opts.continue) {
    const result = continuePrMerge(ctx, prefix);
    // A merge already under way: the moment to have asked has passed, so an
    // unmet policy is reported and nothing is put to the user.
    warnPolicyProblems(ctx, result.review.reading);
    const shortfall = declaredShortfall(result.review);
    if (shortfall) {
      ctx.stderr.write(
        `${ctx.colors.yellow("warning:")} #${result.entity.id} was merged with ${shortfall}\n`,
      );
    }
    reportMerge(ctx, result);
    return;
  }
  if (!prefix) fail("nav pr merge needs the ID of the pull request to merge");

  const plan = planPrMerge(ctx, prefix, { noFf: opts.noFf });
  warnPolicyProblems(ctx, plan.review.reading);
  confirmAgainstPolicy(ctx, plan.entity.id, plan.review, opts.yes === true);
  reportMerge(ctx, executePrMerge(ctx, plan));
}

/** What the pull request is short of, but only where a policy was declared. */
function declaredShortfall(review: MergeReview): string | null {
  return review.reading.declared ? describeShortfall(review.summary) : null;
}

/**
 * Say what a declared policy is missing, and ask before merging short of it.
 *
 * Never a refusal. `--yes` answers in advance, a run with no terminal says its
 * piece and carries on — a pipeline that stopped for a question nobody can
 * answer would be the gate spec 02 §2.7 forbids, arrived at by accident. What
 * exits 1 is the user answering no, which is their decision and not the tool's.
 */
function confirmAgainstPolicy(ctx: Ctx, id: string, review: MergeReview, assumeYes: boolean): void {
  const shortfall = declaredShortfall(review);
  if (shortfall === null) return;
  ctx.stdout.write(`#${id} has ${shortfall}\n`);

  switch (mergeAction({ shortfall, assumeYes, interactive: isInteractive(ctx) })) {
    case "proceed":
      return;
    case "warn-and-proceed":
      ctx.stderr.write(
        `${ctx.colors.yellow("warning:")} merging #${id} anyway; pass --yes to say so\n`,
      );
      return;
    case "ask":
      if (!askYesNo(ctx, "Merge anyway? [y/N] ")) fail(`#${id} was not merged`);
  }
}

function reportMerge(ctx: Ctx, result: MergeResult): void {
  ctx.stdout.write(`Merged #${result.entity.id}  ${ctx.navDir}/${result.dirPath}/\n`);
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
