/**
 * The canonical JSON projection of a plan and a run — spec 04 §4.2.
 *
 * Identity first, then the frontmatter as the file spells it, then what is
 * derived: the order every other `--json` projection uses, so a reader of
 * `nav test list --json` and a reader of the API are looking at one thing.
 */

import type { Outcome } from "./outcome.ts";
import type { PlanStep } from "./steps.ts";
import type { PlanRecord, RunRecord } from "./tree.ts";

/** A plan, with a summary of its runs. */
export function planJson(
  navDir: string,
  plan: PlanRecord,
  runs: { count: number; latest: { id: string; outcome: Outcome } | null },
): Record<string, unknown> {
  return {
    slug: plan.slug,
    path: `${navDir}/${plan.dirPath}`,
    ...plan.fm,
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
  const byNumber = new Map(run.records.map((record) => [record.number, record]));
  return {
    id: run.id,
    path: `${navDir}/${run.path}`,
    pr: run.pr?.id ?? null,
    ...run.fm,
    outcome,
    notes: run.notes,
    results:
      steps === undefined || steps === null
        ? run.records.map((record) => ({
            number: record.number,
            title: record.title,
            status: record.status,
            actual: record.actual,
          }))
        : steps.map((step) => ({
            number: step.number,
            title: step.title,
            status: byNumber.get(step.number)?.status ?? "not-run",
            actual: byNumber.get(step.number)?.actual ?? null,
          })),
    attachments: run.attachments.map((path) => `${navDir}/${path}`),
  };
}
