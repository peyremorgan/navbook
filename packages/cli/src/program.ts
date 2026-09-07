/**
 * Command tree — spec 04 §4.3: noun-verb, with one verb vocabulary shared by
 * both entity kinds, plus root-level utilities.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EntityKind } from "@navbook/core";
import { Command, Option } from "commander";
import { cmdComplete } from "./commands/complete.ts";
import { cmdDoctor } from "./commands/doctor.ts";
import {
  type CloseOptions,
  cmdClose,
  cmdComment,
  cmdDelete,
  cmdEdit,
  cmdList,
  cmdReopen,
  cmdShow,
  type ExtraColumn,
} from "./commands/entity.ts";
import {
  cmdFeatureEdit,
  cmdFeatureList,
  cmdFeatureOpen,
  cmdFeatureShow,
  cmdSpecAdd,
  cmdSpecEdit,
  cmdSpecList,
} from "./commands/feature.ts";
import { cmdId, cmdInit } from "./commands/init.ts";
import { cmdInstall, cmdUninstall } from "./commands/install.ts";
import { cmdIssueLink, cmdIssueOpen, cmdIssueUnlink } from "./commands/issue.ts";
import {
  cmdPrClose,
  cmdPrList,
  cmdPrMerge,
  cmdPrOpen,
  cmdPrRequest,
  cmdPrReview,
  cmdPrUpdate,
} from "./commands/pr.ts";
import type { Ctx } from "./context.ts";

/**
 * Read straight from package.json rather than duplicating the version as a
 * literal: a hardcoded copy silently drifts the moment a release is cut
 * without updating both places (which is exactly what shipped as 0.1.1).
 * `../package.json` is the package root from both `src/` in dev and `dist/`
 * after the build — the same relative depth either way.
 */
