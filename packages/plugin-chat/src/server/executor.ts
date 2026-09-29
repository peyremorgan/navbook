/**
 * The tools, performed by the server as the signed-in person.
 *
 * Reads go through core inside the sync engine's read transaction, exactly as
 * the CLI's do, so a query means the same thing in both places. Writes go
 * through the server's own mutations (`host.api.execute`): the same composing,
 * validation, write site, commit, push and mutation event as a client's
 * request, and the same error codes — nothing here re-implements a write.
 */

import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { failure, makeReads } from "../shared/reads.ts";
import {
  type CommitSummary,
  substituteMeIn,
  type ToolArgs,
  type ToolExecutor,
  type ToolName,
  type ToolResult,
} from "../shared/tools.ts";

const COMMIT = "commit { committed subject pushed }";

/** The mutation each write runs, and how its payload reads back. */
const WRITES = {
  open_issue: `mutation ChatOpenIssue($input: OpenIssueInput!) {
    openIssue(input: $input) { issue { id } ${COMMIT} }
  }`,
  open_pr: `mutation ChatOpenPr($input: OpenPrInput!) {
    openPr(input: $input) { pr { id source target } ${COMMIT} }
  }`,
  add_comment: `mutation ChatComment($input: AddCommentInput!) {
    addComment(input: $input) { comment { id } entity { id } ${COMMIT} }
  }`,
  close_issue: `mutation ChatCloseIssue($input: CloseIssueInput!) {
    closeIssue(input: $input) { issue { id } ${COMMIT} }
  }`,
  reopen_issue: `mutation ChatReopenIssue($ref: ID!) {
    reopenIssue(ref: $ref) { issue { id } ${COMMIT} }
  }`,
} as const;

const VERDICTS = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  comment: "COMMENT",
} as const;

