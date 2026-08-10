/**
 * `nav issue <verb>` — spec 04 §4.3.
 */

import {
  commitReport,
  currentAuthor,
  executeIssueLink,
  findParentIssue,
  NAVBOOK_ROOT,
  newIssueFile,
  openIssue,
  planIssueLink,
  prepareOpen,
  unlinkIssue,
  validateIssue,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { askYesNo } from "../prompt.ts";
import { composeFile } from "./compose.ts";
import type { GlobalFlags } from "./entity.ts";

export interface IssueOpenOptions extends GlobalFlags {
  message?: string;
  label?: string[];
  assignee?: string[];
  milestone?: string;
  parent?: string;
}

export function cmdIssueOpen(ctx: Ctx, title: string, opts: IssueOpenOptions): void {
  if (title.trim() === "") fail("an issue needs a title");
  const { created } = prepareOpen(ctx);
  // Resolved before anything is composed: being told the parent does not exist
  // is worth much more before an editor has been filled in than after.
  const parent = opts.parent === undefined ? undefined : findParentIssue(ctx, opts.parent);

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
        parent: parent?.id,
      }),
    validate: validateIssue,
  });

  const result = openIssue(
    ctx,
    { content: composed.content, fallbackTitle: title },
    { commit: opts.commit },
  );
  const { id, dirPath, run } = result;

  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/${dirPath}/  (#${id})\n`);
  // What the file ended up saying, which an editor session may have changed.
  if (result.parent) {
    ctx.stdout.write(`Filed under #${result.parent.id}  ${result.parent.title}\n`);
  }
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* --------------------------------------------------------------- link */

export interface IssueLinkOptions extends GlobalFlags {
  parent: string;
  force?: boolean;
}

/**
 * File one issue under another — spec 04 §4.3.
 *
 * An issue that already has a parent is being moved, not merely linked, and
 * that changes a structure somebody else may be reading, so it is confirmed
 * first. As everywhere else, an unanswerable question counts as "no".
 */
export function cmdIssueLink(ctx: Ctx, prefix: string, opts: IssueLinkOptions): void {
  const link = planIssueLink(ctx, prefix, opts.parent, { commit: opts.commit });
  const { child, parent, previousParentId, previousParent } = link;

  if (previousParentId !== undefined && !opts.force) {
    const from = previousParent
      ? `#${previousParent.id}  ${previousParent.title}`
      : `#${previousParentId} (not in this tree)`;
    ctx.stdout.write(`#${child.id} is already a subtask of ${from}\n`);
    if (!askYesNo(ctx, `Move it under #${parent.id} instead? [y/N] `)) {
      fail(`#${child.id} was not moved`);
    }
  }

  const run = executeIssueLink(ctx, link, { commit: opts.commit });
  ctx.stdout.write(`Filed #${child.id} under #${parent.id}  ${parent.title}\n`);
  // An issue that was claiming the subtask without its agreement stops here,
  // and nothing else in the run would have told the user that happened.
  for (const lister of link.unexpectedListers) {
    ctx.stdout.write(`Removed #${child.id} from the subtasks of #${lister.id}  ${lister.title}\n`);
  }
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

export function cmdIssueUnlink(ctx: Ctx, prefix: string, opts: GlobalFlags): void {
  const { child, parentId, run } = unlinkIssue(ctx, prefix, { commit: opts.commit });
  ctx.stdout.write(
    parentId === undefined
      ? `Unlinked #${child.id}\n`
      : `Unlinked #${child.id} from #${parentId}\n`,
  );
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}