function readOwnVersion(): string {
  const path = fileURLToPath(new URL("../package.json", import.meta.url));
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
  feature:SLUG                SLUG is among the entity's features (repeatable, ANDs)
  reviewer:EMAIL              asked to review it; PRs only, same matching
  review:DECISION             pending, approved or changes-requested; PRs only
  awaiting:EMAIL              asked to review it and has not yet; PRs only
  WORD or "some phrase"       case-insensitive substring of the title,
                              description, or any comment body
Same-key terms OR for single-valued fields (status, author, milestone, review)
and AND for multi-valued ones (label, assignee, feature, reviewer, awaiting).
The default query is status:open.`;

/**
 * Help for `--commit`, naming the subject the verb commits under (spec 03 §3.2).
 *
 * The argument is the commit's scope rather than an entity kind: `feature` is
 * one of the scopes and is deliberately not one of the kinds.
 */
function commitHelp(scope?: EntityKind | "feature"): string {
  return `wrap the change in a 'docs${scope ? `(${scope})` : ""}:' commit`;
}

/**
 * Drop the implicit `help [command]` verb Commander gives every command that
 * has subcommands: it prints exactly what `--help` prints, so `nav issue help
 * open` and `nav issue open --help` are two spellings of one thing. `--help`
 * is the one that stays.
 *
 * Applied at each level that has subcommands — the setting is per-command and
 * deliberately not inherited, so the nouns do not pick it up from the root.
 */
function withoutHelpVerb(command: Command): Command {
  return command.helpCommand(false);
}

export function buildProgram(getCtx: () => Ctx): Command {
  const program = withoutHelpVerb(new Command());
  program
    .name("nav")
    .description("Git-native issue and pull-request tracking, stored as files in your repository")
    .version(VERSION, "-V, --version")
    .showHelpAfterError()
    .enablePositionalOptions();

  program
    .command("init")
    .description("create the Navbook skeleton at the repository root")
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
  program.addCommand(buildFeatureCommand(getCtx));
  return program;
}

function buildPrCommand(getCtx: () => Ctx): Command {
  const pr = withoutHelpVerb(new Command("pr")).description("work with pull requests");

  pr.command("open")
    .description("open a pull request from the current branch")
    .option("--target <branch>", "branch to merge into (default: the repository's default branch)")
    .option("--title <text>", "one-line summary (default: the last commit's subject)")
    .option("-m, --message <text>", "description text; without it $EDITOR is opened")
    .option("--draft", "not yet requesting review")
    .option("--label <label>", "add a label (repeatable)", collect, [])
    .option("--assignee <email>", "assign to a person (repeatable)", collect, [])
    .option("--reviewer <email>", "ask a person to review it (repeatable)", collect, [])
    .option("--milestone <name>", "milestone")
    .option("--feature <slug>", "attach it to a feature (repeatable)", collect, [])
    .option("--commit", commitHelp("pr"))
    .action((opts) => cmdPrOpen(getCtx(), opts));

  pr.command("update")
    .argument("<id>", "ID or unambiguous prefix")
    .description("append a revision pinning the current HEAD")
    .option("--commit", commitHelp("pr"))
    .action((id: string, opts) => cmdPrUpdate(getCtx(), id, opts));

  pr.command("request")
    .argument("<id>", "ID or unambiguous prefix")
    .argument("<email...>", "who to ask")
    .description("ask people to review a pull request")
    .option("--remove", "take them off the reviewers instead")
    .option("--commit", commitHelp("pr"))
    .action((id: string, people: string[], opts) => cmdPrRequest(getCtx(), id, people, opts));

  pr.command("review")
    .argument("<id>", "ID or unambiguous prefix")
    .description("review a pull request, bound to a specific revision")
    .option("--approve", "record an approving verdict")
    .option("--request-changes", "record a request-changes verdict")
    .option("--comment", "record a verdict that judges nothing (the default)")
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
    // No extra columns here: `cmdPrList` owns the PR listing's columns, because
    // it appends a `refs` one when scanning across branches.
    extraColumns: [],
    runClose: (ctx, id, options) => cmdPrClose(ctx, id, options),
    configureList: (command) => {
      command.option("--all-refs", "scan all local and fetched remote branches, not just this one");
    },
    runList: (ctx, terms, options) => cmdPrList(ctx, terms, options),
  });
  return pr;
}

/**
 * `nav feature` — spec 04 §4.3.
 *
 * None of the shared verbs appear here. A feature does not open and close, and
 * it is not discussed: the discussion belongs to the issues attached to it. So
 * the family is small on purpose, and `spec` groups what acts on the documents
 * rather than on the feature itself.
 */
function buildFeatureCommand(getCtx: () => Ctx): Command {
  const feature = withoutHelpVerb(new Command("feature")).description("work with features");

  feature
    .command("open")
    .argument("<title>", "one-line name for the feature")
    .description("create a feature")
    .option("-m, --message <text>", "summary text; without it $EDITOR is opened")
    .option("--slug <slug>", "directory name to file it under; derived from the title otherwise")
    .option("--commit", commitHelp("feature"))
    .action((title: string, opts) => cmdFeatureOpen(getCtx(), title, opts));

  feature
    .command("list")
    .description("list features, with how much work is attached to each")
    .option("--json", "one JSON object per feature, newline-delimited")
    .action((opts) => cmdFeatureList(getCtx(), opts));

  feature
    .command("show")
    .argument("<slug>", "the feature's directory name")
    .description("render a feature, its documents, and what has touched it")
    .option("--json", "emit a single JSON object naming its issues and pull requests")
    .option("--commits <n>", "recent commits to list (default 10)", (value) =>
      value.trim() === "" ? Number.NaN : Number(value),
    )
    .action((slug: string, opts) => cmdFeatureShow(getCtx(), slug, opts));

  feature
    .command("edit")
    .argument("<slug>", "the feature's directory name")
    .description("open the feature's feature.md in $EDITOR")
    .option("--commit", commitHelp("feature"))
    .action((slug: string, opts) => cmdFeatureEdit(getCtx(), slug, opts));

  feature.addCommand(buildSpecCommand(getCtx));
  return feature;
}

function buildSpecCommand(getCtx: () => Ctx): Command {
  const spec = withoutHelpVerb(new Command("spec")).description(
    "work with a feature's specification documents",
  );

  spec
    .command("add")
    .argument("<slug>", "the feature's directory name")
    .argument("<title>", "one-line name for the document")
    .description("add a specification document to a feature")
    .option("-m, --message <text>", "document text; without it $EDITOR is opened")
    .option("--file <name>", "file to write it to; derived from the title otherwise")
    .option("--commit", commitHelp("feature"))
    .action((slug: string, title: string, opts) => cmdSpecAdd(getCtx(), slug, title, opts));

  spec
    .command("edit")
    .argument("<slug>", "the feature's directory name")
    .argument("<file>", "the document's file name")
    .description("open a specification document in $EDITOR")
    .option("--commit", commitHelp("feature"))
    .action((slug: string, file: string, opts) => cmdSpecEdit(getCtx(), slug, file, opts));

  spec
    .command("list")
    .argument("<slug>", "the feature's directory name")
    .description("list a feature's specification documents")
    .option("--json", "one JSON object per document, newline-delimited")
    .action((slug: string, opts) => cmdSpecList(getCtx(), slug, opts));

  return spec;
}

function buildIssueCommand(getCtx: () => Ctx): Command {
  const issue = withoutHelpVerb(new Command("issue")).description("work with issues");

  issue
    .command("open")
    .argument("<title>", "one-line summary")
    .description("file a new issue")
    .option("-m, --message <text>", "description text; without it $EDITOR is opened")
    .option("--label <label>", "add a label (repeatable)", collect, [])
    .option("--assignee <email>", "assign to a person (repeatable)", collect, [])
    .option("--milestone <name>", "milestone")
    .option("--feature <slug>", "attach it to a feature (repeatable)", collect, [])
    .option("--parent <id>", "file it as a subtask of an existing issue")
    .option("--commit", commitHelp("issue"))
    .action((title, opts) => cmdIssueOpen(getCtx(), title, opts));

  issue
    .command("link")
    .argument("<id>", "ID or unambiguous prefix")
    .description("file the issue as a subtask of another issue")
    .requiredOption("--parent <id>", "the issue it belongs under")
    .option("-f, --force", "move it without asking when it already has a parent")
    .option("--commit", commitHelp("issue"))
    .action((id: string, opts) => cmdIssueLink(getCtx(), id, opts));

  issue
    .command("unlink")
    .argument("<id>", "ID or unambiguous prefix")
    .description("detach the issue from its parent")
    .option("--commit", commitHelp("issue"))
    .action((id: string, opts) => cmdIssueUnlink(getCtx(), id, opts));

  addSharedVerbs(issue, "issue", getCtx, {
    extraColumns: [],
    configureShow: (command) =>
      // Number, not parseInt: '2.5' has to reach the command as 2.5 so it can
      // be refused, rather than being silently rounded to something valid.
      // No default here — `cmdShow` owns it, so every caller gets the same one.
      command.option("--depth <n>", "levels of subtasks to render (default 1)", (value) =>
        value.trim() === "" ? Number.NaN : Number(value),
      ),
    configureDelete: (command) =>
      command.option("-r, --recursive", "delete its subtasks too, to any depth"),
  });
  return issue;
}

export interface SharedVerbOptions {
  extraColumns: ExtraColumn[];
  /** Extra options the noun's `list` accepts, e.g. `--all-refs` for PRs. */
  configureList?: (command: Command) => void;
  /** Extra options the noun's `show` accepts, e.g. `--depth` for issues. */
  configureShow?: (command: Command) => void;
  /** Extra options the noun's `delete` accepts, e.g. `--recursive` for issues. */
  configureDelete?: (command: Command) => void;
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

  const show = parent
    .command("show")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`render one ${noun} and its comments`)
    .option("--json", "emit a single JSON object including comments");
  shared.configureShow?.(show);
  show.action((id: string, opts) => cmdShow(getCtx(), kind, id, opts));

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

  const remove = parent
    .command("delete")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`remove the ${noun}'s directory, whatever its status`)
    .option("-f, --force", "do not ask, even when the directory holds uncommitted changes")
    .option("--commit", commitHelp(kind));
  shared.configureDelete?.(remove);
  remove.action((id: string, opts) => cmdDelete(getCtx(), kind, id, opts));
}

export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export { Option };
