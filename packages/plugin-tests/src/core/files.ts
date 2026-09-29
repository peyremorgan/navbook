/**
 * The two file types this plugin defines — `doc/spec.md` §3 and §4.
 *
 * A plan is `tests/<slug>/plan.md`; a run is a file named like a comment,
 * beside its plan or inside a pull request's directory. This module says what
 * each must carry and composes new ones; the Markdown grammar of their bodies
 * is `steps.ts`, and where they live is `tree.ts`.
 */

import type * as NavbookCore from "@navbook/core";
import type { ParsedFile, Problem } from "@navbook/core";
import {
  type PlanStep,
  planSteps,
  renderPlanBody,
  renderRunBody,
  runRecords,
  type StepRecord,
} from "./steps.ts";

/**
 * The running core, handed to `activate` and kept here.
 *
 * A *type* import of `@navbook/core` above and no value import: a plugin must
 * never resolve its own copy (see `@navbook/plugin-kb`'s `files.ts`, which
 * explains why at length). Set once, before anything below is called: every
 * entry point of this plugin runs after its own `activate`.
 */
let core: typeof NavbookCore;

/** Called by each entry's `activate` before any of these functions can be reached. */
export function useCore(host: typeof NavbookCore): void {
  core = host;
}

/** The running core, for the modules of this plugin that are not handed one. */
export function runningCore(): typeof NavbookCore {
  return core;
}

/** This plugin's directory, at the top of the root and inside a pull request's (§2). */
export const TESTS_DIR = "tests";

/** A plan's file, inside its directory. */
export const PLAN_FILE = "plan.md";

/** Where a plan's standalone runs live, inside its directory. */
export const RUNS_DIR = "runs";

/** The commit scope every change this plugin makes uses (§9). */
export const SCOPE = "tests";

/** The slug grammar of 02 §2.3, which a plan's directory name follows. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A 40-hex git object name, as `plan-sha` and `commit` hold. */
export const SHA = /^[0-9a-f]{40}$/;

/**
 * True when a name may be a plan's slug: the slug grammar, and not an ID.
 *
 * The second half is what lets a tool accept "a plan or a run" in one
 * argument (§2): a run is named by its ID, so a plan named like one would make
 * `nav test show k3m9x2q1` ambiguous.
 */
export function isPlanSlug(name: string): boolean {
  return SLUG_PATTERN.test(name) && !core.isId(name);
}

/* -------------------------------------------------------------------- plans */

/** Validate a `plan.md`: its frontmatter (§3) and its body (§3.1). */
export function validatePlan(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  core.requireString(parsed, "title", problems);
  core.checkPerson(parsed, "author", problems);
  core.checkTimestamp(parsed, "created", problems);
  core.checkNoStatusKey(parsed, problems);
  for (const fault of planSteps(parsed.body).faults) problems.push({ message: fault.message });
  return problems;
}

export interface NewPlanInput {
  title: string;
  author: string;
  created: string;
  description?: string;
  steps?: readonly { title: string; actions: string; expected?: string | null }[];
}

/** Render a new `plan.md`. */
export function newPlanFile(input: NewPlanInput): string {
  const nav = core.emptyDoc();
  core.patchDoc(nav, { title: input.title, author: input.author, created: input.created });
  nav.body = renderPlanBody(input.description ?? "", input.steps ?? []);
  return core.serializeDoc(nav);
}

/* --------------------------------------------------------------------- runs */

/** What a run's frontmatter says, read defensively: a bad value reads as absent. */
export interface RunFields {
  plan: string;
  planSha: string | null;
  steps: number | null;
  author: string;
  started: string;
  finished: string | null;
  commit: string | null;
  version: string | null;
  environment: string | null;
}

