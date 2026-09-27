/**
 * Command tree — spec 04 §4.3: noun-verb, with one verb vocabulary shared by
 * both entity kinds, plus root-level utilities.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEADLINE_TERMS,
  type EntityKind,
  type EntityRecord,
  MERGE_METHODS,
  QUERY_STATUSES,
  type QueryKey,
  type QueryKeySpec,
  queryTermsFor,
  REVIEW_DECISIONS,
} from "@navbook/core";
import { Command, Option } from "commander";
import { finiteNumber, wholeNumber } from "./args.ts";
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
import { cmdId, cmdInit } from "./commands/init.ts";
import { cmdInstall, cmdUninstall } from "./commands/install.ts";
import { cmdIssueLink, cmdIssueOpen, cmdIssueUnlink } from "./commands/issue.ts";
import {
  cmdPluginInstall,
  cmdPluginList,
  cmdPluginRemove,
  cmdPluginUpdate,
} from "./commands/plugin.ts";
import {
  cmdPrClose,
  cmdPrList,
  cmdPrMerge,
  cmdPrOpen,
  cmdPrRequest,
  cmdPrReview,
  cmdPrUpdate,
} from "./commands/pr.ts";
import { YES_HELP } from "./commands/pr-elsewhere.ts";
import type { Ctx } from "./context.ts";
import {
  applyOption,
  buildPluginCommand as buildDeclaredCommand,
  optionCollision,
} from "./plugins/commands.ts";
import type { VerbHandlers } from "./plugins/host.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";
import { DEFAULT_SORT, SORT_ORDERS } from "./sort.ts";

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

/**
 * What each keyed term means, in the words `--help` uses.
 *
 * Only the prose lives here: which terms exist, which noun has them and how
 * they combine all come from `QUERY_TERMS`, which the parser reads too, and so
 * do the values of the three keys that take a fixed set. Keyed by `QueryKey`,
 * so a term added to the grammar does not type-check until it is described.
 * `status` is the one whose values differ by noun, so `queryHelp` writes it.
 */
const TERM_HELP: Record<Exclude<QueryKey, "status">, { syntax: string; hint: string[] }> = {
  label: { syntax: "label:L", hint: ["L is among the entity's labels (repeatable, ANDs)"] },
  assignee: { syntax: "assignee:EMAIL", hint: ["assignee address, or a fragment of its domain"] },
  author: { syntax: "author:EMAIL", hint: ["author address, same matching"] },
  milestone: { syntax: "milestone:M", hint: ["exact milestone"] },
  reviewer: { syntax: "reviewer:EMAIL", hint: ["asked to review it; same matching"] },
  review: { syntax: "review:DECISION", hint: [`one of ${REVIEW_DECISIONS.join(", ")}`] },
  awaiting: { syntax: "awaiting:EMAIL", hint: ["asked to review it and has not yet"] },
  deadline: {
    syntax: `deadline:${DEADLINE_TERMS.join("|")}`,
    hint: ["overdue: due before today (UTC), strictly;", "none: no deadline at all"],
  },
};

/** How wide the syntax column is, as the help has always aligned it. */
const SYNTAX_WIDTH = 28;

function helpRow(syntax: string, hint: readonly string[]): string[] {
  return hint.map((line, i) => `  ${(i === 0 ? syntax : "").padEnd(SYNTAX_WIDTH)}${line}`);
}

/**
 * A plugin's declared `help` line as rows of the table above.
 *
 * The manifest writes it as the built-in rows read, syntax then a gap then
 * the hint; it is re-aligned here so a plugin need not know the column this
 * help happens to use. A line with no gap is all syntax, and a syntax too wide
 * for its column puts the hint on the next line rather than against it.
 */
export function pluginHelpRow(help: string): string[] {
  const [syntax = "", hint = ""] = help.trim().split(/\s{2,}(.*)/s);
  if (hint === "") return [`  ${syntax}`];
  if (syntax.length >= SYNTAX_WIDTH) return [`  ${syntax}`, ...helpRow("", [hint])];
  return helpRow(syntax, [hint]);
}

/**
 * The query grammar as `nav {issue,pr} list --help` states it.
 *
 * Built per noun, so neither page offers a term its own parser refuses. The
 * terms plugins declared for the noun follow the built-in ones, read from
 * their manifests alone (spec 04 §4.3: help costs no plugin code).
 */
