/**
 * Plans and runs over the API — `doc/spec.md`, spec 06 §6.3.
 *
 * One server for the suite, as a deployment has: a pull request on the served
 * branch, and one that only another branch carries. The cases run in order and
 * build on each other, the way a person using the web client would.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blobSha } from "@navbook/core";
import {
  errorCode,
  type Harness,
  ok,
  originSubjects,
  startHarness,
} from "@navbook/server/test-helpers";

const ENV = { NAVBOOK_PLUGIN_PATH: join(dirname(fileURLToPath(import.meta.url)), "..") };

// biome-ignore lint/suspicious/noExplicitAny: test payloads are read positionally
type Payload = any;

const PLAN_FIELDS = `slug title author created description path baseSha
  steps { number title actions expected }
  stats { runs passed failed blocked skipped incomplete inProgress }`;
const RUN_FIELDS = `id path planSlug planSha author started finished commit version environment notes
  outcome stepsFrom baseSha
  results { number title actions expected status actual }
  attachments { name path }
  pr { id }
  plan { slug }`;

const CREATE = `mutation($input: CreateTestPlanInput!) {
  createTestPlan(input: $input) { plan { ${PLAN_FIELDS} } commit { committed subject pushed } }
}`;
const UPDATE = `mutation($input: UpdateTestPlanInput!) {
  updateTestPlan(input: $input) { plan { ${PLAN_FIELDS} } commit { committed subject pushed } }
}`;
const START = `mutation($input: StartTestRunInput!) {
  startTestRun(input: $input) { run { ${RUN_FIELDS} } commit { committed subject pushed } }
}`;
const SAVE = `mutation($input: SaveTestRunInput!) {
  saveTestRun(input: $input) { run { ${RUN_FIELDS} } commit { committed subject pushed } }
}`;
const ATTACH = `mutation($input: AttachToTestRunInput!) {
  attachToTestRun(input: $input) { run { ${RUN_FIELDS} } names commit { subject } }
}`;
const RUN = `query($id: ID!) { testRun(id: $id) { ${RUN_FIELDS} pr { id refs } } }`;
const ATTACHMENT = `query($run: ID!, $name: String!) {
  testAttachment(run: $run, name: $name) { name contentType size base64 }
}`;

const STEPS = [
  { title: "Open the login page", actions: "Browse to `/login`.", expected: "The form shows." },
  { title: "Sign in", actions: "Enter the credentials.", expected: "The dashboard opens." },
  { title: "Log out", actions: "Press **Log out**." },
];

describe("test plans and runs over the API", () => {
  let h: Harness;
  let served: string;

  before(async () => {
    h = await startHarness({
      env: ENV,
      pullIntervalMs: 0,
      prepare: (fixture) => {
        // A pull request merged into the served branch's tree, and one that
        // only its own branch carries.
        fixture.peer.filePr("Served", "On main.", "pr111111", "served");
        const pushed = fixture.peer.git(["push", "--quiet", "origin", "served:main"]);
        assert.equal(pushed.code, 0, pushed.stderr);
        fixture.peer.filePr("Elsewhere", "On a branch.", "pr222222", "elsewhere");
        const branch = fixture.peer.git(["push", "--quiet", "origin", "elsewhere:elsewhere"]);
        assert.equal(branch.code, 0, branch.stderr);
      },
    });
    served = h.fixture.server.dir;
  });
  after(async () => {
    await h.stop();
  });

  it("merges its schema, and says a pull request has no runs yet", async () => {
    const data = ok<Payload>(
      await h.gql(`{ testPlans { slug } prs { id tested testRuns { id } ext } }`),
    );
    assert.deepEqual(data.testPlans, []);
    assert.deepEqual(
      data.prs.map((pr: Payload) => [pr.id, pr.tested, pr.testRuns, pr.ext.tests]),
      [["pr111111", "NONE", [], { tested: "none", runs: 0, latest: null }]],
    );
  });

  it("creates a plan from fields, composing its file", async () => {
    const data = ok<Payload>(
      await h.gql(CREATE, {
        input: {
          title: "Login flow",
          slug: "login",
          description: "Needs an account.",
          steps: STEPS,
        },
      }),
    );
    const plan = data.createTestPlan.plan;
    assert.equal(plan.slug, "login");
    assert.equal(plan.path, ".navbook/tests/login");
    assert.equal(plan.description, "Needs an account.");
    assert.deepEqual(plan.steps[2], {
      number: 3,
      title: "Log out",
      actions: "Press **Log out**.",
      expected: null,
    });
    assert.deepEqual(data.createTestPlan.commit, {
      committed: true,
      subject: "docs(tests): create login",
      pushed: true,
    });
    assert.equal(originSubjects(h.fixture.origin)[0], "docs(tests): create login");
    const text = readFileSync(join(served, ".navbook/tests/login/plan.md"), "utf8");
    assert.equal(blobSha(text), plan.baseSha);
    assert.match(
      text,
      /### Sign in\n\n#### Actions\n\nEnter the credentials\.\n\n#### Expected\n\nThe dashboard opens\./,
    );
  });

  it("refuses a plan it could not write back as itself", async () => {
    const refused = async (input: Payload, code: string, pattern: RegExp): Promise<void> => {
      const response = await h.gql(CREATE, { input });
      assert.equal(errorCode(response), code, JSON.stringify(response.errors));
      assert.match(response.errors[0]?.message ?? "", pattern);
    };
    await refused({ title: " ", steps: STEPS }, "INVALID_INPUT", /title/);
    await refused(
      { title: "Again", slug: "login", steps: STEPS },
      "ALREADY_EXISTS",
      /already exists/,
    );
    await refused(
      { title: "Id", slug: "abcd1234", steps: STEPS },
      "INVALID_INPUT",
      /shaped like an ID/,
    );
    await refused(
      { title: "X", steps: [{ title: "A", actions: "### B" }] },
      "INVALID_INPUT",
      /step 1's actions contains a heading/,
    );
    await refused(
      { title: "X", steps: [{ title: "A", actions: " " }] },
      "INVALID_INPUT",
      /step 1 needs its actions/,
    );
    await refused(
      { title: "X", steps: [{ title: "A\nB", actions: "x" }] },
      "INVALID_INPUT",
      /title must be one line/,
    );
    await refused(
      { title: "X", description: "#### Nope", steps: STEPS },
      "INVALID_INPUT",
      /the description contains a level-3/,
    );
  });

  it("updates a plan against the version it read, and refuses an older one", async () => {
    const before_ = ok<Payload>(await h.gql(`{ testPlan(slug: "login") { baseSha } }`)).testPlan;
    const reordered = [STEPS[1], STEPS[0], STEPS[2]];
    const data = ok<Payload>(
      await h.gql(UPDATE, { input: { slug: "login", steps: reordered, baseSha: before_.baseSha } }),
    );
    assert.deepEqual(
      data.updateTestPlan.plan.steps.map((step: Payload) => step.title),
      ["Sign in", "Open the login page", "Log out"],
    );
    assert.equal(data.updateTestPlan.commit.subject, "docs(tests): edit login");
    const stale = await h.gql(UPDATE, {
      input: { slug: "login", title: "Renamed", baseSha: before_.baseSha },
    });
    assert.equal(errorCode(stale), "STALE_CONTENT");
    const empty = await h.gql(UPDATE, {
      input: { slug: "login", baseSha: data.updateTestPlan.plan.baseSha },
    });
    assert.equal(errorCode(empty), "INVALID_INPUT");
    // Back in order, title changed, steps kept.
    const back = ok<Payload>(
      await h.gql(UPDATE, {
        input: { slug: "login", steps: STEPS, baseSha: data.updateTestPlan.plan.baseSha },
      }),
    );
    const titled = ok<Payload>(
      await h.gql(UPDATE, {
        input: { slug: "login", title: "Login", baseSha: back.updateTestPlan.plan.baseSha },
      }),
    );
    assert.equal(titled.updateTestPlan.plan.title, "Login");
    assert.equal(titled.updateTestPlan.plan.steps.length, 3);
    assert.equal(titled.updateTestPlan.plan.description, "Needs an account.");
  });

  let standalone: Payload;

  it("starts a standalone run, against the served head unless a version is named", async () => {
    const head = h.fixture.server.git(["rev-parse", "HEAD"]).stdout.trim();
    const byHead = ok<Payload>(
      await h.gql(START, { input: { plan: "login", environment: "staging" } }),
    ).startTestRun;
    assert.equal(byHead.run.commit, head);
    assert.equal(byHead.run.version, null);
    assert.equal(byHead.run.outcome, "IN_PROGRESS");
    assert.equal(byHead.run.stepsFrom, "PLAN_SHA");
    assert.equal(byHead.run.pr, null);
    assert.match(
      byHead.run.path,
      /^\.navbook\/tests\/login\/runs\/\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9]{8}\.md$/,
    );
    assert.equal(byHead.commit.subject, `docs(tests): run login ${byHead.run.id}`);
    assert.deepEqual(
      byHead.run.results.map((result: Payload) => result.status),
      [null, null, null],
    );

    const byVersion = ok<Payload>(
      await h.gql(START, { input: { plan: "login", version: " 1.4 " } }),
    ).startTestRun;
    assert.equal(byVersion.run.commit, null);
    assert.equal(byVersion.run.version, "1.4");
    const named = ok<Payload>(
      await h.gql(START, { input: { plan: "login", commit: "HEAD~1", version: "1.4" } }),
    ).startTestRun;
    assert.equal(named.run.commit, h.fixture.server.git(["rev-parse", "HEAD~2"]).stdout.trim());
    const bad = await h.gql(START, { input: { plan: "login", commit: "no-such-rev" } });
    assert.equal(errorCode(bad), "INVALID_INPUT");
    const missing = await h.gql(START, { input: { plan: "nope" } });
    assert.equal(errorCode(missing), "NOT_FOUND");
    standalone = byHead.run;
  });

  it("records steps against the version it read, and finishes", async () => {
    const first = ok<Payload>(
      await h.gql(SAVE, {
        input: {
          id: standalone.id,
          baseSha: standalone.baseSha,
          results: [{ number: 2, status: "FAILED", actual: "Blank." }],
        },
      }),
    ).saveTestRun;
    assert.equal(first.commit.subject, `docs(tests): record login ${standalone.id}`);
    assert.equal(first.run.outcome, "FAILED");
    assert.deepEqual(first.run.results[1], {
      number: 2,
      title: "Sign in",
      actions: "Enter the credentials.",
      expected: "The dashboard opens.",
      status: "FAILED",
      actual: "Blank.",
    });

    const stale = await h.gql(SAVE, {
      input: { id: standalone.id, baseSha: standalone.baseSha, results: [] },
    });
    assert.equal(errorCode(stale), "STALE_CONTENT");
    const beyond = await h.gql(SAVE, {
      input: {
        id: standalone.id,
        baseSha: first.run.baseSha,
        results: [{ number: 4, status: "PASSED" }],
      },
    });
    assert.equal(errorCode(beyond), "INVALID_INPUT");

    const done = ok<Payload>(
      await h.gql(SAVE, {
        input: {
          id: standalone.id.slice(0, 5),
          baseSha: first.run.baseSha,
          results: [
            { number: 1, status: "PASSED" },
            { number: 2, status: "PASSED", actual: null },
            { number: 3, status: "SKIPPED" },
          ],
          notes: "On staging.",
          finish: true,
        },
      }),
    ).saveTestRun;
    assert.equal(done.commit.subject, `docs(tests): finish login ${standalone.id}`);
    assert.equal(done.run.outcome, "PASSED");
    assert.equal(done.run.notes, "On staging.");
    assert.notEqual(done.run.finished, null);
    const closed = await h.gql(SAVE, {
      input: { id: standalone.id, baseSha: done.run.baseSha, results: [] },
    });
    assert.equal(errorCode(closed), "PRECONDITION");
    const stats = ok<Payload>(
      await h.gql(`{ testPlan(slug: "login") { stats { runs passed inProgress } runs { id } } }`),
    );
    assert.deepEqual(stats.testPlan.stats, { runs: 3, passed: 1, inProgress: 2 });
  });

  let attached: Payload;

  it("attaches a run to a pull request the served branch holds", async () => {
    const pr = ok<Payload>(await h.gql(`{ pr(ref: "pr111111") { revisions { head } } }`)).pr;
    const data = ok<Payload>(
      await h.gql(START, { input: { plan: "login", pr: "pr11" } }),
    ).startTestRun;
    attached = data.run;
    assert.match(attached.path, /^\.navbook\/prs\/open\/pr111111-served\/tests\//);
    assert.equal(attached.commit, pr.revisions.at(-1).head);
    assert.equal(attached.pr.id, "pr111111");
    assert.equal(data.commit.subject, `docs(tests): run login ${attached.id} on #pr111111`);
    const message = h.fixture.server.git(["log", "-1", "--format=%B"]).stdout.trim();
    assert.match(message, /\n\nRefs: pr111111$/);

    const listing = ok<Payload>(await h.gql(`{ prs { id tested testRuns { id } ext } }`));
    const row = listing.prs.find((entry: Payload) => entry.id === "pr111111");
    assert.equal(row.tested, "IN_PROGRESS");
    assert.deepEqual(
      row.testRuns.map((run: Payload) => run.id),
      [attached.id],
    );
    assert.deepEqual(row.ext.tests, {
      tested: "in-progress",
      runs: 1,
      latest: { id: attached.id, outcome: "in-progress" },
    });
  });

  it("filters pull requests by their tested state", async () => {
    const ids = async (tested: string[]): Promise<string[]> =>
      ok<Payload>(
        await h.gql(`query($f: PrFilter) { prs(filter: $f) { id } }`, { f: { tested } }),
      ).prs.map((pr: Payload) => pr.id);
    assert.deepEqual(await ids(["in-progress"]), ["pr111111"]);
    assert.deepEqual(await ids(["IN-PROGRESS", "passed"]), ["pr111111"]);
    assert.deepEqual(await ids(["none"]), []);
    const all = ok<Payload>(
      await h.gql(`query($f: PrFilter) { prs(filter: $f, allRefs: true) { id } }`, {
        f: { tested: ["none"] },
      }),
    );
    assert.deepEqual(
      all.prs.map((pr: Payload) => pr.id),
      ["pr222222"],
    );
    const bad = await h.gql(`query($f: PrFilter) { prs(filter: $f) { id } }`, {
      f: { tested: ["green"] },
    });
    assert.equal(errorCode(bad), "INVALID_INPUT");
  });

  it("refuses a run for a pull request only another branch carries, naming the branch", async () => {
    const response = await h.gql(START, { input: { plan: "login", pr: "pr222222" } });
    assert.equal(errorCode(response), "PRECONDITION");
    assert.equal(response.errors[0]?.extensions?.sourceRef, "origin/elsewhere");
  });

  it("reads a run on another branch, and refuses to write to it there", async () => {
    // A run recorded at a terminal on the pull request's own branch.
    const peer = h.fixture.peer;
    peer.git(["checkout", "--quiet", "elsewhere"]);
    const dir = ".navbook/prs/open/pr222222-elsewhere/tests";
    const name = "2026-09-21T090000Z-rrrr2222";
    const head = peer.git(["rev-parse", "HEAD~1"]).stdout.trim();
    mkdirSync(join(peer.dir, dir, name), { recursive: true });
    writeFileSync(
      join(peer.dir, dir, `${name}.md`),
      `---\nplan: login\nsteps: 3\nauthor: Bob <bob@example.com>\nstarted: 2026-09-21T09:00:00Z\ncommit: ${head}\n---\n\n### 1. Open\n\n#### Status\n\nfailed\n`,
    );
    writeFileSync(join(peer.dir, dir, name, "shot.png"), Buffer.from([0x89, 0x50, 0, 255]));
    peer.commitAll("docs(tests): run login rrrr2222 on #pr222222");
    assert.equal(peer.git(["push", "--quiet", "origin", "elsewhere:elsewhere"]).code, 0);

    const read = ok<Payload>(await h.gql(RUN, { id: "rrrr" })).testRun;
    assert.equal(read.pr.id, "pr222222");
    assert.deepEqual(read.pr.refs, ["origin/elsewhere"]);
    assert.equal(read.outcome, "FAILED");
    assert.deepEqual(read.attachments, [{ name: "shot.png", path: `${dir}/${name}/shot.png` }]);
    const bytes = ok<Payload>(
      await h.gql(ATTACHMENT, { run: "rrrr2222", name: "shot.png" }),
    ).testAttachment;
    assert.deepEqual([...Buffer.from(bytes.base64, "base64")], [0x89, 0x50, 0, 255]);
    assert.equal(bytes.contentType, "image/png");

    const write = await h.gql(SAVE, {
      input: { id: "rrrr2222", baseSha: read.baseSha, results: [] },
    });
    assert.equal(errorCode(write), "PRECONDITION");
    assert.equal(write.errors[0]?.extensions?.sourceRef, "origin/elsewhere");
    const listed = ok<Payload>(await h.gql(`{ prs(allRefs: true) { id tested testRuns { id } } }`));
    const row = listed.prs.find((pr: Payload) => pr.id === "pr222222");
    assert.equal(row.tested, "FAILED");
  });

  it("attaches files beside a run, linked from it, and serves them back", async () => {
    const recorded = ok<Payload>(
      await h.gql(SAVE, {
        input: {
          id: attached.id,
          baseSha: attached.baseSha,
          results: [{ number: 1, status: "FAILED", actual: "Broken." }],
        },
      }),
    ).saveTestRun.run;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);
    const data = ok<Payload>(
      await h.gql(ATTACH, {
        input: {
          id: attached.id,
          baseSha: recorded.baseSha,
          step: 1,
          files: [
            { name: "screen shot.png", base64: png.toString("base64") },
            { name: "console.log", base64: Buffer.from("TypeError\n").toString("base64") },
          ],
        },
      }),
    ).attachToTestRun;
    assert.deepEqual(data.names, ["screen-shot.png", "console.log"]);
    assert.equal(data.commit.subject, `docs(tests): attach login ${attached.id} on #pr111111`);
    const base = attached.path.replace(/\.md$/, "");
    assert.deepEqual([...readFileSync(join(served, base, "screen-shot.png"))], [...png]);
    assert.match(
      data.run.results[0].actual,
      /^Broken\.\n\n!\[screen-shot\.png\]\([^)]+\)\n\[console\.log\]\([^)]+\)$/,
    );
    assert.deepEqual(
      data.run.attachments.map((file: Payload) => file.name),
      ["console.log", "screen-shot.png"],
    );

    const served_ = ok<Payload>(
      await h.gql(ATTACHMENT, { run: attached.id, name: "screen-shot.png" }),
    ).testAttachment;
    assert.deepEqual(served_, {
      name: "screen-shot.png",
      contentType: "image/png",
      size: png.length,
      base64: png.toString("base64"),
    });
    for (const name of ["../pr.md", "nope.png", ""]) {
      const missing = await h.gql(ATTACHMENT, { run: attached.id, name });
      assert.equal(errorCode(missing), "NOT_FOUND", name);
    }
    const refuse = async (files: Payload, pattern: RegExp, step?: number): Promise<void> => {
      const response = await h.gql(ATTACH, {
        input: { id: attached.id, baseSha: data.run.baseSha, files, ...(step ? { step } : {}) },
      });
      assert.equal(
        errorCode(response),
        response.errors[0]?.extensions?.code,
        JSON.stringify(response.errors),
      );
      assert.match(response.errors[0]?.message ?? "", pattern);
    };
    await refuse([{ name: "x.txt", base64: "not base64!" }], /'x\.txt' is not base64/);
    await refuse(
      [{ name: "big.bin", base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }],
      /larger than 5 MiB/,
    );
    await refuse(
      [{ name: "console.log", base64: "" }],
      /already has an attachment named 'console\.log'/,
    );
    await refuse([{ name: "a.txt", base64: "" }], /step 2 of test run .* is not recorded yet/, 2);
  });
});
