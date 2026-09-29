/**
 * Plans and runs read out of a tree — `doc/spec.md` §2 to §8.
 *
 * Everything here runs over an in-memory tree, the way the scan of another
 * branch does: what the plugin concludes about a run must not depend on
 * whether the files came from a checkout, the index or somebody else's branch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import {
  type CoreExtensions,
  type DoctorTools,
  type ExtensionParts,
  mergeExtensions,
  type NavTree,
  parseQuery,
  parseTree,
  validateRepo,
} from "@navbook/core";
import { activate } from "../src/core/index.ts";
import { deriveOutcome, latestRunFor, runOutcome, testedOf } from "../src/core/outcome.ts";
import type { StepRecord } from "../src/core/steps.ts";
import { allRuns, prRunsOf, runsOfPlan, testsOf } from "../src/core/tree.ts";
import { HEAD1, HEAD2, plan, pr, run, runName } from "./fixtures.ts";

function extensions(): CoreExtensions {
  const parts: ExtensionParts[] = [];
  activate({
    core,
    manifest: { short: "tests" },
    settings: {},
    register: (part) => void parts.push(part),
  });
  return mergeExtensions(parts);
}

const ext = extensions();
const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));
const PR_DIR = "prs/open/dk3mp2x9-auth";

describe("reading tests/", () => {
  it("reads plans, their standalone runs and the runs' attachments", () => {
    const standalone = runName("2026-09-20T101500Z", "r7k2m9x1");
    const repo = parseTree(
      tree({
        "tests/login/plan.md": plan(),
        [`tests/login/runs/${standalone}.md`]: run(),
        [`tests/login/runs/${standalone}/console.png`]: "\u0089PNG",
        "tests/login/notes.txt": "kept",
      }),
      { ext },
    );
    const tests = testsOf(repo);
    assert.deepEqual(repo.extProblems.get("tests") ?? [], []);
    const login = tests.planBySlug.get("login");
    assert.equal(login?.title, "Login flow");
    assert.equal(login?.steps.length, 2);
    assert.deepEqual(login?.problems, []);
    assert.deepEqual(login?.extraFiles, ["tests/login/notes.txt"]);
    const [only] = login?.runs ?? [];
    assert.equal(only?.id, "r7k2m9x1");
    assert.equal(only?.pr, null);
    assert.equal(only?.attachmentsDir, `tests/login/runs/${standalone}`);
    assert.deepEqual(only?.attachments, [`tests/login/runs/${standalone}/console.png`]);
    assert.deepEqual(only?.problems, []);
    assert.equal(only?.steps, 2);
    assert.equal(only?.commit, HEAD1);
    // Routed to the plugin: not an uninterpreted path.
    assert.deepEqual(repo.reserved, []);
  });

  const layout = (entries: Record<string, string>): string[] =>
    (parseTree(tree(entries), { ext }).extProblems.get("tests") ?? []).map(
      (problem) => `${problem.path}: ${problem.message}`,
    );

  it("reports what does not fit the layout", () => {
    assert.deepEqual(layout({ "tests/loose.md": "x" }), [
      "tests/loose.md: 'tests/' must contain plan directories, not files",
    ]);
    assert.deepEqual(layout({ "tests/Login/plan.md": plan(), "tests/Login/runs/x.md": "y" }), [
      "tests/Login: plan directory name 'Login' does not match the slug grammar",
    ]);
    assert.deepEqual(layout({ "tests/abcd1234/plan.md": plan() }), [
      "tests/abcd1234: plan directory name 'abcd1234' is shaped like an ID, which would read as a run's",
    ]);
    assert.deepEqual(layout({ "tests/login/runs/notes.md": "x", "tests/login/plan.md": plan() }), [
      "tests/login/runs/notes.md: 'notes.md' is not a run: a run is named <timestamp>-<id>.md",
    ]);
    assert.deepEqual(
      layout({ "tests/login/runs/shots/a.png": "x", "tests/login/plan.md": plan() }),
      ["tests/login/runs/shots/a.png: 'shots/' is neither a run nor a run's attachments"],
    );
    const orphan = runName("2026-09-20T101500Z", "r7k2m9x1");
    assert.deepEqual(
      layout({ [`tests/login/runs/${orphan}/a.png`]: "x", "tests/login/plan.md": plan() }),
      [
        `tests/login/runs/${orphan}: attachments for a run that does not exist: no ${orphan}.md beside them`,
      ],
    );
    assert.deepEqual(layout({ "tests/login/notes.md": "x" }), [
      "tests/login: plan directory is missing its plan.md",
    ]);
  });

  it("does not read an archived copy of tests/", () => {
    const repo = parseTree(tree({ "archive/2025/tests/login/plan.md": plan() }), { ext });
    assert.deepEqual(testsOf(repo).plans, []);
    assert.deepEqual(repo.reserved, ["archive/2025/tests/login/plan.md"]);
  });
});

describe("runs attached to a pull request", () => {
  const first = runName("2026-09-21T090000Z", "t3w8p1q4");
  const second = runName("2026-09-21T100000Z", "t9w8p1q4");

  it("are read into the pull request's own record, with their attachments", () => {
    const repo = parseTree(
      tree({
        "tests/login/plan.md": plan(),
        [`${PR_DIR}/pr.md`]: pr(),
        [`${PR_DIR}/tests/${first}.md`]: run(),
        [`${PR_DIR}/tests/${first}/shot.png`]: "png",
      }),
      { ext },
    );
    const [record] = repo.prs;
    const runs = prRunsOf(record as core.EntityRecord);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]?.pr, { id: "dk3mp2x9", dirPath: PR_DIR });
    assert.deepEqual(runs[0]?.attachments, [`${PR_DIR}/tests/${first}/shot.png`]);
    assert.deepEqual(record?.extraFiles, []);
    assert.deepEqual(
      allRuns(repo).map((r) => r.id),
      ["t3w8p1q4"],
    );
    assert.deepEqual(
      runsOfPlan(repo, "login").map((r) => r.id),
      ["t3w8p1q4"],
    );
  });

  it("are the plugin's only in a pull request: an issue's tests/ is an extra file", () => {
    const repo = parseTree(
      tree({
        "issues/open/ab12cd34-bug/issue.md":
          "---\ntitle: Bug\nauthor: a@b.c\ncreated: 2026-09-20T10:00:00Z\n---\n",
        [`issues/open/ab12cd34-bug/tests/${first}.md`]: run(),
      }),
      { ext },
    );
    assert.deepEqual(repo.issues[0]?.extraFiles, [`issues/open/ab12cd34-bug/tests/${first}.md`]);
    assert.deepEqual(allRuns(repo), []);
  });

  it("travel with an archived pull request", () => {
    const dir = "archive/2025/prs/merged/dk3mp2x9-auth";
    const repo = parseTree(tree({ [`${dir}/pr.md`]: pr(), [`${dir}/tests/${first}.md`]: run() }), {
      ext,
    });
    assert.equal(prRunsOf(repo.prs[0] as core.EntityRecord)[0]?.id, "t3w8p1q4");
  });

  it("report a file that is not a run", () => {
    const repo = parseTree(tree({ [`${PR_DIR}/pr.md`]: pr(), [`${PR_DIR}/tests/notes.md`]: "x" }), {
      ext,
    });
    assert.deepEqual(
      repo.extProblems.get("tests")?.map((problem) => problem.message),
      ["'notes.md' is not a run: a run is named <timestamp>-<id>.md"],
    );
  });

  it("give the pull request a tested state from its latest revision's newest run", () => {
    const passed = run({
      commit: HEAD2,
      results: [
        [1, "passed"],
        [2, "passed"],
      ],
    });
    const failed = run({ commit: HEAD2, results: [[1, "failed"]], finished: true });
    const older = run({ commit: HEAD1, results: [[1, "failed"]] });
    const read = (files: Record<string, string>): core.EntityRecord =>
      parseTree(tree({ [`${PR_DIR}/pr.md`]: pr([HEAD1, HEAD2]), ...files }), { ext })
        .prs[0] as core.EntityRecord;

    assert.equal(testedOf(read({})), "none");
    // A run against an earlier revision says nothing about this one.
    assert.equal(testedOf(read({ [`${PR_DIR}/tests/${first}.md`]: older })), "none");
    assert.equal(testedOf(read({ [`${PR_DIR}/tests/${first}.md`]: passed })), "passed");
    // Newest by file name wins.
    const both = read({
      [`${PR_DIR}/tests/${first}.md`]: passed,
      [`${PR_DIR}/tests/${second}.md`]: failed,
    });
    assert.equal(latestRunFor(both)?.id, "t9w8p1q4");
    assert.equal(testedOf(both), "failed");
    // A run that names only a version is bound to no revision.
    assert.equal(
      testedOf(read({ [`${PR_DIR}/tests/${first}.md`]: run({ commit: null, version: "1.0" }) })),
      "none",
    );
  });

  it("answer the tested: term, which ORs when repeated", () => {
    const entity = parseTree(
      tree({
        [`${PR_DIR}/pr.md`]: pr([HEAD1]),
        [`${PR_DIR}/tests/${first}.md`]: run({ results: [[1, "blocked"]] }),
      }),
      { ext },
    ).prs[0] as core.EntityRecord;
    const matches = (...terms: string[]): boolean => {
      const query = parseQuery(terms, "pr", ext);
      assert.ok(!("message" in query), JSON.stringify(query));
      return core.matchesQuery(query as core.Query, entity, core.DEFAULT_REVIEW_POLICY, ext);
    };
    assert.equal(matches("tested:blocked"), true);
    assert.equal(matches("tested:BLOCKED"), true);
    assert.equal(matches("tested:passed"), false);
    assert.equal(matches("tested:failed", "tested:blocked"), true);
    const refused = parseQuery(["tested:green"], "pr", ext);
    assert.ok("message" in refused);
    assert.match(
      String((refused as { message: string }).message),
      /'tested:green' is not a tested state/,
    );
  });
});

describe("a run's outcome", () => {
  const rec = (number: number, status: StepRecord["status"]): StepRecord => ({
    number,
    title: "",
    status,
    actual: null,
  });

  it("follows the order of the specification", () => {
    const cases: [StepRecord[], number | null, boolean, string][] = [
      [[rec(1, "passed"), rec(2, "failed")], 3, false, "failed"],
      [[rec(1, "blocked"), rec(2, "failed")], 2, true, "failed"],
      [[rec(1, "blocked"), rec(2, "passed")], 2, true, "blocked"],
      [[rec(1, "passed"), rec(2, "skipped")], 2, false, "passed"],
      [[rec(1, "skipped"), rec(2, "skipped")], 2, false, "skipped"],
      [[rec(1, "passed")], 2, true, "incomplete"],
      [[rec(1, "passed")], 2, false, "in-progress"],
      [[], 2, false, "in-progress"],
      [[], 2, true, "incomplete"],
      // Nobody can say how many steps there were: never complete.
      [[rec(1, "passed")], null, true, "incomplete"],
      [[rec(1, "failed")], null, false, "failed"],
      // Recorded out of order, or with a gap, is not complete.
      [[rec(2, "passed"), rec(3, "passed")], 3, true, "incomplete"],
    ];
    for (const [records, total, finished, outcome] of cases) {
      assert.equal(
        deriveOutcome(records, total, finished),
        outcome,
        JSON.stringify({ records, total, finished }),
      );
    }
  });

  it("takes its step count from the run, then from the plan the caller found", () => {
    const repo = parseTree(
      tree({
        "tests/login/plan.md": plan(),
        [`tests/login/runs/${runName("2026-09-20T101500Z", "r7k2m9x1")}.md`]: run({
          steps: null,
          results: [
            [1, "passed"],
            [2, "passed"],
          ],
        }),
      }),
      { ext },
    );
    const [only] = allRuns(repo);
    assert.equal(runOutcome(only as never), "in-progress");
    assert.equal(runOutcome(only as never, 2), "passed");
    assert.equal(runOutcome(only as never, 3), "in-progress");
  });
});

describe("checks", () => {
  const diagnostics = (entries: Record<string, string>, tools?: DoctorTools): string[] =>
    validateRepo(parseTree(tree(entries), { ext }), { ext, ...(tools ? { tools } : {}) })
      .filter((d) => d.check.startsWith("X-tests"))
      .map((d) => `${d.check} ${d.path}: ${d.message}`);
  const name = runName("2026-09-20T101500Z", "r7k2m9x1");
  const at = `tests/login/runs/${name}.md`;

  it("say nothing about a sound tree", () => {
    assert.deepEqual(diagnostics({ "tests/login/plan.md": plan(), [at]: run() }), []);
  });

  it("X-tests-1: every fault in a plan's or a run's file", () => {
    assert.deepEqual(diagnostics({ "tests/login/plan.md": plan({ title: null }) }), [
      "X-tests-1 tests/login/plan.md: missing required key 'title'",
    ]);
    assert.deepEqual(
      diagnostics({
        "tests/login/plan.md": plan(),
        [at]: run({ commit: null, version: null, results: [[3, "passed"]] }),
      }),
      [
        `X-tests-1 ${at}: a run must say what was tested: 'commit', 'version', or both`,
        `X-tests-1 ${at}: step 3 is recorded, but the plan had 2 steps`,
      ],
    );
    assert.deepEqual(
      diagnostics({ "tests/login/plan.md": plan(), [at]: run({ raw: "version: 1.10" }) }),
      [
        `X-tests-1 ${at}: 'version' must be a string: quote it, as 'version: "1.1"', or YAML reads it as a number`,
      ],
    );
    assert.deepEqual(
      diagnostics({ "tests/login/plan.md": plan(), [at]: run({ raw: "steps: 0", steps: null }) }),
      [`X-tests-1 ${at}: 'steps' must be a whole number of at least 1, got 0`],
    );
    assert.deepEqual(
      diagnostics({ "tests/login/plan.md": plan(), [at]: run({ raw: "status: passed" }) }),
      [`X-tests-1 ${at}: entity files must not carry a 'status' key; status is the path (§2.1)`],
    );
  });

  it("X-tests-1: a fault in a pull request's run too", () => {
    assert.deepEqual(
      diagnostics({
        [`${PR_DIR}/pr.md`]: pr(),
        [`${PR_DIR}/tests/${name}.md`]: run({ plan: "Bad Slug" }),
      }).filter((line) => line.startsWith("X-tests-1")),
      [`X-tests-1 ${PR_DIR}/tests/${name}.md: 'plan' must be a plan's slug, got "Bad Slug"`],
    );
  });

  it("X-tests-2: a dangling plan, and a pull request's run against no revision of it", () => {
    assert.deepEqual(
      diagnostics({
        [`${PR_DIR}/pr.md`]: pr([HEAD1]),
        [`${PR_DIR}/tests/${name}.md`]: run({ commit: HEAD2 }),
      }),
      [
        `X-tests-2 ${PR_DIR}/tests/${name}.md: commit ${HEAD2.slice(0, 12)} is none of #dk3mp2x9's revisions`,
        `X-tests-2 ${PR_DIR}/tests/${name}.md: test plan 'login' does not exist in this tree`,
      ],
    );
  });

  it("X-tests-2: what history says, when there is history to ask", () => {
    const planText = plan();
    const planSha = core.blobSha(planText);
    const tools = (blobs: Record<string, string>, commits: string[]): DoctorTools => ({
      readBlob: (sha) => blobs[sha] ?? null,
      commitExists: (sha) => commits.includes(sha),
    });
    const entries = { "tests/login/plan.md": planText, [at]: run({ planSha }) };
    assert.deepEqual(diagnostics(entries, tools({ [planSha]: planText }, [HEAD1])), []);
    assert.deepEqual(diagnostics(entries, tools({}, [])), [
      `X-tests-2 ${at}: commit ${HEAD1.slice(0, 12)} is not in this repository`,
      `X-tests-2 ${at}: plan-sha ${planSha.slice(0, 12)} names no plan this repository holds`,
    ]);
    // Without history, nothing is said about it.
    assert.deepEqual(diagnostics(entries), []);
    const threeSteps = plan({ steps: 3 });
    assert.deepEqual(
      diagnostics(
        { "tests/login/plan.md": planText, [at]: run({ planSha: core.blobSha(threeSteps) }) },
        tools({ [core.blobSha(threeSteps)]: threeSteps }, [HEAD1]),
      ),
      [`X-tests-2 ${at}: 'steps: 2' disagrees with the plan plan-sha names, which has 3`],
    );
  });

  it("X-tests-3: a run ID that is also a comment's, or another run's", () => {
    const shared = "t5kr1gq6";
    const entries = {
      "tests/login/plan.md": plan(),
      "issues/open/ab12cd34-bug/issue.md":
        "---\ntitle: Bug\nauthor: a@b.c\ncreated: 2026-09-20T10:00:00Z\n---\n",
      [`issues/open/ab12cd34-bug/comments/2026-09-20T101500Z-${shared}.md`]:
        "---\nauthor: a@b.c\n---\n\nHi.\n",
      [`tests/login/runs/${runName("2026-09-20T101500Z", shared)}.md`]: run(),
      [`tests/login/runs/${runName("2026-09-21T101500Z", "r7k2m9x1")}.md`]: run(),
      [`tests/login/runs/${runName("2026-09-22T101500Z", "r7k2m9x1")}.md`]: run(),
    };
    assert.deepEqual(diagnostics(entries), [
      `X-tests-3 tests/login/runs/${runName("2026-09-20T101500Z", shared)}.md: the ID ${shared} is also issues/open/ab12cd34-bug/comments/2026-09-20T101500Z-${shared}.md's; IDs must be unique across the repository`,
      `X-tests-3 tests/login/runs/${runName("2026-09-22T101500Z", "r7k2m9x1")}.md: the ID r7k2m9x1 is also tests/login/runs/${runName("2026-09-21T101500Z", "r7k2m9x1")}.md's; IDs must be unique across the repository`,
    ]);
  });
});
