/**
 * `nav issue <verb>` — spec 04 §4.3.
 */

import { newIssueFile, validateIssue } from "../../core/files.ts";
import { NAVBOOK_ROOT } from "../../core/json.ts";
import { planEntityOpen } from "../../core/ops.ts";
import { allIds } from "../../core/tree.ts";
import { commitReport, runPlan } from "../commit-flow.ts";
import { type Ctx, nowIso } from "../context.ts";
import { fail } from "../errors.ts";
import { loadRepo } from "../workspace.ts";
import { composeFile } from "./compose.ts";
import { currentAuthor, type GlobalFlags } from "./entity.ts";

export interface IssueOpenOptions extends GlobalFlags {
  message?: string;
  label?: string[];
  assignee?: string[];
  milestone?: string;
}

export function cmdIssueOpen(ctx: Ctx, title: string, opts: IssueOpenOptions): void {
  if (title.trim() === "") fail("an issue needs a title");
  const repo = loadRepo(ctx, { includeComments: false });
  const created = nowIso(ctx);

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_ISSUE.md",
    noun: "issue",
    render: (body) =>
      newIssueFile({
        title,
        author: currentAuthor(ctx),
        created,
        body,
        labels: opts.label,
        assignee: opts.assignee,
        milestone: opts.milestone,
      }),
    validate: validateIssue,
  });

  // A title edited in the buffer decides the slug, so read it back.
  const finalTitle =
    typeof composed.parsed.fm.title === "string" ? composed.parsed.fm.title : title;
  const id = ctx.mintId(new Set(allIds(repo).map((entry) => entry.id)));
  const { plan, dirPath } = planEntityOpen("issue", id, finalTitle, composed.content);

  runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/${dirPath}/  (#${id})\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}
