/**
 * `nav __complete` — the completion backend the shell scripts call.
 *
 * Given the words typed so far (without the leading `nav`), it prints one
 * candidate per line. Keeping the logic here rather than in three shell
 * dialects is what makes ID and slug completion possible at all.
 */

import { allEntities, type CommandSpec, type EntityKind, loadRepo } from "@navbook/core";
import type { Ctx } from "../context.ts";
import type { LoadedPlugin } from "../plugins/resolve.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";

const ROOT_COMMANDS = ["issue", "pr", "plugin", "init", "id", "doctor", "install", "uninstall"];
const PLUGIN_VERBS = ["install", "remove", "update", "list"];
const SHARED_VERBS = ["open", "list", "show", "edit", "comment", "close", "reopen", "delete"];
const ISSUE_VERBS = [...SHARED_VERBS, "link", "unlink"];
const PR_VERBS = [...SHARED_VERBS, "update", "request", "review", "merge"];
const QUERY_KEYS = ["status:", "label:", "assignee:", "author:", "milestone:"];
/** Terms only a pull request has (spec 04 §4.3), offered only where they work. */
const PR_QUERY_KEYS = ["reviewer:", "review:", "awaiting:"];
/** And the one only an issue has (spec 02 §2.5). */
const ISSUE_QUERY_KEYS = ["deadline:"];

export async function cmdComplete(
  ctx: Ctx,
  words: string[],
  plugins?: PluginRuntime,
): Promise<void> {
  for (const candidate of await completionsFor(ctx, words, plugins)) {
    ctx.stdout.write(`${candidate}\n`);
  }
}

async function completionsFor(
  ctx: Ctx,
  words: string[],
  plugins?: PluginRuntime,
): Promise<string[]> {
  // Plugin nouns and verbs come from manifests, so completion costs no import
  // however many plugins are installed (spec 04 §4.3).
  const pluginNouns = [...(plugins?.commands.nouns.keys() ?? [])];
  const rootCommands = [...ROOT_COMMANDS, ...pluginNouns];

  const [noun, verb] = words;
  if (noun === undefined) return rootCommands;
  if (noun === "plugin") return verb === undefined ? PLUGIN_VERBS : [];
  if (plugins?.commands.nouns.has(noun)) {
    const owner = plugins.commands.nouns.get(noun);
    return owner === undefined
      ? []
      : pluginCompletions(ctx, plugins, owner.plugin, owner.spec, words.slice(1));
  }
  if (noun !== "issue" && noun !== "pr") {
    return words.length === 1 ? rootCommands : [];
  }

  const kind: EntityKind = noun === "issue" ? "issue" : "pr";
  const verbs = kind === "issue" ? ISSUE_VERBS : PR_VERBS;
  if (verb === undefined) return verbs;
  if (!verbs.includes(verb)) return [];

  if (verb === "list") {
    const keys =
      kind === "pr" ? [...QUERY_KEYS, ...PR_QUERY_KEYS] : [...QUERY_KEYS, ...ISSUE_QUERY_KEYS];
    // A plugin's *values* cost an import, and only for a verb whose manifest
    // declared `completions` — so completing `nav pr list` loads nothing when
    // no plugin contributes there.
    return [
      ...keys,
      ...pluginQueryKeys(kind, plugins),
      ...(await pluginListValues(ctx, kind, plugins)),
      ...labels(ctx),
    ];
  }
  if (verb === "open") return [];
  // Every other verb takes an ID as its first argument.
  return words.length === 2 ? entityCandidates(ctx, kind) : [];
}

/**
 * Verbs a plugin's noun offers, walked down whatever has been typed so far.
 *
 * Declarations only. A plugin's *values* — the slugs and ids its arguments
 * take — need the plugin itself, and are offered through a completer it
 * registers; those cost an import and are asked for only once the noun and
 * the verb are on the line.
 */
async function pluginCompletions(
  ctx: Ctx,
  plugins: PluginRuntime,
  plugin: LoadedPlugin,
  spec: CommandSpec,
  rest: readonly string[],
): Promise<string[]> {
  const children = spec.commands ?? [];
  const [next, ...deeper] = rest;

  // Still walking down the verb tree: the names come from the manifest, so
  // nothing is loaded to offer them.
  if (children.length > 0) {
    if (next === undefined) return children.map((child) => child.name);
    const child = children.find((candidate) => candidate.name === next);
    return child === undefined ? [] : pluginCompletions(ctx, plugins, plugin, child, deeper);
  }

  // At a leaf. The argument being typed is the one at this position, and it
  // offers values only if the manifest named a completer for it — which is
  // what makes asking the plugin a declared cost rather than a surprise.
  const argument = (spec.arguments ?? [])[rest.length];
  if (argument?.complete === undefined) return [];
  return plugins.completions(ctx, plugin, argument.complete, [...rest]);
}

/** Values plugins offer for this listing's terms; loads their CLI entries. */
async function pluginListValues(
  ctx: Ctx,
  kind: EntityKind,
  plugins?: PluginRuntime,
): Promise<string[]> {
  if (plugins === undefined) return [];
  const out: string[] = [];
  for (const handlers of await plugins.handlersFor(ctx, `${kind} list`)) {
    out.push(...(handlers.listCompletions?.() ?? []));
  }
  return out;
}

/** Query terms plugins declared for this kind, from the manifest. */
function pluginQueryKeys(kind: EntityKind, plugins?: PluginRuntime): string[] {
  const out: string[] = [];
  for (const plugin of plugins?.usable ?? []) {
    for (const key of plugin.manifest.core?.queryKeys ?? []) {
      if (key.kinds.includes(kind)) out.push(`${key.key}:`);
    }
  }
  return out;
}

/**
 * Bare IDs and full directory names, so a user can complete either the short
 * form they would type or the readable name they would recognize.
 */
function entityCandidates(ctx: Ctx, kind: EntityKind): string[] {
  try {
    const repo = loadRepo(ctx, { comments: "none" });
    return allEntities(repo)
      .filter((entity) => entity.kind === kind)
      .flatMap((entity) => [entity.id, entity.dirName])
      .sort();
  } catch {
    return [];
  }
}

function labels(ctx: Ctx): string[] {
  try {
    const repo = loadRepo(ctx, { comments: "none" });
    const found = new Set<string>();
    for (const entity of allEntities(repo)) {
      const values = entity.fm.labels;
      if (!Array.isArray(values)) continue;
      for (const value of values) if (typeof value === "string") found.add(`label:${value}`);
    }
    return [...found].sort();
  } catch {
    return [];
  }
}
