/**
 * What a run concluded, and what a pull request's runs say — `doc/spec.md` §6.
 *
 * Never stored: an outcome is read off the steps a run records, so it cannot
 * disagree with them, and a pull request's tested state is read off its runs
 * the way its review decision is read off its reviews (02 §2.7).
 */

import type { EntityRecord } from "@navbook/core";
import { runningCore } from "./files.ts";
import type { StepRecord } from "./steps.ts";
import { prRunsOf, type RunRecord } from "./tree.ts";

export const OUTCOMES = [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "incomplete",
  "in-progress",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** A pull request's tested state: its latest revision's outcome, or none (§6). */
export const TESTED = [...OUTCOMES, "none"] as const;
export type Tested = (typeof TESTED)[number];

/**
 * The outcome of a run's records (§6).
 *
 * `total` is how many steps the plan had, or null when nobody can say — then
 * the run can be failed or blocked, but never complete.
 */
export function deriveOutcome(
  records: readonly StepRecord[],
  total: number | null,
  finished: boolean,
): Outcome {
  if (records.some((record) => record.status === "failed")) return "failed";
  if (records.some((record) => record.status === "blocked")) return "blocked";
  if (total !== null && total > 0) {
    const numbers = new Set(records.map((record) => record.number));
    let complete = true;
    for (let step = 1; step <= total; step++) {
      if (!numbers.has(step)) complete = false;
    }
    if (complete) {
      return records.every((record) => record.status === "skipped") ? "skipped" : "passed";
    }
  }
  return finished ? "incomplete" : "in-progress";
}

/**
 * The outcome of a run, its step count taken from the run itself, else from
 * whatever plan the caller could find — the one `plan-sha` names, or the one
 * in the tree (§6).
 */
export function runOutcome(run: RunRecord, planSteps?: number | null): Outcome {
  return deriveOutcome(run.records, run.steps ?? planSteps ?? null, run.finished !== null);
}

/** The head of a pull request's latest revision, or null when it records none. */
export function latestHead(pr: EntityRecord): string | null {
  const revisions = runningCore().readRevisions(pr.fm);
  return revisions[revisions.length - 1]?.head ?? null;
}

/**
 * The run a pull request's tested state is read from: its newest, by file
 * name, whose `commit` is the head of its latest revision (§6).
 */
export function latestRunFor(pr: EntityRecord): RunRecord | null {
  const head = latestHead(pr);
  if (head === null) return null;
  const runs = prRunsOf(pr).filter((run) => run.commit === head);
  return runs[runs.length - 1] ?? null;
}

/** A pull request's tested state (§6). */
export function testedOf(pr: EntityRecord): Tested {
  const run = latestRunFor(pr);
  return run === null ? "none" : runOutcome(run);
}
