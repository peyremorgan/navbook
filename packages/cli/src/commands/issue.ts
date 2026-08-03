/**
 * `nav issue <verb>` — spec 04 §4.3.
 */

import {
  commitReport,
  currentAuthor,
  NAVBOOK_ROOT,
  newIssueFile,
  openIssue,
  prepareOpen,
  validateIssue,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { composeFile } from "./compose.ts";
import type { GlobalFlags } from "./entity.ts";

export interface IssueOpenOptions extends GlobalFlags {
  message?: string;
  label?: string[];
  assignee?: string[];
  milestone?: string;
}

export function cmdIssueOpen(ctx: Ctx, title: string, opts: IssueOpenOptions): void {
  if (title.trim() === "") fail("an issue needs a title");
  const { created } = prepareOpen(ctx);

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

  const { id, dirPath, run } = openIssue(
    ctx,
    { content: composed.content, fallbackTitle: title },
    { commit: opts.commit },
  );

  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/${dirPath}/  (#${id})\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}
