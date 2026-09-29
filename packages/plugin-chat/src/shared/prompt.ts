/**
 * The system prompt: what the assistant is told before anybody speaks.
 *
 * Most of it is `doc/assistant.md`, written for the model and shipped in the
 * package, so it is the same text on every machine and for every request.
 * After it comes a short section about this session — who is asking, what day
 * it is, what this repository's tree holds. The fixed text goes first on
 * purpose: providers cache a prompt by its prefix, and a prefix that changed
 * with the date would never be cached.
 */

import { readFileSync } from "node:fs";
import type * as NavbookCore from "@navbook/core";
import type { CoreExtensions, Repo } from "@navbook/core";

let cached: string | null = null;

/** `doc/assistant.md`, read once per process. */
export function staticPrompt(): string {
  cached ??= readFileSync(new URL("../../doc/assistant.md", import.meta.url), "utf8");
  return cached;
}

export interface SessionContext {
  /** Who the assistant is talking to, as `Name <email>`. */
  viewer: string;
  /** Today, as `YYYY-MM-DD`. */
  today: string;
  /** Where the conversation happens: `the nav command line`, `the web tracker`. */
  surface: string;
  /** Query keys the repository's plugins add, as their help lines. */
  queryKeys?: readonly string[];
  /** The labels, milestones and people the tree uses, for spelling them right. */
  labels?: readonly string[];
  milestones?: readonly string[];
  people?: readonly string[];
  /** The branch checked out, where there is one. */
  branch?: string | null;
}

/** How many of each list the session section names. */
export const SESSION_LIST_LIMIT = 40;

export function systemPrompt(context: SessionContext, fixed = staticPrompt()): string {
  const lines = [
    "## This session",
    "",
    `- You are talking to ${context.viewer}. "me", "my" and "I" mean them.`,
    `- Today is ${context.today}.`,
    `- The conversation happens in ${context.surface}.`,
  ];
  if (context.branch) lines.push(`- The checked-out branch is \`${context.branch}\`.`);
  const list = (label: string, values: readonly string[] | undefined): void => {
    if (!values || values.length === 0) return;
    const sorted = [...new Set(values)].sort((a, b) => a.localeCompare(b));
    const shown = sorted.slice(0, SESSION_LIST_LIMIT);
    const more = sorted.length - shown.length;
    lines.push(
      `- ${label}: ${shown.map((value) => `\`${value}\``).join(", ")}${more > 0 ? `, and ${more} more` : ""}.`,
    );
  };
  list("Labels in use", context.labels);
  list("Milestones in use", context.milestones);
  list("People who appear in the tracker", context.people);
  if (context.queryKeys && context.queryKeys.length > 0) {
    lines.push("- This repository's plugins add these query terms:");
    for (const help of context.queryKeys) lines.push(`  - \`${help.trim()}\``);
  }
  return `${fixed.trimEnd()}\n\n${lines.join("\n")}\n`;
}

/**
 * The labels, milestones and people a tree uses, and the query terms its
 * plugins add: what the model needs to spell a query the way this repository
 * does, rather than guess.
 */
export function vocabulary(
  core: typeof NavbookCore,
  repo: Repo | null,
  ext: CoreExtensions,
): Pick<SessionContext, "labels" | "milestones" | "people" | "queryKeys"> {
  const labels: string[] = [];
  const milestones: string[] = [];
  const people: string[] = [];
  for (const entity of repo === null ? [] : core.allEntities(repo)) {
    labels.push(...core.readLabels(entity.fm));
    if (typeof entity.fm.milestone === "string") milestones.push(entity.fm.milestone);
    if (typeof entity.fm.author === "string") people.push(entity.fm.author);
    people.push(...core.readAssignees(entity.fm));
  }
  const queryKeys = ext.queryKeys.map((key) => {
    const kinds = key.kinds
      .map((kind) => (kind === "pr" ? "pull requests" : "issues"))
      .join(" and ");
    return `${key.key}:VALUE — added by a plugin, for ${kinds}`;
  });
  return { labels, milestones, people, queryKeys };
}
