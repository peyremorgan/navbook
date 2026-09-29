/**
 * Plans and runs changed through the operations both front ends call —
 * `doc/spec.md` §3 to §5 and §9 — against a real repository.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import { type ExtensionParts, mergeExtensions, type WsCtx } from "@navbook/core";
import {
  activate,
  attachToRun,
  createPlan,
  editPlan,
  loadTree,
  newPlanFile,
  resolvePlan,
  resolveRun,
  saveRun,
  startRun,
  stepsAtRun,
} from "../src/core/index.ts";
import { allRuns, prRunsOf } from "../src/core/tree.ts";

const NOW = "2026-09-21T09:00:00Z";
const parts: ExtensionParts[] = [];
activate({
  core,
  manifest: { short: "tests" },
  settings: {},
  register: (part) => void parts.push(part),
});
const ext = mergeExtensions(parts);

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** A throwaway repository with a Navbook tree and one committed file. */
function inRepo(
  use: (ws: WsCtx, dir: string) => void,
  ids = "aaaa1111,bbbb2222,cccc3333,dddd4444",
): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-tests-ops-"));
  try {
    git(dir, "init", "--quiet", "-b", "main");
    git(dir, "config", "user.name", "Nav Test");
    git(dir, "config", "user.email", "nav@test.invalid");
    git(dir, "config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "app.txt"), "v1\n");
    git(dir, "add", "app.txt");
    git(dir, "commit", "-qm", "seed");
    const env = { NAV_NOW: NOW, NAV_IDS: ids };
    core.initWorkspace(core.makeWsCtx({ cwd: dir, env }), { commit: true });
    use(core.makeWsCtx({ cwd: dir, env, ext }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const STEPS = [
  { title: "Open the login page", actions: "Browse to `/login`.", expected: "The form shows." },
  { title: "Sign in", actions: "Enter the credentials.", expected: "The dashboard opens." },
];

function planText(ws: WsCtx, steps = STEPS, title = "Login flow"): string {
  return newPlanFile({
    title,
    author: core.currentAuthor(ws),
    created: core.nowIso(ws),
    description: "Needs an account.",
    steps,
  });
}

function withPlan(ws: WsCtx, steps = STEPS): void {
  createPlan(
    core,
    ws,
    { content: planText(ws, steps), slug: "login", fallbackTitle: "Login flow" },
    { commit: true },
  );
}

const lastMessage = (dir: string): string => git(dir, "log", "-1", "--format=%B");

describe("plans", () => {
  it("are created from a composed file, under a slug derived from the title", () => {
    inRepo((ws, dir) => {
      const created = createPlan(
        core,
        ws,
        { content: planText(ws), fallbackTitle: "x" },
        { commit: true },
      );
      assert.equal(created.slug, "login-flow");
      assert.equal(created.run.committed, true);
      assert.equal(lastMessage(dir), "docs(tests): create login-flow");
      const plan = resolvePlan(core, loadTree(core, ws), "login-flow");
      assert.deepEqual(plan.problems, []);
      assert.deepEqual(
        plan.steps.map((step) => step.title),
        ["Open the login page", "Sign in"],
      );
    });
  });

  it("refuse a slug in use, a slug that is not one, and a slug shaped like an ID", () => {
    inRepo((ws) => {
      withPlan(ws);
      const refused = (
        input: { slug?: string; title?: string },
        code: string,
        pattern: RegExp,
      ): void =>
        assert.throws(
          () =>
            createPlan(
              core,
              ws,
              {
                content: planText(ws, STEPS, input.title),
                ...(input.slug ? { slug: input.slug } : {}),
                fallbackTitle: "x",
              },
              {},
            ),
          (error: unknown) =>
            error instanceof core.WorkspaceError &&
            error.code === code &&
            pattern.test(error.message),
        );
      refused({ slug: "login" }, "already-exists", /test plan 'login' already exists/);
      refused({ slug: "Log In" }, "invalid-input", /not a plan's slug/);
      refused({ slug: "abcd1234" }, "invalid-input", /shaped like an ID.*choose another slug/);
      refused({ title: "abcd1234" }, "invalid-input", /shaped like an ID.*pass --slug/);
    });
  });

  it("refuse an edit made against an older version of the file", () => {
    inRepo((ws) => {
      withPlan(ws);
      const plan = resolvePlan(core, loadTree(core, ws), "login");
      const edited = planText(ws, [
        ...STEPS,
        { title: "Log out", actions: "Press it.", expected: "" },
      ]);
      assert.throws(
        () => editPlan(core, ws, "login", edited, { baseSha: "0".repeat(40) }),
        (error: unknown) => error instanceof core.WorkspaceError && error.code === "stale-content",
      );
      const result = editPlan(core, ws, "login", edited, { baseSha: plan.blobSha, commit: true });
      assert.equal(result.run.subject, "docs(tests): edit login");
      assert.equal(resolvePlan(core, loadTree(core, ws), "login").steps.length, 3);
    });
  });
});

describe("starting a run", () => {
  it("writes a run beside its plan, pinned to the plan's text and the commit tested", () => {
    inRepo((ws, dir) => {
      withPlan(ws);
      const plan = resolvePlan(core, loadTree(core, ws), "login");
      const head = git(dir, "rev-parse", "HEAD");
      const started = startRun(
        core,
        ws,
        { plan, pr: null, commit: head, version: " 1.4 ", environment: "staging" },
        { commit: true },
      );
      assert.equal(started.id, "aaaa1111");
      assert.equal(started.path, `tests/login/runs/2026-09-21T090000Z-aaaa1111.md`);
      assert.equal(lastMessage(dir), "docs(tests): run login aaaa1111");
      const run = resolveRun(core, allRuns(loadTree(core, ws)), "aaaa");
      assert.equal(run.plan, "login");
      assert.equal(run.planSha, plan.blobSha);
      assert.equal(run.steps, 2);
      assert.equal(run.author, "Nav Test <nav@test.invalid>");
      assert.equal(run.started, NOW);
      assert.equal(run.finished, null);
      assert.equal(run.commit, head);
      assert.equal(run.version, "1.4");
      assert.equal(run.environment, "staging");
      assert.deepEqual(run.problems, []);
      // The version is written so YAML reads it back as the string it is.
      assert.match(readFileSync(join(dir, ".navbook", started.path), "utf8"), /^version: "1.4"$/m);
    });
  });

  it("keeps the plan's blob, even for a plan edited and never committed", () => {
    inRepo((ws, dir) => {
      withPlan(ws);
      const path = join(dir, ".navbook/tests/login/plan.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("Sign in", "Sign in again"));
      const plan = resolvePlan(core, loadTree(core, ws), "login");
      startRun(core, ws, { plan, pr: null, version: "1.0" }, {});
      assert.match(git(dir, "cat-file", "-p", plan.blobSha), /Sign in again/);
      // Written, not staged: the author's edit is still theirs to stage.
      assert.equal(git(dir, "diff", "--name-only"), ".navbook/tests/login/plan.md");
    });
  });

  it("refuses a plan with nothing to run, a plan with faults, and a run that says nothing about what was tested", () => {
    inRepo((ws, dir) => {
      withPlan(ws);
      createPlan(core, ws, { content: planText(ws, []), slug: "empty", fallbackTitle: "x" }, {});
      const tree = loadTree(core, ws);
      const refused = (
        input: Parameters<typeof startRun>[2],
        code: string,
        pattern: RegExp,
      ): void =>
        assert.throws(
          () => startRun(core, ws, input, {}),
          (error: unknown) =>
            error instanceof core.WorkspaceError &&
            error.code === code &&
            pattern.test(error.message),
        );
      const login = resolvePlan(core, tree, "login");
      refused(
        { plan: resolvePlan(core, tree, "empty"), pr: null, version: "1" },
        "precondition",
        /has no steps/,
      );
      refused({ plan: login, pr: null }, "invalid-input", /must say what was tested/);
      refused(
        { plan: login, pr: null, version: "  " },
        "invalid-input",
        /must say what was tested/,
      );
      refused(
        { plan: login, pr: null, commit: "abc123" },
        "invalid-input",
        /'abc123' is not a commit/,
      );
      refused(
        { plan: login, pr: null, version: "1", notes: "### a step?" },
        "invalid-input",
        /the notes contains a level-3/,
      );
      const path = join(dir, ".navbook/tests/login/plan.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("#### Actions", "#### Doings"));
      refused(
        { plan: resolvePlan(core, loadTree(core, ws), "login"), pr: null, version: "1" },
        "precondition",
        /has faults/,
      );
    });
  });

  it("attaches a run to a pull request by writing it in the pull request's directory", () => {
    inRepo((ws, dir) => {
      withPlan(ws);
      git(dir, "checkout", "-qb", "feat/login");
      writeFileSync(join(dir, "app.txt"), "v2\n");
      git(dir, "commit", "-qam", "work");
      const draft = core.preparePrOpen(ws, { target: "main" });
      core.openPr(
        ws,
        {
          content: core.newPrFile({
            title: draft.title,
            author: core.currentAuthor(ws),
            created: draft.created,
            target: draft.target,
            source: draft.source,
            revisions: [draft.revision],
            body: "",
          }),
          fallbackTitle: draft.title,
        },
        { commit: true },
      );
      const tree = loadTree(core, ws);
      const pr = tree.prs[0] as core.EntityRecord;
      const started = startRun(
        core,
        ws,
        { plan: resolvePlan(core, tree, "login"), pr, commit: draft.revision.head },
        { commit: true },
      );
      assert.equal(started.path, `${pr.dirPath}/tests/2026-09-21T090000Z-${started.id}.md`);
      assert.equal(
        lastMessage(dir),
        `docs(tests): run login ${started.id} on #${pr.id}\n\nRefs: ${pr.id}`,
      );
      const again = loadTree(core, ws).prs[0] as core.EntityRecord;
      assert.equal(prRunsOf(again)[0]?.id, started.id);
    }, "pppp1111,aaaa1111");
  });
});

describe("recording a run", () => {
  /** A repository with a plan and a started run, handed to `use` with the run's id. */
  function withRun(use: (ws: WsCtx, dir: string) => void): void {
    inRepo((ws, dir) => {
      withPlan(ws);
      startRun(
        core,
        ws,
        { plan: resolvePlan(core, loadTree(core, ws), "login"), pr: null, version: "1.0" },
        { commit: true },
      );
      use(ws, dir);
    });
  }
  const current = (ws: WsCtx) => {
    const tree = loadTree(core, ws);
    return {
      run: resolveRun(core, allRuns(tree), "aaaa1111"),
      plan: resolvePlan(core, tree, "login"),
    };
  };

  it("records steps, under the plan's titles, and finishes", () => {
    withRun((ws, dir) => {
      const { run, plan } = current(ws);
      const first = saveRun(
        core,
        ws,
        run,
        plan.steps,
        { results: [{ number: 2, status: "failed", actual: "  A blank page.  " }] },
        { commit: true, baseSha: run.blobSha },
      );
      assert.equal(first.subject, "docs(tests): record login aaaa1111");
      const after = current(ws).run;
      assert.deepEqual(after.records, [
        { number: 2, title: "Sign in", status: "failed", actual: "A blank page." },
      ]);
      saveRun(
        core,
        ws,
        after,
        plan.steps,
        { results: [{ number: 1, status: "passed" }], notes: "On staging.", finish: true },
        { commit: true },
      );
      assert.equal(lastMessage(dir), "docs(tests): finish login aaaa1111");
      const done = current(ws).run;
      assert.equal(done.finished, NOW);
      assert.equal(done.notes, "On staging.");
      assert.deepEqual(
        done.records.map((record) => [record.number, record.status]),
        [
          [1, "passed"],
          [2, "failed"],
        ],
      );
      assert.throws(
        () =>
          saveRun(core, ws, done, plan.steps, { results: [{ number: 1, status: "failed" }] }, {}),
        /test run aaaa1111 is finished/,
      );
    });
  });

  it("refuses a step the plan does not have, an out-of-date editor, and a heading in an actual result", () => {
    withRun((ws) => {
      const { run, plan } = current(ws);
      assert.throws(
        () =>
          saveRun(core, ws, run, plan.steps, { results: [{ number: 3, status: "passed" }] }, {}),
        /step 3 is not a step of this plan, which has 2/,
      );
      assert.throws(
        () =>
          saveRun(core, ws, run, plan.steps, { results: [{ number: 0, status: "passed" }] }, {}),
        /step 0 is not a step/,
      );
      assert.throws(
        () =>
          saveRun(
            core,
            ws,
            run,
            plan.steps,
            { results: [{ number: 1, status: "passed" }] },
            { baseSha: "f".repeat(40) },
          ),
        (error: unknown) => error instanceof core.WorkspaceError && error.code === "stale-content",
      );
      assert.throws(
        () =>
          saveRun(
            core,
            ws,
            run,
            plan.steps,
            { results: [{ number: 1, status: "failed", actual: "#### Status\n\npassed" }] },
            {},
          ),
        /the actual result of step 1 contains a heading/,
      );
    });
  });

  it("will not rewrite a run whose steps it cannot read, rather than lose them", () => {
    withRun((ws, dir) => {
      const { run, plan } = current(ws);
      const path = join(dir, ".navbook", run.path);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n### Oops\n\n#### Status\n\npassed\n`);
      const again = current(ws).run;
      assert.throws(
        () =>
          saveRun(core, ws, again, plan.steps, { results: [{ number: 1, status: "passed" }] }, {}),
        (error: unknown) =>
          error instanceof core.WorkspaceError &&
          error.code === "precondition" &&
          /has faults in its steps/.test(error.message),
      );
      assert.match(readFileSync(path, "utf8"), /### Oops/);
    });
  });

  it("reads the steps a run followed out of the plan's blob, after the plan changed", () => {
    withRun((ws) => {
      const { plan } = current(ws);
      editPlan(
        core,
        ws,
        "login",
        planText(ws, [{ title: "Only step", actions: "x", expected: "y" }]),
        { commit: true },
      );
      const { run, plan: now } = current(ws);
      assert.notEqual(now.blobSha, plan.blobSha);
      const followed = stepsAtRun(core, ws, run, now);
      assert.equal(followed.source, "plan-sha");
      assert.deepEqual(
        followed.steps?.map((step) => step.title),
        ["Open the login page", "Sign in"],
      );
      assert.equal(stepsAtRun(core, ws, { ...run, planSha: "e".repeat(40) }, now).source, "tree");
      assert.deepEqual(stepsAtRun(core, ws, { ...run, planSha: null }, undefined), {
        steps: null,
        source: "none",
      });
    });
  });
});

describe("attachments", () => {
  it("are written byte for byte beside the run, and linked from it", () => {
    inRepo((ws, dir) => {
      withPlan(ws);
      startRun(
        core,
        ws,
        { plan: resolvePlan(core, loadTree(core, ws), "login"), pr: null, version: "1.0" },
        {},
      );
      let run = resolveRun(core, allRuns(loadTree(core, ws)), "aaaa1111");
      saveRun(
        core,
        ws,
        run,
        null,
        { results: [{ number: 1, status: "failed", actual: "Broken." }] },
        {},
      );
      run = resolveRun(core, allRuns(loadTree(core, ws)), "aaaa1111");
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
      const attached = attachToRun(
        core,
        ws,
        run,
        [
          { name: "Screen Shot 1.PNG", bytes },
          { name: "../log.txt", bytes: new TextEncoder().encode("log\n") },
        ],
        { step: 1, commit: true },
      );
      assert.deepEqual(attached.names, ["Screen-Shot-1.PNG", "log.txt"]);
      assert.equal(attached.run.subject, "docs(tests): attach login aaaa1111");
      const base = ".navbook/tests/login/runs/2026-09-21T090000Z-aaaa1111";
      assert.deepEqual([...readFileSync(join(dir, base, "Screen-Shot-1.PNG"))], [...bytes]);
      const after = resolveRun(core, allRuns(loadTree(core, ws)), "aaaa1111");
      assert.equal(
        after.records[0]?.actual,
        "Broken.\n\n![Screen-Shot-1.PNG](2026-09-21T090000Z-aaaa1111/Screen-Shot-1.PNG)\n[log.txt](2026-09-21T090000Z-aaaa1111/log.txt)",
      );
      assert.deepEqual(after.problems, []);
      assert.equal(after.attachments.length, 2);

      assert.throws(
        () => attachToRun(core, ws, after, [{ name: "log.txt", bytes }], {}),
        /already has an attachment named 'log.txt'/,
      );
      assert.throws(
        () => attachToRun(core, ws, after, [{ name: "a.txt", bytes }], { step: 2 }),
        /step 2 of test run aaaa1111 is not recorded yet/,
      );
      assert.throws(
        () => attachToRun(core, ws, after, [{ name: "..", bytes }], {}),
        /has no usable file name/,
      );
      const notes = attachToRun(core, ws, after, [{ name: "notes.txt", bytes }], {});
      assert.deepEqual(notes.names, ["notes.txt"]);
      assert.equal(
        resolveRun(core, allRuns(loadTree(core, ws)), "aaaa1111").notes,
        "[notes.txt](2026-09-21T090000Z-aaaa1111/notes.txt)",
      );
    });
  });

  it("may still be added once a run is finished, and change none of its conclusions", () => {
    inRepo((ws) => {
      withPlan(ws);
      const plan = resolvePlan(core, loadTree(core, ws), "login");
      startRun(core, ws, { plan, pr: null, version: "1.0" }, {});
      const run = () => resolveRun(core, allRuns(loadTree(core, ws)), "aaaa1111");
      saveRun(
        core,
        ws,
        run(),
        null,
        { results: [{ number: 1, status: "failed", actual: "Broken." }], finish: true },
        {},
      );
      const finished = run();
      assert.notEqual(finished.finished, null);
      const bytes = new TextEncoder().encode("trace\n");
      attachToRun(core, ws, finished, [{ name: "trace.txt", bytes }], { step: 1 });
      const after = run();
      assert.equal(after.finished, finished.finished);
      assert.deepEqual(
        after.records.map((r) => [r.number, r.status]),
        [[1, "failed"]],
      );
      assert.match(after.records[0]?.actual ?? "", /^Broken\.\n\n\[trace\.txt\]/);
      assert.deepEqual(after.problems, []);
    });
  });
});

describe("resolving a run", () => {
  it("takes an ID, a prefix, a '#', a file name or a path, and says what went wrong", () => {
    inRepo((ws) => {
      withPlan(ws);
      const plan = resolvePlan(core, loadTree(core, ws), "login");
      startRun(core, ws, { plan, pr: null, version: "1" }, {});
      startRun(core, ws, { plan, pr: null, version: "1" }, {});
      const runs = allRuns(loadTree(core, ws));
      for (const ref of [
        "aaaa1111",
        "aaaa",
        "#aaaa",
        "2026-09-21T090000Z-aaaa1111.md",
        ".navbook/tests/login/runs/2026-09-21T090000Z-aaaa1111.md",
      ]) {
        assert.equal(resolveRun(core, runs, ref).id, "aaaa1111", ref);
      }
      assert.throws(
        () => resolveRun(core, runs, "aa"),
        (e: unknown) => e instanceof core.WorkspaceError && e.code === "prefix-too-short",
      );
      assert.throws(
        () => resolveRun(core, runs, "zzzz"),
        (e: unknown) => e instanceof core.WorkspaceError && e.code === "not-found",
      );
      const both = [...runs, { ...(runs[0] as (typeof runs)[number]), id: "aaaa9999" }];
      assert.throws(
        () => resolveRun(core, both, "aaaa"),
        (e: unknown) => e instanceof core.WorkspaceError && e.code === "ambiguous",
      );
    });
  });
});
