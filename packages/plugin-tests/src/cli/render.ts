/**
 * How plans and runs read in a terminal: the same labels, dim headings and
 * padding every built-in `show` uses, so a plugin's output does not look
 * bolted on.
 */

import type { Outcome } from "../core/outcome.ts";
import type { PlanStep, StepRecord } from "../core/steps.ts";
import type { PlanRecord, RunRecord } from "../core/tree.ts";
import { indent } from "./interactive.ts";

/** The colours a `Ctx` carries; only these are used. */
export interface Paint {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
}

/** An outcome or a step's status, coloured by what it means for the change. */
export function paintState(
  state: Outcome | StepRecord["status"] | "not run" | "none",
  c: Paint,
): string {
  switch (state) {
    case "passed":
      return c.green(state);
    case "failed":
      return c.red(state);
    case "blocked":
    case "incomplete":
    case "in-progress":
      return c.yellow(state);
    default:
      return c.dim(state);
  }
}

/** A label column, as `nav issue show` lays its fields out. */
export function label(text: string, c: Paint): string {
  return c.dim(`${text}:`.padEnd(13));
}

/** What a run says it tested, briefly: the commit's first twelve characters, the version, or both. */
export function tested(run: RunRecord): string {
  const parts = [run.commit === null ? null : `@${run.commit.slice(0, 12)}`, run.version];
  return parts.filter((part): part is string => part !== null).join(" ") || "-";
}

/** The person part of `Name <address>`, for a column that has little room. */
export function personName(person: string): string {
  const match = person.match(/^(.*?)\s*<[^>]*>$/);
  return match?.[1]?.trim() || person;
}

/**
 * A section's text under its label, one line per element: a caller indents
 * each element, and would otherwise shift only the first line of a paragraph.
 */
function block(text: string): string[] {
  return indent(text, "     ").split("\n");
}

/** A plan's steps, numbered, with their actions and expected results. */
export function renderSteps(steps: readonly PlanStep[], c: Paint): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(`${c.bold(`${step.number}.`)} ${step.title}`);
    lines.push(`   ${c.dim("actions:")}`, ...block(step.actions || "(none)"));
    if (step.expected === null) lines.push(`   ${c.dim("(a setup step: nothing to check)")}`);
    else lines.push(`   ${c.dim("expected:")}`, ...block(step.expected || "(nothing written)"));
  }
  return lines;
}

/**
 * A run's steps beside its plan's: every step, recorded or not, and what the
 * tester observed. The expected result is repeated for a step that did not
 * pass, which is exactly where the reader needs both side by side.
 */
export function renderResults(
  steps: readonly PlanStep[] | null,
  records: readonly StepRecord[],
  c: Paint,
): string[] {
  const byNumber = new Map(records.map((record) => [record.number, record]));
  const rows =
    steps === null
      ? records.map((record) => ({
          number: record.number,
          title: record.title,
          expected: null as string | null,
        }))
      : steps.map((step) => ({ number: step.number, title: step.title, expected: step.expected }));
  const lines: string[] = [];
  for (const row of rows) {
    const record = byNumber.get(row.number);
    lines.push(
      `${c.bold(`${row.number}.`)} ${row.title}  ${paintState(record?.status ?? "not run", c)}`,
    );
    if (record === undefined) continue;
    if (record.status !== "passed" && row.expected !== null && row.expected !== "") {
      lines.push(`   ${c.dim("expected:")}`, ...block(row.expected));
    }
    if (record.actual !== null) lines.push(`   ${c.dim("actual:")}`, ...block(record.actual));
  }
  return lines;
}

/** One run as a listing row: ID, plan, outcome, when, who, where, what. */
export function runRow(run: RunRecord, outcome: Outcome): string[] {
  return [
    run.id,
    run.plan,
    outcome,
    run.started,
    personName(run.author),
    run.pr === null ? "-" : `#${run.pr.id}`,
    tested(run),
  ];
}

/** The listing's columns, matching {@link runRow}. */
export const RUN_COLUMNS = [
  { header: "id" },
  { header: "plan" },
  { header: "outcome" },
  { header: "started" },
  { header: "tester", flexible: true, minWidth: 10 },
  { header: "pr" },
  { header: "tested" },
] as const;

/** A plan's header lines, before its description and steps. */
export function planHeader(navDir: string, plan: PlanRecord, c: Paint): string[] {
  const lines = [c.bold(plan.slug), ""];
  lines.push(`${label("title", c)}${plan.title}`);
  if (typeof plan.fm.author === "string") lines.push(`${label("author", c)}${plan.fm.author}`);
  if (typeof plan.fm.created === "string") lines.push(`${label("created", c)}${plan.fm.created}`);
  lines.push(`${label("path", c)}${navDir}/${plan.dirPath}`);
  return lines;
}
