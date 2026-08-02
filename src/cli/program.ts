/**
 * Command tree — spec 04 §4.3: noun-verb, with one verb vocabulary shared by
 * both entity kinds, plus root-level utilities.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import type { EntityKind } from "../core/tree.ts";
import { cmdComplete } from "./commands/complete.ts";
import { cmdDoctor } from "./commands/doctor.ts";
import {
  type CloseOptions,
  cmdClose,
  cmdComment,
  cmdEdit,
  cmdList,
  cmdReopen,
  cmdShow,
  type ExtraColumn,
} from "./commands/entity.ts";
import { cmdId, cmdInit } from "./commands/init.ts";
import { cmdInstall, cmdUninstall } from "./commands/install.ts";
import { cmdIssueOpen } from "./commands/issue.ts";
import {
  cmdPrClose,
  cmdPrList,
  cmdPrMerge,
  cmdPrOpen,
  cmdPrReview,
  cmdPrUpdate,
} from "./commands/pr.ts";
import type { Ctx } from "./context.ts";

/**
 * Read straight from package.json rather than duplicating the version as a
 * literal: a hardcoded copy silently drifts the moment a release is cut
 * without updating both places (which is exactly what shipped as 0.1.1).
 * `../../package.json` is the package root from both `src/cli/` in dev and
 * `dist/cli/` after the build — the same relative depth either way.
 */
function readOwnVersion(): string {
  const path = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { version: string };
  return pkg.version;
}

export const VERSION = readOwnVersion();

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

/** Help for `--commit`, naming the subject the verb commits under (spec 03 §3.2). */
function commitHelp(kind?: EntityKind): string {
  return `wrap the change in a 'docs${kind ? `(${kind})` : ""}:' commit`;
}

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
    .option("--commit", commitHelp())
    .action((opts) => cmdInit(getCtx(), opts));

  program
    .command("id")
    .description("mint and print a fresh Navbook ID")
    .option("-n, --count <n>", "how many IDs to print", (value) => Number.parseInt(value, 10), 1)
    .action((opts) => cmdId(getCtx(), opts));

  program
    .command("doctor")
    .description("check the tree against the specification")
    .option("--staged", "check only what is staged in the index (used by the pre-commit hook)")
    .option("--fix", "apply the mechanical repairs offered by the diagnostics")
    .option("--json", "one JSON object per diagnostic, newline-delimited")
    .action((opts) => cmdDoctor(getCtx(), opts));

  program
    .command("install")
    .description("set up the git alias, merge config, pre-commit hook and completions")
    .addOption(new Option("--alias [name]", "git alias name (default: nav)"))
    .option("--hooks", "install the pre-commit hook")
    .addOption(new Option("--completions [shell]", "bash, zsh or fish (default: $SHELL)"))
    .option("--merge-config", "set merge.directoryRenames=true in this repository")
    .option("-y, --yes", "do not ask for confirmation")
    .action((opts) => cmdInstall(getCtx(), opts));

  program
    .command("uninstall")
    .description("remove what nav install set up")
    .addOption(new Option("--alias [name]", "git alias name (default: nav)"))
    .option("--hooks", "remove the pre-commit hook block")
    .addOption(new Option("--completions [shell]", "bash, zsh or fish (default: $SHELL)"))
    .option("--merge-config", "unset merge.directoryRenames")
    .option("-y, --yes", "do not ask for confirmation")
    .action((opts) => cmdUninstall(getCtx(), opts));

  program
    .command("__complete", { hidden: true })
    .description("internal: print completion candidates for the words typed so far")
    .argument("[words...]")
    .action((words: string[]) => cmdComplete(getCtx(), words));

  program.addCommand(buildIssueCommand(getCtx));
  program.addCommand(buildPrCommand(getCtx));
  return program;
}