function queryHelp(kind: EntityKind, pluginKeys: readonly QueryKeySpec[] = []): string {
  const terms = queryTermsFor(kind);
  const rows = terms.flatMap(({ key }) => {
    if (key === "status") {
      return helpRow(`status:${QUERY_STATUSES[kind].join("|")}`, ["entity status (path)"]);
    }
    return helpRow(TERM_HELP[key].syntax, TERM_HELP[key].hint);
  });
  rows.push(...pluginKeys.flatMap((key) => pluginHelpRow(key.help)));
  const combining = (combines: "and" | "or") =>
    terms
      .filter((term) => term.combines === combines)
      .map((term) => term.key)
      .join(", ");
  return [
    "Query terms AND together. Terms:",
    ...rows,
    ...helpRow('WORD or "some phrase"', [
      "case-insensitive substring of the title,",
      "description, or any comment body; also the",
      "entity's own ID, from four characters",
    ]),
    `Same-key terms OR for single-valued fields (${combining("or")})`,
    `and AND for multi-valued ones (${combining("and")}).`,
    // A manifest says what its term means but not how it combines, so the
    // sentence above cannot name it; its own description has to.
    ...(pluginKeys.length > 0 ? ["A plugin's terms combine as their descriptions say."] : []),
    "The default query is status:open.",
  ].join("\n");
}

/**
 * Help for `--commit`, naming the subject the verb commits under (spec 03 §3.2).
 *
 * The argument is the commit's scope rather than an entity kind: a plugin
 * declares scopes of its own (spec 03 §3.2), and those are deliberately not
 * kinds.
 */
