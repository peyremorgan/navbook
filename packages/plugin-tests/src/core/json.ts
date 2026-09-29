/**
 * The canonical JSON projection of a plan and a run — spec 04 §4.2.
 *
 * Identity first, then the frontmatter as the file spells it, then what is
 * derived: the order every other `--json` projection uses, so a reader of
 * `nav test list --json` and a reader of the API are looking at one thing.
 */

import type { Outcome } from "./outcome.ts";
import type { PlanStep, StepRecord } from "./steps.ts";
import type { PlanRecord, RunRecord } from "./tree.ts";

/** One step of a run as a reader sees it: the plan's step, and what was recorded for it. */
export interface ResultRow {
  number: number;
  title: string;
  /** Null when the step is known only from the run, not from a plan. */
  actions: string | null;
  expected: string | null;
  record: StepRecord | undefined;
}

/**
 * Every step of a run, in order: the plan's steps, recorded or not, and after
 * them any the run recorded that this plan does not have — a run judged
 * against a plan with fewer steps than it followed still shows everything it
 * says. Without a plan, only what the run recorded.
 */
export function resultRows(
  steps: readonly PlanStep[] | null | undefined,
  records: readonly StepRecord[],
): ResultRow[] {
  const byNumber = new Map(records.map((record) => [record.number, record]));
  const known = new Set((steps ?? []).map((step) => step.number));
  return [
    ...(steps ?? []).map((step) => ({
      number: step.number,
      title: step.title,
      actions: step.actions,
      expected: step.expected,
      record: byNumber.get(step.number),
    })),
    ...records
      .filter((record) => !known.has(record.number))
      .map((record) => ({
        number: record.number,
        title: record.title,
        actions: null,
        expected: null,
        record,
      })),
  ].sort((a, b) => a.number - b.number);
}

/**
 * The frontmatter as the file spells it, less any key that would overwrite an
 * identity field put before it: a hand-added `pr:` on a standalone run must not
 * make the projection claim a pull request the run is not in.
 */
function frontmatter(
  fm: Readonly<Record<string, unknown>>,
  identity: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fm).filter(([key]) => !identity.includes(key)));
}

/** A plan, with a summary of its runs. */
export function planJson(
  navDir: string,
  plan: PlanRecord,
  runs: { count: number; latest: { id: string; outcome: Outcome } | null },
): Record<string, unknown> {
  return {
    slug: plan.slug,
    path: `${navDir}/${plan.dirPath}`,
    ...frontmatter(plan.fm, ["slug", "path", "description", "steps", "runs", "latest"]),
    description: plan.description,
    steps: plan.steps.map(stepJson),
    runs: runs.count,
    latest: runs.latest,
  };
}

function stepJson(step: PlanStep): Record<string, unknown> {
  return { number: step.number, title: step.title, actions: step.actions, expected: step.expected };
}

/**
 * A run. With `steps`, every step of the plan it was run against, recorded or
 * not — a step with no record reads as `not-run` — which is what a reader
 * wants beside the plan; without, only what the run recorded.
 */
export function runJson(
  navDir: string,
  run: RunRecord,
  outcome: Outcome,
  steps?: readonly PlanStep[] | null,
): Record<string, unknown> {
  return {
    id: run.id,
    path: `${navDir}/${run.path}`,
    pr: run.pr?.id ?? null,
    ...frontmatter(run.fm, ["id", "path", "pr", "outcome", "notes", "results", "attachments"]),
    outcome,
    notes: run.notes,
    results: resultRows(steps, run.records).map((row) => ({
      number: row.number,
      title: row.title,
      status: row.record?.status ?? "not-run",
      actual: row.record?.actual ?? null,
    })),
    attachments: run.attachments.map((path) => `${navDir}/${path}`),
  };
}
