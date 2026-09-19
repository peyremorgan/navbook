/**
 * `nav __complete` — the completion backend the shell scripts call.
 *
 * Given the words typed so far (without the leading `nav`), it prints one
 * candidate per line. Keeping the logic here rather than in three shell
 * dialects is what makes ID and slug completion possible at all.
 */

import { allEntities, type CommandSpec, type EntityKind, loadRepo } from "@navbook/core";
import type { Ctx } from "../context.ts";
import type { PluginRuntime } from "../plugins/runtime.ts";
import { featureSlugs } from "./feature.ts";

const ROOT_COMMANDS = [
  "issue",
  "pr",
  "feature",
  "plugin",
  "init",
  "id",
  "doctor",
  "install",
  "uninstall",
];
const PLUGIN_VERBS = ["install", "remove", "update", "list"];
const SHARED_VERBS = ["open", "list", "show", "edit", "comment", "close", "reopen", "delete"];
const ISSUE_VERBS = [...SHARED_VERBS, "link", "unlink"];
const PR_VERBS = [...SHARED_VERBS, "update", "request", "review", "merge"];
const FEATURE_VERBS = ["open", "list", "show", "edit", "spec"];
const SPEC_VERBS = ["add", "edit", "list"];
const QUERY_KEYS = ["status:", "label:", "assignee:", "author:", "milestone:", "feature:"];
/** Terms only a pull request has (spec 04 §4.3), offered only where they work. */
const PR_QUERY_KEYS = ["reviewer:", "review:", "awaiting:"];
/** And the one only an issue has (spec 02 §2.5). */
const ISSUE_QUERY_KEYS = ["deadline:"];

export function cmdComplete(ctx: Ctx, words: string[], plugins?: PluginRuntime): void {
  for (const candidate of completionsFor(ctx, words, plugins)) ctx.stdout.write(`${candidate}\n`);
}

function completionsFor(ctx: Ctx, words: string[], plugins?: PluginRuntime): string[] {
  // Plugin nouns and verbs come from manifests, so completion costs no import
  // however many plugins are installed (spec 04 §4.3).
  const pluginNouns = [...(plugins?.commands.nouns.keys() ?? [])];
  const rootCommands = [...ROOT_COMMANDS, ...pluginNouns];

  const [noun, verb] = words;
  if (noun === undefined) return rootCommands;
  if (noun === "plugin") return verb === undefined ? PLUGIN_VERBS : [];
  if (noun === "feature") return featureCompletions(ctx, words);
  if (plugins?.commands.nouns.has(noun)) {
    return declaredCompletions(plugins.commands.nouns.get(noun)?.spec, words.slice(1));
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
    return [...keys, ...pluginQueryKeys(kind, plugins), ...labels(ctx), ...features(ctx)];
  }
  if (verb === "open") return [];
  // Every other verb takes an ID as its first argument.
  return words.length === 2 ? entityCandidates(ctx, kind) : [];
}

/**
 * `nav feature …`, whose second word may be a verb or the `spec` group.
 *
 * Slugs are offered wherever one is expected, and document names once the
 * feature is known — which is the whole reason completion is written here
 * rather than in three shell dialects.
 */
function featureCompletions(ctx: Ctx, words: string[]): string[] {
  const [, verb, third] = words;
  if (verb === undefined) return FEATURE_VERBS;

  if (verb === "spec") {
    if (third === undefined) return SPEC_VERBS;
    if (!SPEC_VERBS.includes(third)) return [];
    if (words.length === 3) return featureSlugs(ctx);
    // `spec edit <slug> <file>` is the one place a document name is wanted.
    if (third === "edit" && words.length === 4) return specNames(ctx, words[3] as string);
    return [];
  }

  if (!FEATURE_VERBS.includes(verb)) return [];
  if (verb === "list" || verb === "open") return [];
  return words.length === 2 ? featureSlugs(ctx) : [];
}

/**
 * Verbs a plugin's noun offers, walked down whatever has been typed so far.
 *
 * Declarations only. A plugin's *values* — the slugs and ids its arguments
 * take — need the plugin itself, and are offered through a completer it
 * registers; those cost an import and are asked for only once the noun and
 * verb are on the line.
 */
function declaredCompletions(spec: CommandSpec | undefined, rest: readonly string[]): string[] {
  if (spec === undefined) return [];
  const [next, ...deeper] = rest;
  const children = spec.commands ?? [];
  if (next === undefined) return children.map((child) => child.name);
  const child = children.find((candidate) => candidate.name === next);
  if (child === undefined) return [];
  return declaredCompletions(child, deeper);
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

function specNames(ctx: Ctx, slug: string): string[] {
  try {
    const feature = loadRepo(ctx, { comments: "none" }).featureBySlug.get(slug);
    return feature ? feature.specs.map((spec) => spec.fileName) : [];
  } catch {
    return [];
  }
}

function features(ctx: Ctx): string[] {
  return featureSlugs(ctx).map((slug) => `feature:${slug}`);
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