function commitHelp(scope?: EntityKind | string): string {
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

/**
 * The nouns and utilities this CLI defines, which a plugin may not take.
 *
 * Kept as data because two things read it: the collision check that refuses a
 * plugin claiming one of these (spec 04 §4.3), and completion, which offers
 * them alongside whatever plugins added.
 */
export const BUILTIN_NOUNS = [
  "issue",
  "pr",
  "plugin",
  "init",
  "id",
  "doctor",
  "install",
  "uninstall",
] as const;

export function buildProgram(getCtx: () => Ctx, plugins?: PluginRuntime): Command {
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
    .option("-n, --count <n>", "how many IDs to print", wholeNumber("IDs", 1), 1)
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
    .action(async (words: string[]) => cmdComplete(getCtx(), words, plugins));

  program.addCommand(buildPluginCommand(getCtx));
  program.addCommand(buildIssueCommand(getCtx, plugins));
  program.addCommand(buildPrCommand(getCtx, plugins));

  // Built from manifests alone: no plugin code is imported here, which is what
  // lets `nav --help` cost the same with plugins installed as without
  // (spec 04 §4.3).
  for (const [, { plugin, spec }] of plugins?.commands.nouns ?? []) {
    program.addCommand(
      buildDeclaredCommand(plugin, spec, getCtx, (target, path, args, opts) =>
        (plugins as PluginRuntime).run(getCtx(), target, path, args, opts),
      ),
    );
  }
  return program;
}

/** `nav plugin` — the store verbs of spec 04 §4.3. */
function buildPluginCommand(getCtx: () => Ctx): Command {
  const plugin = withoutHelpVerb(new Command("plugin")).description("install and manage plugins");

  plugin
    .command("install")
    .argument("[name...]", "packages to install; the repository's declaration otherwise")
    .description("install plugins into the per-user store")
    .option("-y, --yes", "do not ask for confirmation")
    .action((names: string[], opts) => cmdPluginInstall(getCtx(), names, opts));

  plugin
    .command("remove")
    .argument("<name...>", "packages to remove")
    .description("remove plugins from the store")
    .option("-y, --yes", "do not ask for confirmation")
    .action((names: string[], opts) => cmdPluginRemove(getCtx(), names, opts));

  plugin
    .command("update")
    .argument("[name...]", "packages to update; all of them otherwise")
    .description("update installed plugins")
    .option("-y, --yes", "do not ask for confirmation")
    .action((names: string[], opts) => cmdPluginUpdate(getCtx(), names, opts));

  plugin
    .command("list")
    .description("what is installed, and whether this repository declares it")
    .option("--json", "one JSON object per plugin, newline-delimited")
    .action((opts) => cmdPluginList(getCtx(), opts));

  return plugin;
}

function buildPrCommand(getCtx: () => Ctx, plugins?: PluginRuntime): Command {
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
    .option("--commit", commitHelp("pr"))
    .action(async (opts) =>
      cmdPrOpen(getCtx(), { ...opts, ext: await openFields(getCtx(), plugins, "pr open", opts) }),
    );

  pr.command("update")
    .argument("<id>", "ID or unambiguous prefix")
    .description("append a revision pinning the current HEAD")
    .option("-y, --yes", YES_HELP)
    .option("--commit", commitHelp("pr"))
    .action((id: string, opts) => cmdPrUpdate(getCtx(), id, opts));

  pr.command("request")
    .argument("<id>", "ID or unambiguous prefix")
    .argument("<email...>", "who to ask")
    .description("ask people to review a pull request")
    .option("--remove", "take them off the reviewers instead")
    .option("-y, --yes", YES_HELP)
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
    .option("-y, --yes", YES_HELP)
    .option("--commit", commitHelp("pr"))
    .action((id: string, opts) => cmdPrReview(getCtx(), id, opts));

  pr.command("merge")
    .argument("[id]", "ID or unambiguous prefix")
    .description("merge a pull request into the checked-out target branch")
    .option("--method <name>", `how to land it (${MERGE_METHODS.join(" | ")})`)
    .option("--continue", "finish a merge that stopped for conflict resolution")
    .option("-y, --yes", "merge without asking when the review policy is not met")
    .option("--no-sync-source", "leave the source branch behind instead of fast-forwarding it")
    .action((id: string | undefined, opts) => cmdPrMerge(getCtx(), id, opts));

  applyContributedOptions(pr, "pr", plugins, getCtx);
  addSharedVerbs(pr, "pr", getCtx, {
    ...(plugins ? { plugins, verbPrefix: "pr" } : {}),
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

function buildIssueCommand(getCtx: () => Ctx, plugins?: PluginRuntime): Command {
  const issue = withoutHelpVerb(new Command("issue")).description("work with issues");

  issue
    .command("open")
    .argument("<title>", "one-line summary")
    .description("file a new issue")
    .option("-m, --message <text>", "description text; without it $EDITOR is opened")
    .option("--label <label>", "add a label (repeatable)", collect, [])
    .option("--assignee <email>", "assign to a person (repeatable)", collect, [])
    .option("--milestone <name>", "milestone")
    .option("--rank <n>", "where it sits in the queue; lower first", finiteNumber)
    .option("--deadline <date>", "when the work is wanted, YYYY-MM-DD")
    .option("--parent <id>", "file it as a subtask of an existing issue")
    .option("--commit", commitHelp("issue"))
    .action(async (title, opts) =>
      cmdIssueOpen(getCtx(), title, {
        ...opts,
        ext: await openFields(getCtx(), plugins, "issue open", opts),
      }),
    );

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

  applyContributedOptions(issue, "issue", plugins, getCtx);
  addSharedVerbs(issue, "issue", getCtx, {
    ...(plugins ? { plugins, verbPrefix: "issue" } : {}),
    extraColumns: [],
    configureList: (command) =>
      command.option(
        "--sort <order>",
        `listing order: ${SORT_ORDERS.join(", ")} (default ${DEFAULT_SORT})`,
      ),
    configureShow: (command) =>
      // No default here — `cmdShow` owns it, so every caller gets the same one.
      command.option(
        "--depth <n>",
        "levels of subtasks to render (default 1)",
        wholeNumber("levels"),
      ),
    configureDelete: (command) =>
      command.option("-r, --recursive", "delete its subtasks too, to any depth"),
  });
  return issue;
}

export interface SharedVerbOptions {
  extraColumns: ExtraColumn[];
  /** The plugin runtime, when this invocation has one. */
  plugins?: PluginRuntime;
  /** The noun these verbs hang off, for looking a contribution up by name. */
  verbPrefix?: string;
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

/** What plugins contributed to one of this noun's verbs, loading them if any. */
async function verbHandlers(
  ctx: Ctx,
  shared: SharedVerbOptions,
  verb: string,
): Promise<VerbHandlers[]> {
  if (shared.plugins === undefined || shared.verbPrefix === undefined) return [];
  return shared.plugins.handlersFor(ctx, `${shared.verbPrefix} ${verb}`);
}

/** One `jsonExtra` from several, or undefined when no plugin contributed one. */
function mergedJsonExtra(
  handlers: readonly VerbHandlers[],
): ((entity: EntityRecord) => Record<string, unknown>) | undefined {
  const contributors = handlers.filter((handler) => handler.jsonExtra !== undefined);
  if (contributors.length === 0) return undefined;
  return (entity) =>
    Object.assign({}, ...contributors.map((handler) => handler.jsonExtra?.(entity) ?? {}));
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
    .addHelpText("after", `\n${queryHelp(kind, shared.plugins?.queryKeys(kind))}`)
    .option("--json", "one JSON object per entity, newline-delimited");
  shared.configureList?.(list);
  list.action(async (terms: string[], opts) => {
    const contributed = await verbHandlers(getCtx(), shared, "list");
    const columns = [...extraColumns, ...contributed.flatMap((h) => h.columns ?? [])];
    const jsonExtra = mergedJsonExtra(contributed);
    const options = { ...opts, extraColumns: columns, ...(jsonExtra ? { jsonExtra } : {}) };
    if (shared.runList) shared.runList(getCtx(), terms, options);
    else cmdList(getCtx(), kind, terms, options);
  });

  const show = parent
    .command("show")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`render one ${noun} and its comments`)
    .option("--json", "emit a single JSON object including comments");
  shared.configureShow?.(show);
  show.action(async (id: string, opts) => {
    const contributed = await verbHandlers(getCtx(), shared, "show");
    const jsonExtra = mergedJsonExtra(contributed);
    const sections = contributed.flatMap((handlers) =>
      handlers.showSection ? [handlers.showSection] : [],
    );
    cmdShow(getCtx(), kind, id, {
      ...opts,
      ...(jsonExtra ? { jsonExtra } : {}),
      ...(sections.length > 0 ? { sections } : {}),
    });
  });

  // An issue lives on whatever branch you are standing on, so there is never
  // another worktree to send its write to: the flag is a pull-request notion.
  const edit = parent
    .command("edit")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`open the ${noun}'s file in $EDITOR`);
  if (kind === "pr") edit.option("-y, --yes", YES_HELP);
  edit
    .option("--commit", commitHelp(kind))
    .action((id: string, opts) => cmdEdit(getCtx(), kind, id, opts));

  const comment = parent
    .command("comment")
    .argument("<id>", "ID or unambiguous prefix")
    .description(`add a comment to a ${noun}`)
    .option("-m, --message <text>", "comment text; without it $EDITOR is opened")
    .option("--reply-to <comment-id>", "comment this one replies to");
  if (kind === "pr") comment.option("-y, --yes", YES_HELP);
  comment
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

/**
 * Add the options plugins declared for one verb, refusing a collision.
 *
 * From the manifest, so no plugin code runs: a `--feature` on `issue open`
 * exists in `--help` and in completion whether or not anybody has run the
 * command that would load the plugin implementing it.
 */
function applyContributedOptions(
  noun: Command,
  kind: EntityKind,
  plugins: PluginRuntime | undefined,
  getCtx: () => Ctx,
): void {
  if (plugins === undefined) return;
  for (const [on, entries] of plugins.commands.contributions) {
    const [target, verb] = on.split(" ");
    if (target !== kind || verb === undefined) continue;
    const command = noun.commands.find((candidate) => candidate.name() === verb);
    if (command === undefined) continue;
    for (const { plugin, spec } of entries) {
      for (const option of spec.options ?? []) {
        const problem = optionCollision(command, option);
        if (problem !== null) {
          // Before `.option()`, which throws on a duplicate flag: the plugin
          // loses its option and says so, rather than taking the CLI down.
          getCtx().stderr.write(
            `nav: plugin ${plugin.name} option skipped on '${on}': ${problem}\n`,
          );
          continue;
        }
        applyOption(command, option);
      }
    }
  }
}

/**
 * Frontmatter a plugin wants on a newly opened entity, read off its options.
 *
 * This is the one contribution that loads plugin code on a built-in verb, and
 * only when a plugin declared a contribution to *this* verb — so `nav issue
 * open` with no such plugin imports nothing.
 */
async function openFields(
  ctx: Ctx,
  plugins: PluginRuntime | undefined,
  verb: string,
  opts: Record<string, unknown>,
): Promise<Record<string, string | readonly string[]> | undefined> {
  if (plugins === undefined || !plugins.commands.contributions.has(verb)) return undefined;
  const fields: Record<string, string | readonly string[]> = {};
  for (const handlers of await plugins.handlersFor(ctx, verb)) {
    Object.assign(fields, handlers.openFields?.(opts) ?? {});
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

export { Option };
