/**
 * Command tree — spec 04 §4.3: noun-verb, with one verb vocabulary shared by
 * both entity kinds, plus root-level utilities.
 */

import { Command, Option } from "commander";
import type { EntityKind } from "../core/tree.ts";
import {
  cmdClose,
  cmdComment,
  cmdEdit,
  cmdList,
  cmdReopen,
  cmdShow,
  type ExtraColumn,
} from "./commands/entity.ts";
import { cmdId, cmdInit } from "./commands/init.ts";
import { cmdIssueOpen } from "./commands/issue.ts";
import type { Ctx } from "./context.ts";

export const VERSION = "0.1.0";

const QUERY_HELP = `Query terms AND together. Terms:
  status:open|closed|merged   entity status (path); 'merged' is PR-only
  label:L                     L is among the entity's labels (repeatable, ANDs)
  assignee:EMAIL              assignee address, or a fragment of its domain
  author:EMAIL                author address, same matching
  milestone:M                 exact milestone
  WORD or "some phrase"       case-insensitive substring of the title,
                              description, or any comment body
Same-key terms OR for single-valued fields (status, author, milestone) and AND
for multi-valued ones (label, assignee). The default query is status:open.`;

export function buildProgram(getCtx: () => Ctx): Command {
  const program = new Command();
  program
    .name("nav")
    .description("Git-native issue and pull-request tracking, stored as files in your repository")
    .version(VERSION, "-V, --version")
    .showHelpAfterError()
    .enablePositionalOptions();

  program
    .command("init")
    .description("create the .navbook/ skeleton at the repository root")
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((opts) => cmdInit(getCtx(), opts));

  program
    .command("id")
    .description("mint and print a fresh Navbook ID")
    .option("-n, --count <n>", "how many IDs to print", (value) => Number.parseInt(value, 10), 1)
    .action((opts) => cmdId(getCtx(), opts));

  program.addCommand(buildIssueCommand(getCtx));
  return program;
}

function buildIssueCommand(getCtx: () => Ctx): Command {
  const issue = new Command("issue").description("work with issues");

  issue
    .command("open")
    .argument("<title>", "one-line summary")
    .description("file a new issue")
    .option("-m, --message <text>", "description text; without it $EDITOR is opened")
    .option("--label <label>", "add a label (repeatable)", collect, [])
    .option("--assignee <email>", "assign to a person (repeatable)", collect, [])
    .option("--milestone <name>", "milestone")
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((title, opts) => cmdIssueOpen(getCtx(), title, opts));

  addSharedVerbs(issue, "issue", getCtx, []);
  return issue;
}

/** Register the verbs both nouns share, so their behavior can never drift. */
export function addSharedVerbs(
  parent: Command,
  kind: EntityKind,
  getCtx: () => Ctx,
  extraColumns: ExtraColumn[],
): void {
  const noun = kind === "issue" ? "issue" : "pull request";

  parent
    .command("list")
    .argument("[query...]", "query terms; default status:open")
    .description(`list ${kind === "issue" ? "issues" : "pull requests"} matching a query`)
    .addHelpText("after", `\n${QUERY_HELP}`)
    .option("--json", "one JSON object per entity, newline-delimited")
    .action((terms: string[], opts) => cmdList(getCtx(), kind, terms, { ...opts, extraColumns }));

  parent
    .command("show")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`render one ${noun} and its comments`)
    .option("--json", "emit a single JSON object including comments")
    .action((id: string, opts) => cmdShow(getCtx(), kind, id, opts));

  parent
    .command("edit")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`open the ${noun}'s file in $EDITOR`)
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((id: string, opts) => cmdEdit(getCtx(), kind, id, opts));

  parent
    .command("comment")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`add a comment to a ${noun}`)
    .option("-m, --message <text>", "comment text; without it $EDITOR is opened")
    .option("--reply-to <comment-id>", "comment this one replies to")
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((id: string, opts) => cmdComment(getCtx(), kind, id, opts));

  parent
    .command("close")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`move the ${noun} to closed/`)
    .option("--resolution <value>", "why it was closed, e.g. fixed, wontfix, duplicate")
    .option("--duplicate-of <id>", "the entity this duplicates (implies duplicate)")
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((id: string, opts) =>
      cmdClose(getCtx(), kind, id, {
        ...opts,
        duplicateOf: opts.duplicateOf,
      }),
    );

  parent
    .command("reopen")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`move the ${noun} back to open/ and clear its resolution`)
    .option("--commit", "wrap the change in an 'nb:' commit")
    .action((id: string, opts) => cmdReopen(getCtx(), kind, id, opts));
}

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export { Option };
