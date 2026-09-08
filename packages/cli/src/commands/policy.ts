/**
 * Saying what the review policy counts, and what it is short of.
 *
 * Shared by every verb that reads the policy, so a pull request short of two
 * approvals is described in the same words wherever it is mentioned. Nothing
 * here refuses anything: spec 02 §2.7 forbids acting on a review state, and
 * §2.10 keeps a declared policy inside that. These are sentences, not gates.
 */

import { NAV_MARKER, type ReviewPolicyReading, type ReviewSummary } from "@navbook/core";
import type { Ctx } from "../context.ts";

/** Warn about a marker whose policy could not be read; D15 is the full report. */
export function warnPolicyProblems(ctx: Ctx, reading: ReviewPolicyReading): void {
  for (const problem of reading.problems) {
    ctx.stderr.write(
      `${ctx.colors.yellow("warning:")} ${ctx.navDir}/${NAV_MARKER}: ${problem}; using the default\n`,
    );
  }
}

/**
 * What stands between a pull request and its policy, or null when nothing does.
 *
 * Only asked of a repository that declared a policy: a decision of `pending`
 * where nobody asked for anything is not a shortfall, and saying so on every
 * merge would be noise about a project that never opted in.
 */
export function describeShortfall(summary: ReviewSummary): string | null {
  const blockers = summary.reviewers
    .filter((entry) => entry.state === "request-changes")
    .map((entry) => entry.person);
  if (blockers.length > 0) return `changes requested by ${blockers.join(", ")}`;

  const { given, required } = summary.approvals;
  if (given >= required) return null;
  return `${given} of ${required} required approval${required === 1 ? "" : "s"}`;
}

/** What a merge should do about a shortfall, before anything is written. */
export type MergeAction = "proceed" | "warn-and-proceed" | "ask";

export interface MergeSituation {
  /** What the pull request is short of, or null when it is short of nothing. */
  shortfall: string | null;
  /** `--yes` was given. */
  assumeYes: boolean;
  /** There is somebody at a terminal to answer a question. */
  interactive: boolean;
}

/**
 * Decide how a merge should treat an unmet policy.
 *
 * Kept apart from the merge itself so every combination can be checked without
 * a repository or a terminal, and so the one rule that matters is visible in
 * one place: no combination returns a refusal. `--yes` proceeds, a terminal is
 * asked, and everything else says its piece and proceeds — because a pipeline
 * that stopped for a question nobody can answer would be the gate spec 02 §2.7
 * forbids, arrived at by accident rather than on purpose.
 */
export function mergeAction(situation: MergeSituation): MergeAction {
  if (situation.shortfall === null || situation.assumeYes) return "proceed";
  return situation.interactive ? "ask" : "warn-and-proceed";
}
