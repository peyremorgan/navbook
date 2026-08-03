/**
 * `nav __complete` — the completion backend the shell scripts call.
 *
 * Given the words typed so far (without the leading `nav`), it prints one
 * candidate per line. Keeping the logic here rather than in three shell
 * dialects is what makes ID and slug completion possible at all.
 */

import { allEntities, type EntityKind } from "../../core/tree.ts";
import { loadRepo } from "../../workspace/index.ts";
import type { Ctx } from "../context.ts";

const ROOT_COMMANDS = ["issue", "pr", "init", "id", "doctor", "install", "uninstall"];
const SHARED_VERBS = ["open", "list", "show", "edit", "comment", "close", "reopen", "delete"];
const PR_VERBS = [...SHARED_VERBS, "update", "review", "merge"];
const QUERY_KEYS = ["status:", "label:", "assignee:", "author:", "milestone:"];

export function cmdComplete(ctx: Ctx, words: string[]): void {
  for (const candidate of completionsFor(ctx, words)) ctx.stdout.write(`${candidate}\n`);
}

function completionsFor(ctx: Ctx, words: string[]): string[] {
  const [noun, verb] = words;
  if (noun === undefined) return ROOT_COMMANDS;
  if (noun !== "issue" && noun !== "pr") {
    return words.length === 1 ? ROOT_COMMANDS : [];
  }

  const kind: EntityKind = noun === "issue" ? "issue" : "pr";
  const verbs = kind === "issue" ? SHARED_VERBS : PR_VERBS;
  if (verb === undefined) return verbs;
  if (!verbs.includes(verb)) return [];

  if (verb === "list") return [...QUERY_KEYS, ...labels(ctx)];
  if (verb === "open") return [];
  // Every other verb takes an ID as its first argument.
  return words.length === 2 ? entityCandidates(ctx, kind) : [];
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
