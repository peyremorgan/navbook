/**
 * The remembered tree, over HTTP, against a real clone.
 *
 * With a pull interval, a read answers from the tree the server parsed at
 * HEAD. What these tests hold it to is that nothing gets stuck: the server's
 * own writes are seen by the very next read, and a push from elsewhere or an
 * edit made by hand in the served clone within a pull interval.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";

const INTERVAL_MS = 200;

const OPEN = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "x" }) { issue { id path } }
}`;
const UPDATE = `mutation Update($ref: ID!, $title: String!) {
  updateIssue(input: { ref: $ref, title: $title }) { issue { id title } }
}`;
const SHOW = `query Show($ref: ID!) { issue(ref: $ref) { id title } }`;
const LIST = `query { issues { id title } }`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("the remembered tree", () => {
  let h: Harness;

  const open = async (title: string) =>
    ok<{ openIssue: { issue: { id: string; path: string } } }>(await h.gql(OPEN, { title }))
      .openIssue.issue;
  const titleOf = async (ref: string) =>
    ok<{ issue: { title: string } }>(await h.gql(SHOW, { ref })).issue.title;

  /** Ask until `probe` answers `expected`, for a few pull intervals at most. */
  async function eventually<T>(probe: () => Promise<T>, expected: T): Promise<void> {
    let seen: T | undefined;
    for (let tries = 0; tries < 50; tries++) {
      seen = await probe();
      if (seen === expected) return;
      await sleep(INTERVAL_MS / 2);
    }
    assert.equal(seen, expected);
  }

  before(async () => {
    h = await startHarness({ pullIntervalMs: INTERVAL_MS });
  });

  after(async () => {
    await h.stop();
  });

  it("answers the server's own writes on the very next read", async () => {
    const issue = await open("First title");
    // Read once, so a tree is remembered before the write.
    assert.equal(await titleOf(issue.id), "First title");
    ok(await h.gql(UPDATE, { ref: issue.id, title: "Second title" }));
    assert.equal(await titleOf(issue.id), "Second title");
    const listed = ok<{ issues: { id: string; title: string }[] }>(await h.gql(LIST)).issues;
    assert.equal(listed.find((row) => row.id === issue.id)?.title, "Second title");
  });

  it("sees a push from elsewhere once it has been pulled", async () => {
    await titleOf((await open("Warm the cache")).id);
    h.fixture.peer.git(["pull", "--quiet", "--no-rebase", "origin", "main"]);
    h.fixture.peer.fileIssue("Filed from a terminal", "Not through the API.", "pe333333");
    assert.equal(h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]).code, 0);
    await eventually(async () => {
      const listed = ok<{ issues: { id: string }[] }>(await h.gql(LIST)).issues;
      return listed.some((row) => row.id === "pe333333");
    }, true);
  });

  it("sees an edit made by hand in the served clone, and every edit after it", async () => {
    const issue = await open("Typed by hand");
    assert.equal(await titleOf(issue.id), "Typed by hand");
    const file = join(h.fixture.server.dir, issue.path, "issue.md");
    const original = readFileSync(file, "utf8");

    writeFileSync(file, original.replace("Typed by hand", "Edited by hand"));
    await eventually(() => titleOf(issue.id), "Edited by hand");
    // Edited again: git says the same thing about the file as before, so only
    // leaving the cache alone while the edit stands can show this one.
    writeFileSync(file, original.replace("Typed by hand", "Edited again"));
    await eventually(() => titleOf(issue.id), "Edited again");

    writeFileSync(file, original);
    await eventually(() => titleOf(issue.id), "Typed by hand");
  });
});