/** Read a run's frontmatter; `validateRun` is what says which values were bad. */
export function readRunFields(fm: Record<string, unknown>): RunFields {
  const text = (key: string): string | null => {
    const value = fm[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  const steps = fm.steps;
  return {
    plan: text("plan") ?? "",
    planSha: sha(fm["plan-sha"]),
    steps: typeof steps === "number" && Number.isInteger(steps) && steps >= 1 ? steps : null,
    author: text("author") ?? "",
    started: text("started") ?? "",
    finished: text("finished"),
    commit: sha(fm.commit),
    version: text("version"),
    environment: text("environment"),
  };
}

function sha(value: unknown): string | null {
  return typeof value === "string" && SHA.test(value) ? value : null;
}

/** Validate a run file: its frontmatter (§4) and its body (§4.1). */
export function validateRun(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  const fm = parsed.fm;
  const plan = core.requireString(parsed, "plan", problems);
  if (plan !== null && !SLUG_PATTERN.test(plan)) {
    problems.push({
      key: "plan",
      message: `'plan' must be a plan's slug, got ${JSON.stringify(plan)}`,
    });
  }
  for (const key of ["plan-sha", "commit"] as const) {
    const value = fm[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !SHA.test(value)) {
      problems.push({
        key,
        message: `'${key}' must be a 40-character hexadecimal hash, got ${JSON.stringify(value)}`,
      });
    }
  }
  const steps = fm.steps;
  if (steps !== undefined && steps !== null) {
    if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1) {
      problems.push({
        key: "steps",
        message: `'steps' must be a whole number of at least 1, got ${JSON.stringify(steps)}`,
      });
    }
  }
  core.checkPerson(parsed, "author", problems);
  core.checkTimestamp(parsed, "started", problems);
  if (fm.finished !== undefined && fm.finished !== null)
    core.checkTimestamp(parsed, "finished", problems);
  for (const key of ["version", "environment"] as const) {
    const value = fm[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({
        key,
        message:
          typeof value === "number"
            ? `'${key}' must be a string: quote it, as '${key}: "${String(value)}"', or YAML reads it as a number`
            : `'${key}' must be a non-empty string`,
      });
    }
  }
  const has = (key: string): boolean => fm[key] !== undefined && fm[key] !== null;
  if (!has("commit") && !has("version")) {
    problems.push({ message: "a run must say what was tested: 'commit', 'version', or both" });
  }
  core.checkNoStatusKey(parsed, problems);

  const body = runRecords(parsed.body);
  for (const fault of body.faults) problems.push({ message: fault.message });
  const count = readRunFields(fm).steps;
  if (count !== null) {
    for (const record of body.records) {
      if (record.number > count) {
        problems.push({
          message: `step ${record.number} is recorded, but the plan had ${count} step${count === 1 ? "" : "s"}`,
        });
      }
    }
  }
  return problems;
}

export interface NewRunInput {
  plan: string;
  planSha: string;
  steps: number;
  author: string;
  started: string;
  commit?: string | null;
  version?: string | null;
  environment?: string | null;
  notes?: string;
}

/** Render a new run, with nothing recorded yet. */
export function newRunFile(input: NewRunInput): string {
  const nav = core.emptyDoc();
  const fields: Record<string, unknown> = {
    plan: input.plan,
    "plan-sha": input.planSha,
    steps: input.steps,
    author: input.author,
    started: input.started,
  };
  if (input.commit) fields.commit = input.commit;
  if (input.version) fields.version = input.version;
  if (input.environment) fields.environment = input.environment;
  core.patchDoc(nav, fields);
  nav.body = renderRunBody(input.notes ?? "", []);
  return core.serializeDoc(nav);
}

export interface RunChanges {
  /** Steps to record, replacing what the run said about each of them. */
  record?: readonly StepRecord[];
  /** Replace the notes. */
  notes?: string;
  /** Set `finished` to this timestamp. */
  finished?: string;
}

/**
 * A run's text with changes applied: the frontmatter patched in place, so a
 * key a later revision of this format adds survives (02 §2.4), and the body
 * re-rendered from what it records.
 *
 * Refused for a body with faults in it: re-rendering keeps only what parsed,
 * so a block the grammar could not read would silently disappear. What the
 * author wrote is theirs to fix, and the refusal says so.
 */
export function rewriteRun(text: string, changes: RunChanges, describe: string): string {
  const nav = core.parseDoc(text);
  const current = runRecords(nav.body);
  if (current.faults.length > 0) {
    core.wsFail(
      "precondition",
      `${describe} has faults in its steps; fix them by hand before recording more`,
      current.faults.map((fault) => fault.message),
    );
  }
  if (changes.finished !== undefined) core.patchDoc(nav, { finished: changes.finished });
  const byNumber = new Map(current.records.map((record) => [record.number, record]));
  for (const record of changes.record ?? []) byNumber.set(record.number, record);
  nav.body = renderRunBody(changes.notes ?? current.notes, [...byNumber.values()]);
  return core.serializeDoc(nav);
}

/** The title a run gives a step when it records it: the plan's, at the time. */
export function recordFor(
  step: PlanStep,
  status: StepRecord["status"],
  actual: string | null,
): StepRecord {
  return {
    number: step.number,
    title: step.title,
    status,
    actual: actual !== null && actual.trim() !== "" ? actual.trim() : null,
  };
}
