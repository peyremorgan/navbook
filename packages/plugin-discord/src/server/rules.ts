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

export interface Opening {
  channel: string;
  /** What fired, as the rule wrote it; null for a pull request, which always gets one. */
  trigger: Trigger | null;
}

/** Where `record` gets a thread for `events`, if anywhere. */
export function openingFor(
  core: Core,
  record: EntityRecord,
  events: readonly EntityEvent[],
  settings: Settings,
  rules: readonly CompiledRule[],
  policy: ReviewPolicy,
  ext: CoreExtensions,
): Opening | null {
  if (record.kind === "pr") {
    return settings.prs !== null && events.some((event) => event.type === "opened")
      ? { channel: settings.prs.channel, trigger: null }
      : null;
  }
  for (const { rule, query } of rules) {
    if (rule.scope === "root" && core.readParent(record.fm) !== null) continue;
    const trigger = rule.on.find((each) => fires(each, events));
    if (trigger === undefined) continue;
    if (!core.matchesQuery(query, record, policy, ext)) continue;
    return { channel: rule.channel, trigger };
  }
  return null;
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