function buildPrCommand(getCtx: () => Ctx): Command {
  const pr = new Command("pr").description("work with pull requests");

  pr.command("open")
    .description("open a pull request from the current branch")
    .option("--target <branch>", "branch to merge into (default: the repository's default branch)")
    .option("--title <text>", "one-line summary (default: the last commit's subject)")
    .option("-m, --message <text>", "description text; without it $EDITOR is opened")
    .option("--draft", "not yet requesting review")
    .option("--label <label>", "add a label (repeatable)", collect, [])
    .option("--assignee <email>", "assign to a person (repeatable)", collect, [])
    .option("--milestone <name>", "milestone")
    .option("--commit", commitHelp("pr"))
    .action((opts) => cmdPrOpen(getCtx(), opts));

  pr.command("update")
    .argument("<id>", "ID or unambiguous prefix")
    .description("append a revision pinning the current HEAD")
    .option("--commit", commitHelp("pr"))
    .action((id: string, opts) => cmdPrUpdate(getCtx(), id, opts));

  pr.command("review")
    .argument("<id>", "ID or unambiguous prefix")
    .description("review a pull request, bound to a specific revision")
    .option("--approve", "record an approving verdict")
    .option("--request-changes", "record a request-changes verdict")
    .option("-m, --message <text>", "review text; without it $EDITOR is opened")
    .option("--revision <sha>", "bind to this revision instead of the latest")
    .option("--file <path>", "anchor the comment to a file")
    .option("--line <n|start-end>", "anchor the comment to a line or range")
    .option("--commit", commitHelp("pr"))
    .action((id: string, opts) => cmdPrReview(getCtx(), id, opts));

  pr.command("merge")
    .argument("[id]", "ID or unambiguous prefix")
    .description("merge a pull request into the checked-out target branch")
    .option("--no-ff", "always create a merge commit")
    .option("--continue", "finish a merge that stopped for conflict resolution")
    // Commander models `--no-ff` as the negation of an implicit `--ff`.
    .action((id: string | undefined, opts) =>
      cmdPrMerge(getCtx(), id, { ...opts, noFf: opts.ff === false }),
    );

  addSharedVerbs(pr, "pr", getCtx, {
    extraColumns: [{ header: "target", value: (entity) => stringOf(entity, "target") }],
    runClose: (ctx, id, options) => cmdPrClose(ctx, id, options),
    configureList: (command) => {
      command.option("--all-refs", "scan all local and fetched remote branches, not just this one");
    },
    runList: (ctx, terms, options) => cmdPrList(ctx, terms, options),
  });
  return pr;
}

function stringOf(entity: { fm: Record<string, unknown> }, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
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
    .option("--commit", commitHelp("issue"))
    .action((title, opts) => cmdIssueOpen(getCtx(), title, opts));

  addSharedVerbs(issue, "issue", getCtx, { extraColumns: [] });
  return issue;
}

export interface SharedVerbOptions {
  extraColumns: ExtraColumn[];
  /** Extra options the noun's `list` accepts, e.g. `--all-refs` for PRs. */
  configureList?: (command: Command) => void;
  /** Listing implementation, when the noun needs more than the shared one. */
  runList?: (ctx: Ctx, terms: string[], options: Record<string, unknown>) => void;
  /** Close implementation, when the noun needs more than the shared one. */
  runClose?: (ctx: Ctx, id: string, options: CloseOptions) => void;
}

/** Register the verbs both nouns share, so their behavior can never drift. */
export function addSharedVerbs(
  parent: Command,
  kind: EntityKind,
  getCtx: () => Ctx,
  shared: SharedVerbOptions,
): void {
  const noun = kind === "issue" ? "issue" : "pull request";
  const { extraColumns } = shared;

  const list = parent
    .command("list")
    .argument("[query...]", "query terms; default status:open")
    .description(`list ${kind === "issue" ? "issues" : "pull requests"} matching a query`)
    .addHelpText("after", `\n${QUERY_HELP}`)
    .option("--json", "one JSON object per entity, newline-delimited");
  shared.configureList?.(list);
  list.action((terms: string[], opts) =>
    shared.runList
      ? shared.runList(getCtx(), terms, { ...opts, extraColumns })
      : cmdList(getCtx(), kind, terms, { ...opts, extraColumns }),
  );

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
    .option("--commit", commitHelp(kind))
    .action((id: string, opts) => cmdEdit(getCtx(), kind, id, opts));

  parent
    .command("comment")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`add a comment to a ${noun}`)
    .option("-m, --message <text>", "comment text; without it $EDITOR is opened")
    .option("--reply-to <comment-id>", "comment this one replies to")
    .option("--commit", commitHelp(kind))
    .action((id: string, opts) => cmdComment(getCtx(), kind, id, opts));

  parent
    .command("close")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`move the ${noun} to closed/`)
    .option("--resolution <value>", "why it was closed, e.g. fixed, wontfix, duplicate")
    .option("--duplicate-of <id>", "the entity this duplicates (implies duplicate)")
    .option("--commit", commitHelp(kind))
    .action((id: string, opts) => {
      const options: CloseOptions = { ...opts, duplicateOf: opts.duplicateOf };
      if (shared.runClose) shared.runClose(getCtx(), id, options);
      else cmdClose(getCtx(), kind, id, options);
    });

  parent
    .command("reopen")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`move the ${noun} back to open/ and clear its resolution`)
    .option("--commit", commitHelp(kind))
    .action((id: string, opts) => cmdReopen(getCtx(), kind, id, opts));
}

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export { Option };
