/**
 * Which issues get a thread, and where — `doc/spec.md`, "Rules".
 *
 * A pull request always does, in the channel `prs` names, when it is opened.
 * An issue does when one of the `issues` rules fires: one of its triggers
 * matches what just happened to the issue, the issue is in its scope, and it
 * matches the rule's query as it stands now. Rules are weighed in the order
 * they are written, and the first that fires decides the channel; an issue
 * that already has a thread keeps it, whatever fires later.
 */

import type { CoreExtensions, EntityRecord, Query, ReviewPolicy } from "@navbook/core";
import type { IssueRule, Settings, Trigger } from "../core/settings.ts";
import { type Core, type EntityEvent, valuesOf } from "./model.ts";

export interface CompiledRule {
  rule: IssueRule;
  query: Query;
}

/** Every rule with its query parsed, or why one does not parse. */
export function compileRules(
  core: Core,
  settings: Settings,
  ext: CoreExtensions,
): { rules: CompiledRule[]; problems: string[] } {
  const rules: CompiledRule[] = [];
  const problems: string[] = [];
  settings.issues.forEach((rule, index) => {
    const query = core.parseQuery(rule.match, "issue", ext);
    if ("message" in query) problems.push(`issues[${index}].match: ${query.message}`);
    else rules.push({ rule, query });
  });
  return { rules, problems };
}

/** Where `record` gets a thread for `events`, if anywhere: the channel. */
export function openingFor(
  core: Core,
  record: EntityRecord,
  events: readonly EntityEvent[],
  settings: Settings,
  rules: readonly CompiledRule[],
  policy: ReviewPolicy,
  ext: CoreExtensions,
): string | null {
  if (record.kind === "pr") {
    return settings.prs !== null && events.some((event) => event.type === "opened")
      ? settings.prs.channel
      : null;
  }
  const fired = rules.find(
    (rule) =>
      rule.rule.on.some((trigger) => fires(trigger, events)) &&
      takes(core, rule, record, policy, ext),
  );
  return fired?.rule.channel ?? null;
}

/**
 * Where `record` goes when somebody asks for its thread, whatever the
 * triggers say: the pull requests' channel, or the first rule whose scope
 * and query the issue is in.
 */
export function channelFor(
  core: Core,
  record: EntityRecord,
  settings: Settings,
  rules: readonly CompiledRule[],
  policy: ReviewPolicy,
  ext: CoreExtensions,
): string | null {
  if (record.kind === "pr") return settings.prs?.channel ?? null;
  return rules.find((rule) => takes(core, rule, record, policy, ext))?.rule.channel ?? null;
}

/** Whether an issue is in a rule's scope, and matches its query as it stands now. */
function takes(
  core: Core,
  { rule, query }: CompiledRule,
  record: EntityRecord,
  policy: ReviewPolicy,
  ext: CoreExtensions,
): boolean {
  return (
    (rule.scope !== "root" || core.readParent(record.fm) === null) &&
    core.matchesQuery(query, record, policy, ext)
  );
}

/** Whether one trigger matches any of the events. */
export function fires(trigger: Trigger, events: readonly EntityEvent[]): boolean {
  return events.some((event) => {
    switch (trigger.kind) {
      case "open":
        return event.type === "opened";
      case "assign":
        return event.type === "assigned" && event.added.length > 0;
      case "status":
        return event.type === "status" && event.to === trigger.status;
      case "field": {
        if (event.type !== "field" || event.key !== trigger.key) return false;
        const after = valuesOf(event.after);
        if (trigger.value === undefined) return after.length > 0;
        // A transition: the value is there now and was not before.
        return after.includes(trigger.value) && !valuesOf(event.before).includes(trigger.value);
      }
      default:
        return false;
    }
  });
}

/** The fields a thread is told about when they change: those a rule's trigger names. */
export function watchedFields(settings: Settings): Set<string> {
  const keys = new Set<string>();
  for (const rule of settings.issues) {
    for (const trigger of rule.on) if (trigger.kind === "field") keys.add(trigger.key);
  }
  return keys;
}
