/**
 * The tools, performed against the working tree — the same operations the
 * `nav` verbs perform, through the core the CLI is already running.
 *
 * Every write commits, as `--commit` would: the person has just approved a
 * specific change, and a change the assistant made but left staged would be
 * one more thing for them to finish by hand. A write to a pull request, or on
 * a branch, that this checkout does not have goes through the host's write
 * sites — the clean worktree that has the branch, or a temporary one — as
 * `nav pr comment -y` and `nav pr open --source -y` do; the approval already
 * given is the answer to the question those would ask.
 */

import type { CliPluginHost } from "@navbook/cli/plugin";
import type { EntityKind, EntityRecord, RunPlanResult, WsCtx } from "@navbook/core";
import { failure, makeReads } from "../shared/reads.ts";
import {
  substituteMeIn,
  type ToolArgs,
  type ToolExecutor,
  type ToolName,
  type ToolResult,
} from "../shared/tools.ts";

type Core = CliPluginHost["core"];
type Ctx = CliPluginHost["ctx"];

const COMMIT = { commit: true } as const;

export function makeCliExecutor(
  host: CliPluginHost,
  viewer: { person: string; email: string },
): ToolExecutor {
  const { core, ctx, ui } = host;
  const written = (
    run: RunPlanResult,
    summary: string,
    record: { kind: "issue" | "pr"; id: string },
    content: Record<string, unknown>,
  ): ToolResult => {
    const commit = { committed: run.committed, subject: run.subject, pushed: false };
    return { ok: true, content: { ...content, commit: run.subject }, summary, commit, record };
  };

  const handlers: { [N in ToolName]: (args: ToolArgs[N]) => ToolResult } = {
    ...makeReads(core, ctx, viewer.email),

    open_issue(args) {
      const { created } = core.prepareOpen(ctx);
      const parent = args.parent === undefined ? undefined : core.findParentIssue(ctx, args.parent);
      const content = core.newIssueFile({
        title: args.title,
        author: viewer.person,
        created,
        body: args.body,
        ...(args.labels ? { labels: args.labels } : {}),
        ...(args.assignees ? { assignee: substituteMeIn(args.assignees, viewer.person) } : {}),
        ...(args.milestone ? { milestone: args.milestone } : {}),
        ...(args.rank === undefined ? {} : { rank: args.rank }),
        ...(args.deadline ? { deadline: args.deadline } : {}),
        ...(parent ? { parent: parent.id } : {}),
      });
      validated(core, content, (parsed) => core.validateIssue(parsed, ctx.ext));
      const opened = core.openIssue(ctx, { content, fallbackTitle: args.title }, COMMIT);
      return written(
        opened.run,
        `opened #${opened.id}`,
        { kind: "issue", id: opened.id },
        {
          id: opened.id,
          path: `${ctx.navDir}/${opened.dirPath}`,
        },
      );
    },

    open_pr(args) {
      const open = (at: Ctx): ToolResult => {
        const draft = core.preparePrOpen(at, {
          ...(args.source ? { source: args.source } : {}),
          ...(args.target ? { target: args.target } : {}),
          title: args.title,
        });
        const content = core.newPrFile({
          title: draft.title,
          author: viewer.person,
          created: draft.created,
          body: args.body,
          target: draft.target,
          source: draft.source,
          revisions: [draft.revision],
          ...(args.draft ? { draft: true } : {}),
          ...(args.reviewers ? { reviewers: substituteMeIn(args.reviewers, viewer.person) } : {}),
          ...(args.labels ? { labels: args.labels } : {}),
          ...(args.assignees ? { assignee: substituteMeIn(args.assignees, viewer.person) } : {}),
          ...(args.milestone ? { milestone: args.milestone } : {}),
        });
        validated(core, content, (parsed) => core.validatePr(parsed, at.ext));
        const opened = core.openPr(at, { content, fallbackTitle: draft.title }, COMMIT);
        return written(
          opened.run,
          `opened #${opened.id}`,
          { kind: "pr", id: opened.id },
          {
            id: opened.id,
            source: draft.source,
            target: draft.target,
          },
        );
      };
      return args.source === undefined
        ? open(ctx)
        : ui.withBranchWriteSite(args.source, { assumeYes: true }, open);
    },

    review_pr(args) {
      return commentOn("pr", args.ref, args.body, undefined, args.verdict);
    },

    comment(args) {
      return commentOn(args.kind, args.ref, args.body, args.reply_to);
    },

    close_issue(args) {
      const closed = core.closeEntity(
        ctx,
        "issue",
        args.ref,
        {
          ...(args.resolution ? { resolution: args.resolution } : {}),
          ...(args.duplicate_of ? { duplicateOf: args.duplicate_of } : {}),
        },
        COMMIT,
      );
      return written(
        closed.run,
        `closed #${closed.entity.id}`,
        { kind: "issue", id: closed.entity.id },
        {
          id: closed.entity.id,
          status: "closed",
        },
      );
    },

    reopen_issue(args) {
      const reopened = core.reopenEntity(ctx, "issue", args.ref, COMMIT);
      return written(
        reopened.run,
        `reopened #${reopened.entity.id}`,
        { kind: "issue", id: reopened.entity.id },
        {
          id: reopened.entity.id,
          status: "open",
        },
      );
    },
  };

  /** A comment, or with a verdict a review, written beside the record where it lives. */
  function commentOn(
    kind: EntityKind,
    ref: string,
    body: string,
    replyTo?: string,
    verdict?: ToolArgs["review_pr"]["verdict"],
  ): ToolResult {
    const write = (at: WsCtx, entity: EntityRecord): ToolResult => {
      const reply = replyTo === undefined ? undefined : core.resolveComment(entity, replyTo);
      const content = core.newCommentFile({
        author: viewer.person,
        body,
        ...(reply ? { replyTo: reply } : {}),
        ...(verdict ? { verdict, revision: core.bindReviewRevision(entity) } : {}),
      });
      validated(core, content, (parsed) => core.validateComment(parsed, { onPr: kind === "pr" }));
      const added = core.applyComment(
        at,
        entity,
        { content, review: verdict !== undefined },
        COMMIT,
      );
      return written(
        added.run,
        `${verdict ? "reviewed" : "commented on"} #${entity.id}`,
        { kind: kind === "pr" ? "pr" : "issue", id: entity.id },
        { comment: added.id, on: entity.id },
      );
    };
    if (kind === "issue") return write(ctx, core.findEntity(ctx, "issue", ref));
    return ui.withPrWriteSite(ref, { assumeYes: true }, write);
  }

  return {
    async execute(name, args) {
      try {
        return (handlers[name] as (args: ToolArgs[typeof name]) => ToolResult)(args);
      } catch (error) {
        return failure(core, error);
      }
    },
  };
}

/** Refuse a composed file the format would not accept, before anything is written. */
function validated(
  core: Core,
  content: string,
  validate: (parsed: ReturnType<Core["parseFile"]>) => { message: string }[],
): void {
  const problems = validate(core.parseFile(content));
  if (problems.length > 0) {
    throw new core.WorkspaceError(
      "invalid-input",
      problems.map((problem) => problem.message).join("; "),
    );
  }
}