export function makeServerExecutor(host: ServerPluginHost, ctx: GraphQLCtx): ToolExecutor {
  const { core } = host;
  const person = core.currentAuthor(ctx.ws);
  const email = ctx.viewer.email;

  /** Run one mutation; its payload's first field, or the error it was refused with. */
  async function mutate(
    document: string,
    variables: Record<string, unknown>,
  ): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; result: ToolResult }> {
    const result = await host.api.execute(ctx, document, variables);
    if (result.errors && result.errors.length > 0) {
      const [error] = result.errors;
      const extensions = (error?.extensions ?? {}) as { code?: unknown; details?: unknown };
      const details = Array.isArray(extensions.details)
        ? extensions.details.filter((line): line is string => typeof line === "string")
        : [];
      const message = error?.message ?? "the operation failed";
      return {
        ok: false,
        result: {
          ok: false,
          content: {
            error: [message, ...details].join("\n"),
            ...(typeof extensions.code === "string" ? { code: extensions.code } : {}),
          },
          summary: message,
        },
      };
    }
    const data = (result.data ?? {}) as Record<string, Record<string, unknown>>;
    const payload = Object.values(data)[0];
    if (!payload)
      return { ok: false, result: failure(core, new Error("the operation returned nothing")) };
    return { ok: true, payload };
  }

  function written(
    payload: Record<string, unknown>,
    record: { kind: "issue" | "pr"; id: string },
    summary: string,
    content: Record<string, unknown>,
  ): ToolResult {
    const commit = payload.commit as CommitSummary;
    return {
      ok: true,
      content: { ...content, commit: commit.subject, pushed: commit.pushed },
      summary: commit.pushed ? summary : `${summary}, not pushed`,
      commit: { committed: commit.committed, subject: commit.subject, pushed: commit.pushed },
      record,
    };
  }

  const people = (list: string[] | undefined): string[] | undefined => substituteMeIn(list, person);

  const writes: {
    [N in Exclude<ToolName, "list_issues" | "list_prs" | "show">]: (
      args: ToolArgs[N],
    ) => Promise<ToolResult>;
  } = {
    async open_issue(args) {
      const done = await mutate(WRITES.open_issue, {
        input: {
          title: args.title,
          body: args.body,
          ...(args.labels ? { labels: args.labels } : {}),
          ...(args.assignees ? { assignees: people(args.assignees) } : {}),
          ...(args.milestone ? { milestone: args.milestone } : {}),
          ...(args.rank === undefined ? {} : { rank: args.rank }),
          ...(args.deadline ? { deadline: args.deadline } : {}),
          ...(args.parent ? { parent: args.parent } : {}),
        },
      });
      if (!done.ok) return done.result;
      const id = (done.payload.issue as { id: string }).id;
      return written(done.payload, { kind: "issue", id }, `opened #${id}`, { id });
    },

    async open_pr(args) {
      if (!args.source) {
        return {
          ok: false,
          content: {
            error:
              "name the branch carrying the work in `source`; ask the person if you do not know it",
          },
          summary: "no source branch",
        };
      }
      const done = await mutate(WRITES.open_pr, {
        input: {
          source: args.source,
          title: args.title,
          body: args.body,
          ...(args.target ? { target: args.target } : {}),
          ...(args.draft ? { draft: true } : {}),
          ...(args.reviewers ? { reviewers: people(args.reviewers) } : {}),
          ...(args.labels ? { labels: args.labels } : {}),
          ...(args.assignees ? { assignees: people(args.assignees) } : {}),
          ...(args.milestone ? { milestone: args.milestone } : {}),
        },
      });
      if (!done.ok) return done.result;
      const pr = done.payload.pr as {
        entity?: unknown;
        id: string;
        source: string;
        target: string;
      };
      return written(done.payload, { kind: "pr", id: pr.id }, `opened #${pr.id}`, {
        id: pr.id,
        source: pr.source,
        target: pr.target,
      });
    },

    review_pr(args) {
      return comment("pr", args.ref, args.body, undefined, VERDICTS[args.verdict]);
    },

    comment(args) {
      return comment(args.kind, args.ref, args.body, args.reply_to);
    },

    async close_issue(args) {
      const done = await mutate(WRITES.close_issue, {
        input: {
          ref: args.ref,
          ...(args.resolution ? { resolution: args.resolution } : {}),
          ...(args.duplicate_of ? { duplicateOf: args.duplicate_of } : {}),
        },
      });
      if (!done.ok) return done.result;
      const id = (done.payload.issue as { id: string }).id;
      return written(done.payload, { kind: "issue", id }, `closed #${id}`, {
        id,
        status: "closed",
      });
    },

    async reopen_issue(args) {
      const done = await mutate(WRITES.reopen_issue, { ref: args.ref });
      if (!done.ok) return done.result;
      const id = (done.payload.issue as { id: string }).id;
      return written(done.payload, { kind: "issue", id }, `reopened #${id}`, {
        id,
        status: "open",
      });
    },
  };

  async function comment(
    kind: "issue" | "pr",
    ref: string,
    body: string,
    replyTo?: string,
    verdict?: string,
  ): Promise<ToolResult> {
    const done = await mutate(WRITES.add_comment, {
      input: {
        kind: kind === "pr" ? "PR" : "ISSUE",
        ref,
        body,
        ...(replyTo ? { replyTo } : {}),
        ...(verdict ? { verdict } : {}),
      },
    });
    if (!done.ok) return done.result;
    const on = (done.payload.entity as { id: string }).id;
    const id = (done.payload.comment as { id: string }).id;
    return written(
      done.payload,
      { kind, id: on },
      `${verdict ? "reviewed" : "commented on"} #${on}`,
      {
        comment: id,
        on,
      },
    );
  }

  return {
    async execute(name, args) {
      try {
        if (name === "list_issues" || name === "list_prs" || name === "show") {
          const reads = makeReads(core, ctx.ws, email);
          const read = (reads as unknown as Record<string, (args: unknown) => ToolResult>)[name];
          if (read === undefined) throw new Error(`no such tool: ${name}`);
          return await ctx.sync.read(() => read(args));
        }
        const write = (writes as Record<string, (args: unknown) => Promise<ToolResult>>)[name];
        if (write === undefined) throw new Error(`no such tool: ${name}`);
        return await write(args);
      } catch (error) {
        return failure(core, error);
      }
    },
  };
}
