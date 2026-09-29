/**
 * Test plans and runs: the format half — `doc/spec.md`.
 *
 * Registers where the data lives (`tests/` at the top of the root, and inside
 * every pull request's directory), the `tested:` query term, and the three
 * checks. Everything a front end does with plans and runs is exported from
 * here too, since the CLI and the API share it.
 */

import type { CorePluginHost, DoctorTools, EntityRecord, Repo } from "@navbook/core";
import { runningCore, SCOPE, TESTS_DIR, useCore } from "./files.ts";
import { TESTED, type Tested, testedOf } from "./outcome.ts";
import { planSteps } from "./steps.ts";
import {
  allRuns,
  buildPrRuns,
  buildTests,
  readsPrPath,
  type TestsReader,
  testsOf,
} from "./tree.ts";

/** A diagnostic in the shape a registered check returns. */
type Found = { check: string; level: "error" | "warning"; path: string; message: string };

export function activate(host: CorePluginHost): void {
  const { core } = host;
  // Before anything else: the format helpers take the running core from here.
  useCore(core);
  const reader: TestsReader = { parse: (text) => core.parseFile(text), hash: core.blobSha };

  host.register({
    treeLocations: [{ dir: TESTS_DIR, build: (files, paths) => buildTests(files, paths, reader) }],
    entityLocations: [
      {
        dir: TESTS_DIR,
        kinds: ["pr"],
        reads: readsPrPath,
        build: (files, entity, paths) => buildPrRuns(files, entity, paths, reader),
      },
    ],
    queryKeys: [
      {
        key: "tested",
        kinds: ["pr"],
        parse: (value) => {
          const word = value.toLowerCase();
          return (TESTED as readonly string[]).includes(word)
            ? word
            : {
                message: `'tested:${value}' is not a tested state; expected one of ${TESTED.join(", ")}`,
              };
        },
        // A pull request has one tested state, so repeating the term ORs:
        // `tested:failed tested:blocked` is "the ones that did not pass".
        matches: (values, entity: EntityRecord) => values.includes(testedOf(entity) as Tested),
      },
    ],
    doctorChecks: [
      { id: "X-tests-1", level: "error", run: (repo) => layoutAndSchema(repo) },
      { id: "X-tests-2", level: "warning", run: (repo, tools) => unresolved(repo, tools) },
      { id: "X-tests-3", level: "error", run: (repo) => idCollisions(repo) },
    ],
    commitScopes: [SCOPE],
  });
}

/** X-tests-1: the layout of `tests/`, and every plan's and run's own faults. */
function layoutAndSchema(repo: Repo): Found[] {
  const out: Found[] = (repo.extProblems.get(TESTS_DIR) ?? []).map((problem) => ({
    check: "X-tests-1",
    level: "error",
    path: problem.path,
    message: problem.message,
  }));
  const report = (path: string, messages: readonly { message: string }[]): void => {
    for (const { message } of messages)
      out.push({ check: "X-tests-1", level: "error", path, message });
  };
  for (const plan of testsOf(repo).plans) report(plan.filePath, plan.problems);
  for (const run of allRuns(repo)) report(run.path, run.problems);
  return out;
}

/**
 * X-tests-2: what a branch nobody has fetched might yet explain. The history
 * half runs only where `nav doctor` has history to ask.
 */
function unresolved(repo: Repo, tools: DoctorTools | undefined): Found[] {
  const out: Found[] = [];
  const warn = (path: string, message: string): void => {
    out.push({ check: "X-tests-2", level: "warning", path, message });
  };
  const plans = testsOf(repo).planBySlug;
  const heads = new Map<string, Set<string>>(
    repo.prs.map((pr) => [
      pr.id,
      new Set(
        runningCore()
          .readRevisions(pr.fm)
          .map((revision) => revision.head),
      ),
    ]),
  );
  const stepCounts = new Map<string, number | null>();
  for (const run of allRuns(repo)) {
    if (run.plan !== "" && !plans.has(run.plan))
      warn(run.path, `test plan '${run.plan}' does not exist in this tree`);
    if (run.pr !== null && run.commit !== null && !heads.get(run.pr.id)?.has(run.commit)) {
      warn(run.path, `commit ${run.commit.slice(0, 12)} is none of #${run.pr.id}'s revisions`);
    }
    if (tools === undefined) continue;
    if (run.commit !== null && !tools.commitExists(run.commit)) {
      warn(run.path, `commit ${run.commit.slice(0, 12)} is not in this repository`);
    }
    if (run.planSha === null) continue;
    if (!stepCounts.has(run.planSha))
      stepCounts.set(run.planSha, planStepCount(tools, run.planSha));
    const count = stepCounts.get(run.planSha) ?? null;
    if (count === null) {
      warn(run.path, `plan-sha ${run.planSha.slice(0, 12)} names no plan this repository holds`);
    } else if (run.steps !== null && run.steps !== count) {
      warn(
        run.path,
        `'steps: ${run.steps}' disagrees with the plan plan-sha names, which has ${count}`,
      );
    }
  }
  return out;
}

/** How many steps the plan a blob holds has, or null when there is no such blob. */
function planStepCount(tools: DoctorTools, sha: string): number | null {
  const text = tools.readBlob(sha);
  if (text === null) return null;
  try {
    return planSteps(runningCore().parseFile(text).body).steps.length;
  } catch {
    return null;
  }
}

/** X-tests-3: a run ID that is also another run's, an entity's or a comment's. */
function idCollisions(repo: Repo): Found[] {
  const owners = new Map<string, string>();
  for (const { id, path } of runningCore().allIds(repo)) if (!owners.has(id)) owners.set(id, path);
  const out: Found[] = [];
  for (const run of allRuns(repo)) {
    const other = owners.get(run.id);
    if (other === undefined) {
      owners.set(run.id, run.path);
      continue;
    }
    out.push({
      check: "X-tests-3",
      level: "error",
      path: run.path,
      message: `the ID ${run.id} is also ${other}'s; IDs must be unique across the repository`,
    });
  }
  return out;
}

export * from "./files.ts";
export * from "./json.ts";
export * from "./ops.ts";
export * from "./outcome.ts";
export * from "./steps.ts";
export * from "./tree.ts";
