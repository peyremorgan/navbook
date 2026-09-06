/**
 * `nav __complete` — the completion backend the shell scripts call.
 *
 * Given the words typed so far (without the leading `nav`), it prints one
 * candidate per line. Keeping the logic here rather than in three shell
 * dialects is what makes ID and slug completion possible at all.
 */

import { allEntities, type EntityKind, loadRepo } from "@navbook/core";
import type { Ctx } from "../context.ts";
import { featureSlugs } from "./feature.ts";

const ROOT_COMMANDS = ["issue", "pr", "feature", "init", "id", "doctor", "install", "uninstall"];
const SHARED_VERBS = ["open", "list", "show", "edit", "comment", "close", "reopen", "delete"];
const ISSUE_VERBS = [...SHARED_VERBS, "link", "unlink"];
const PR_VERBS = [...SHARED_VERBS, "update", "review", "merge"];
const FEATURE_VERBS = ["open", "list", "show", "edit", "spec"];
const SPEC_VERBS = ["add", "edit", "list"];
const QUERY_KEYS = ["status:", "label:", "assignee:", "author:", "milestone:", "feature:"];

export function cmdComplete(ctx: Ctx, words: string[]): void {
  for (const candidate of completionsFor(ctx, words)) ctx.stdout.write(`${candidate}\n`);
}

function completionsFor(ctx: Ctx, words: string[]): string[] {
  const [noun, verb] = words;
  if (noun === undefined) return ROOT_COMMANDS;
  if (noun === "feature") return featureCompletions(ctx, words);
  if (noun !== "issue" && noun !== "pr") {
    return words.length === 1 ? ROOT_COMMANDS : [];
  }

  const kind: EntityKind = noun === "issue" ? "issue" : "pr";
  const verbs = kind === "issue" ? ISSUE_VERBS : PR_VERBS;
  if (verb === undefined) return verbs;
  if (!verbs.includes(verb)) return [];

  if (verb === "list") return [...QUERY_KEYS, ...labels(ctx), ...features(ctx)];
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

function specNames(ctx: Ctx, slug: string): string[] {
  try {
    const feature = loadRepo(ctx, { includeComments: false }).featureBySlug.get(slug);
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
    const repo = loadRepo(ctx, { includeComments: false });
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
    const repo = loadRepo(ctx, { includeComments: false });
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
