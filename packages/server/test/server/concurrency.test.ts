/**
 * Requests arriving at once.
 *
 * What these assert is the observable result: ten mutations sent together
 * produce ten ids, ten commits and one clean tree, and reads taken alongside
 * them never see a tree mid-move.
 *
 * They do not, on their own, prove the repository lock is what achieves that.
 * Every core operation is `spawnSync`, so a read or a write runs to completion
 * in a single synchronous turn and cannot interleave whether the lock is there
 * or not — removing it leaves these passing. The lock earns its place by
 * ordering the awaits *around* those turns, and by making `drain` meaningful at
 * shutdown; `test/unit/sync.test.ts` asserts that ordering directly. These
 * tests are what would notice if the git layer ever became asynchronous and the
 * guarantee stopped being free.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";
import { originSubjects } from "../helpers/temprepo.ts";

const OPEN = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "Body." }) {
    issue { id title status path }
    commit { committed pushed }
  }
}`;

interface OpenResult {
  openIssue: {
    issue: { id: string; title: string; status: string; path: string };
    commit: { committed: boolean; pushed: boolean };
  };
}

describe("concurrent requests", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("files ten issues sent at once, each with its own id and commit", async () => {
    const titles = Array.from({ length: 10 }, (_, i) => `Concurrent ${i}`);
    const results = await Promise.all(
      titles.map(async (title) => ok<OpenResult>(await h.gql(OPEN, { title })).openIssue),
    );

    // Every one committed and reached origin.
    assert.ok(results.every((r) => r.commit.committed && r.commit.pushed));

    // Ten distinct ids: each mint saw a tree that already held everything
    // minted before it.
    const ids = new Set(results.map((r) => r.issue.id));
    assert.equal(ids.size, 10);

    // Ten separate commits, not one commit that swept several changes up.
    const subjects = originSubjects(h.fixture.origin);
    for (const result of results) {
      assert.ok(
        subjects.includes(`docs(issue): open #${result.issue.id}`),
        `origin is missing #${result.issue.id}`,
      );
    }

    // And the tree agrees with all ten payloads.
    const listed = ok<{ issues: { id: string }[] }>(await h.gql(`query { issues { id } }`));
    assert.equal(listed.issues.length, 10);
    assert.deepEqual(new Set(listed.issues.map((i) => i.id)), ids);
  });

  it("leaves the clone clean, with nothing half-applied", async () => {
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout.trim(), "");
    const doctor = ok<{ doctor: { diagnostics: unknown[] } }>(
      await h.gql(`query { doctor { diagnostics { check message } } }`),
    );
    assert.deepEqual(doctor.doctor.diagnostics, []);
  });

  it("reads a consistent tree while writes are in flight", async () => {
    // The reads are issued alongside mutations that move files between
    // directories — the moment at which a torn read would show up.
    const ids = ok<{ issues: { id: string }[] }>(await h.gql(`query { issues { id } }`)).issues.map(
      (issue) => issue.id,
    );

    const closing = ids.slice(0, 5).map(async (ref) =>
      h.gql(`mutation C($ref: ID!) { closeIssue(input: { ref: $ref }) { issue { status } } }`, {
        ref,
      }),
    );
    const reading = Array.from({ length: 5 }, async () =>
      h.gql<{ issues: { id: string; status: string }[] }>(
        `query { issues(filter: { status: [OPEN, CLOSED] }) { id status } }`,
      ),
    );

    const [closes, reads] = await Promise.all([Promise.all(closing), Promise.all(reading)]);
    assert.ok(closes.every((response) => response.errors.length === 0));

    // Every read saw all ten issues: a torn read would have seen an entity
    // twice, or missed one mid-move between its two directories.
    for (const response of reads) {
      const data = ok(response);
      assert.equal(data.issues.length, 10, "a read saw a tree mid-move");
      assert.equal(new Set(data.issues.map((issue) => issue.id)).size, 10);
    }
  });

  it("reports where a moved entity went, not where it was", async () => {
    // The payload is built by reading the tree back, and a close moves the
    // directory it names; another mutation runs alongside to make sure the
    // answer is the one this operation produced.
    const opened = ok<OpenResult>(await h.gql(OPEN, { title: "Reported" })).openIssue;

    const [closed] = await Promise.all([
      h.gql<{ closeIssue: { issue: { status: string; path: string } } }>(
        `mutation C($ref: ID!) {
           closeIssue(input: { ref: $ref }) { issue { status path } destination }
         }`,
        { ref: opened.issue.id },
      ),
      h.gql(OPEN, { title: "Racing alongside" }),
    ]);

    const data = ok(closed);
    assert.equal(data.closeIssue.issue.status, "CLOSED");
    // The payload names where it went, not where it was.
    assert.equal(data.closeIssue.issue.path, `.navbook/issues/closed/${opened.issue.id}-reported`);
  });
});
