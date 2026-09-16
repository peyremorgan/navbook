/**
 * Editing a field somebody else has edited since you read it.
 *
 * `updateIssue` and `updatePr` are field-scoped, so two people changing
 * different fields never clobber each other; the hazard is the same field
 * twice, where the second write from a page rendered before the first would
 * win silently. `baseSha` is how a client says which version it was looking
 * at, and these prove what the server does with it: refuse the field that
 * moved, land the one that did not, and never crash on a hash it cannot read.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";
import { originSubjects } from "../helpers/temprepo.ts";

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id path baseSha } }
}`;

const SHOW = `query Show($ref: ID!) {
  issue(ref: $ref) { id title labels milestone baseSha }
}`;

const UPDATE = `mutation Update($input: UpdateIssueInput!) {
  updateIssue(input: $input) {
    issue { id title labels milestone baseSha }
    commit { committed subject }
  }
}`;

interface IssueShape {
  id: string;
  title: string;
  labels: string[];
  milestone: string | null;
  baseSha: string;
}

interface Refusal {
  errors: { message: string; extensions?: Record<string, unknown> }[];
}

const SHA = /^[0-9a-f]{40}$/;

describe("a stale edit to an issue", () => {
  let h: Harness;

  const fileOf = (path: string): string => readFileSync(join(h.fixture.server.dir, path), "utf8");

  const open = async (title: string): Promise<{ id: string; path: string; baseSha: string }> =>
    ok<{ openIssue: { issue: { id: string; path: string; baseSha: string } } }>(
      await h.gql(OPEN, { input: { title, body: "Body.", labels: ["one"], milestone: "v1" } }),
    ).openIssue.issue;

  const show = async (ref: string): Promise<IssueShape> =>
    ok<{ issue: IssueShape }>(await h.gql(SHOW, { ref })).issue;

  const update = async (input: Record<string, unknown>): Promise<IssueShape> =>
    ok<{ updateIssue: { issue: IssueShape } }>(await h.gql(UPDATE, { input })).updateIssue.issue;

  const moved = (refused: Refusal): unknown => refused.errors[0]?.extensions?.moved;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("reports the file's blob hash, and a new one once the file has changed", async () => {
    const issue = await open("Hashed");
    assert.match(issue.baseSha, SHA);
    assert.equal((await show(issue.id)).baseSha, issue.baseSha);

    const edited = await update({ ref: issue.id, title: "Hashed again" });
    assert.match(edited.baseSha, SHA);
    assert.notEqual(edited.baseSha, issue.baseSha);
    // It is the hash git itself gives the file, so a CLI user hashing their
    // checkout would get the same answer.
    const hashed = h.fixture.server.git(["hash-object", `${issue.path}/issue.md`]);
    assert.equal(edited.baseSha, hashed.stdout.trim());
  });

  it("refuses to land a field on top of a change made since the page was rendered", async () => {
    const issue = await open("Original");
    // Both A and B are looking at "Original".
    const seenByB = await show(issue.id);

    await update({ ref: issue.id, title: "A's title" });
    const refused = await h.gql(UPDATE, {
      input: { ref: issue.id, title: "B's title", baseSha: seenByB.baseSha },
    });

    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(moved(refused), ["title"]);
    assert.match(refused.errors[0]?.message ?? "", /title of #/);
    // A's title stands, nothing was committed for B, and the tree is clean.
    assert.equal((await show(issue.id)).title, "A's title");
    assert.match(fileOf(`${issue.path}/issue.md`), /^title: A's title$/m);
    assert.equal(
      originSubjects(h.fixture.origin).filter((s) => s === `docs(issue): edit #${issue.id}`).length,
      1,
    );
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout, "");
  });

  it("lands a field nobody else touched, whatever else moved in the file", async () => {
    const issue = await open("Relabelled");
    const seenByB = await show(issue.id);

    await update({ ref: issue.id, title: "A's title" });
    // B sets a label from the page that still shows the old title: not a
    // conflict with A, and both changes survive.
    const landed = await update({
      ref: issue.id,
      labels: ["one", "two"],
      baseSha: seenByB.baseSha,
    });
    assert.equal(landed.title, "A's title");
    assert.deepEqual(landed.labels, ["one", "two"]);
  });

  it("names every field that moved, and only those", async () => {
    const issue = await open("Several");
    const seen = await show(issue.id);

    await update({ ref: issue.id, title: "Moved", milestone: "v2" });
    const refused = await h.gql(UPDATE, {
      input: {
        ref: issue.id,
        title: "Mine",
        labels: ["x"],
        milestone: "v3",
        baseSha: seen.baseSha,
      },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(moved(refused), ["title", "milestone"]);
  });

  it("goes through with the hash the file now carries", async () => {
    const issue = await open("Reapplied");
    const seen = await show(issue.id);
    await update({ ref: issue.id, title: "Theirs" });
    assert.equal(
      errorCode(
        await h.gql(UPDATE, { input: { ref: issue.id, title: "Mine", baseSha: seen.baseSha } }),
      ),
      "STALE_CONTENT",
    );

    // Having seen theirs, the same edit with the current hash is a decision.
    const fresh = await show(issue.id);
    const written = await update({ ref: issue.id, title: "Mine", baseSha: fresh.baseSha });
    assert.equal(written.title, "Mine");
  });

  it("lands as it always did when no hash is sent", async () => {
    const issue = await open("Unhashed");
    await update({ ref: issue.id, title: "A's title" });
    // A listing toggling a label has read no file, and need not.
    const landed = await update({ ref: issue.id, labels: ["one", "two"] });
    assert.deepEqual(landed.labels, ["one", "two"]);
    assert.equal(landed.title, "A's title");
  });

  it("refuses a hash it cannot resolve rather than crashing on it", async () => {
    const issue = await open("Unknown");
    for (const baseSha of ["0".repeat(40), "whatever", "", "-p"]) {
      const refused = await h.gql(UPDATE, { input: { ref: issue.id, title: "Mine", baseSha } });
      assert.equal(errorCode(refused), "STALE_CONTENT", `for ${JSON.stringify(baseSha)}`);
      // With nothing to compare against, every field the patch names is in doubt.
      assert.deepEqual(moved(refused), ["title"]);
    }
    assert.equal((await show(issue.id)).title, "Unknown");
  });

  it("refuses before anything is validated or written", async () => {
    const issue = await open("Untouched");
    const seen = await show(issue.id);
    await update({ ref: issue.id, title: "Theirs" });
    const before = fileOf(`${issue.path}/issue.md`);
    // A patch that would also be invalid is refused as stale first: the file
    // is not read for it, let alone rewritten.
    const refused = await h.gql(UPDATE, {
      input: { ref: issue.id, title: "Mine", deadline: "soon", baseSha: seen.baseSha },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.equal(fileOf(`${issue.path}/issue.md`), before);
  });
});

describe("a stale edit to a pull request", () => {
  let h: Harness;

  const PR = `query { pr(ref: "pr111111") { id title reviewers baseSha } }`;
  const UPDATE_PR = `mutation Update($input: UpdatePrInput!) {
    updatePr(input: $input) { pr { id title reviewers baseSha } }
  }`;

  before(async () => {
    h = await startHarness({
      pullIntervalMs: 0,
      // Served from the branch that carries it, which is the deployment in
      // which patching it is possible at all.
      prepare: (fixture) => {
        fixture.server.filePr("Fix the login", "Here is the change.", "pr111111", "fix-login");
        fixture.server.git(["checkout", "--quiet", "fix-login"]);
      },
    });
  });

  after(async () => {
    await h.stop();
  });

  it("is guarded field by field, exactly as an issue's is", async () => {
    const seen = ok<{ pr: { baseSha: string } }>(await h.gql(PR)).pr;
    assert.match(seen.baseSha, SHA);

    ok(await h.gql(UPDATE_PR, { input: { ref: "pr111111", title: "Fix the login, properly" } }));

    const refused = await h.gql(UPDATE_PR, {
      input: { ref: "pr111111", title: "Fix sign-in", baseSha: seen.baseSha },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(refused.errors[0]?.extensions?.moved, ["title"]);

    // Asking somebody to review is a different field, so it lands.
    const asked = ok<{ updatePr: { pr: { title: string; reviewers: string[] } } }>(
      await h.gql(UPDATE_PR, {
        input: { ref: "pr111111", reviewers: ["alice@example.com"], baseSha: seen.baseSha },
      }),
    ).updatePr.pr;
    assert.equal(asked.title, "Fix the login, properly");
    assert.deepEqual(asked.reviewers, ["alice@example.com"]);
  });
});
