/**
 * The reading tools, performed with core against a workspace.
 *
 * The same for both front ends: the CLI reads its checkout, the server its
 * clone (inside `sync.read`, so the tree is up to date and held still). Both
 * then answer a query exactly as `nav issue list` does, with the same grammar
 * and the same plugin terms, because it is the same function.
 */

import type * as NavbookCore from "@navbook/core";
import type { CommentRecord, EntityRecord, WsCtx } from "@navbook/core";
import {
  type CommentView,
  counted,
  detail,
  type IssueRow,
  mergePrRows,
  type PrRow,
  page,
} from "./rows.ts";
import { LIST_LIMIT, substituteMe, type ToolArgs, type ToolResult } from "./tools.ts";

type Core = typeof NavbookCore;

export interface Reads {
  list_issues(args: ToolArgs["list_issues"]): ToolResult;
  list_prs(args: ToolArgs["list_prs"]): ToolResult;
  show(args: ToolArgs["show"]): ToolResult;
}

/** The reading tools over `ws`, with `me` standing for `email`. */
export function makeReads(core: Core, ws: WsCtx, email: string): Reads {
  let policyMemo: ReturnType<Core["readReviewPolicy"]>["policy"] | null = null;
  const policy = (): ReturnType<Core["readReviewPolicy"]>["policy"] =>
    (policyMemo ??= core.readReviewPolicy(ws).policy);

  const issueRow = (entity: EntityRecord): IssueRow => ({
    id: entity.id,
    title: entity.title,
    status: entity.status,
    labels: core.readLabels(entity.fm),
    assignees: core.readAssignees(entity.fm),
    milestone: stringField(entity.fm.milestone),
    deadline: core.readDeadline(entity.fm),
    rank: core.readRank(entity.fm),
    parent: core.readParent(entity.fm),
    author: stringField(entity.fm.author) ?? "",
    created: stringField(entity.fm.created) ?? "",
  });

  const prRow = (entity: EntityRecord): PrRow => ({
    id: entity.id,
    title: entity.title,
    status: entity.status,
    source: stringField(entity.fm.source),
    target: stringField(entity.fm.target) ?? "",
    draft: entity.fm.draft === true,
    reviewers: core.readReviewers(entity.fm),
    review: core.reviewSummary(core.withComments(ws, entity), policy()).decision,
    labels: core.readLabels(entity.fm),
    assignees: core.readAssignees(entity.fm),
    milestone: stringField(entity.fm.milestone),
    author: stringField(entity.fm.author) ?? "",
    created: stringField(entity.fm.created) ?? "",
  });

  const comments = (entity: EntityRecord): CommentView[] =>
    core.withComments(ws, entity).comments.map((comment: CommentRecord) => ({
      id: comment.id,
      author: comment.author,
      created: comment.stamp,
      ...(typeof comment.parsed.fm.verdict === "string"
        ? { verdict: comment.parsed.fm.verdict }
        : {}),
      ...(comment.replyTo ? { reply_to: comment.replyTo } : {}),
      body: comment.body,
    }));

  return {
    list_issues(args) {
      const query = core.parseListQuery(ws, substituteMe(args.query ?? [], email), "issue");
      const listed = page(
        core.listEntities(ws, "issue", query).map(issueRow),
        args.limit ?? LIST_LIMIT,
      );
      return { ok: true, content: listed, summary: counted(listed.count, "issue") };
    },

    list_prs(args) {
      const query = core.parseListQuery(ws, substituteMe(args.query ?? [], email), "pr");
      const here = core.listEntities(ws, "pr", query).map(prRow);
      const scanned = core.listPrsAcrossRefs(ws, query).map((found) => prRow(found.entity));
      const listed = page(mergePrRows(here, scanned), args.limit ?? LIST_LIMIT);
      return { ok: true, content: listed, summary: counted(listed.count, "pull request") };
    },

    show(args) {
      if (args.kind === "issue") {
        const entity = core.findEntity(ws, "issue", args.ref);
        return {
          ok: true,
          content: {
            ...detail(issueRow(entity), entity.body, comments(entity)),
            subtasks: core.readSubtasks(entity.fm),
            resolution: stringField(entity.fm.resolution),
          },
          summary: `#${entity.id} ${entity.title}`,
        };
      }
      const { entity, ref } = core.readPr(ws, args.ref);
      const summary = core.reviewSummary(core.withComments(ws, entity), policy());
      return {
        ok: true,
        content: {
          ...detail(prRow(entity), entity.body, comments(entity)),
          found_on: ref,
          revisions: core.readRevisions(entity.fm).length,
          reviewer_states: summary.reviewers.map((state) => ({
            person: state.person,
            state: state.state,
          })),
          approvals: summary.approvals,
        },
        summary: `#${entity.id} ${entity.title}`,
      };
    },
  };
}

export function stringField(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A failure as the model reads it: core's own message and details, which are
 * written for people and say what to do.
 */
export function failure(core: Core, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof core.WorkspaceError ? error.code : undefined;
  // Core's refusals and the CLI's own (`NavError`) both carry detail lines.
  const details = (error as { details?: unknown }).details;
  const lines = Array.isArray(details) ? details.filter((line) => typeof line === "string") : [];
  return {
    ok: false,
    content: { error: [message, ...lines].join("\n"), ...(code ? { code } : {}) },
    summary: message,
  };
}
