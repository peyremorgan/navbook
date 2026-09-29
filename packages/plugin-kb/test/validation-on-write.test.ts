/**
 * A `feature:` the plugin refuses never reaches a file — spec 02 §2.12.
 *
 * The host validates what it composes before it writes, and the plugin's keys
 * are validated by the plugin. Doctor always passed the extensions; the write
 * paths once did not, so a value doctor rejects as D2 was committed by the
 * very command that should have refused it, and the API then served the issue
 * with no features at all.
 */

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeNavRepo, type TempRepo } from "@navbook/cli/test-helpers";
import { type Harness, startHarness } from "@navbook/server/test-helpers";

const KB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = { NAVBOOK_PLUGIN_PATH: KB };
const BAD = ["Not A Slug", "../x", ""];

describe("the API refuses a feature the plugin refuses", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness({ env: ENV });
  });
  after(async () => {
    await h.stop();
  });

  const openIssues = (): string[] =>
    readdirSync(join(h.fixture.server.dir, ".navbook/issues/open")).filter(
      (name) => name !== ".gitkeep",
    );

  it("on openIssue", async () => {
    for (const feature of BAD) {
      const result = await h.gql(
        `mutation Open($input: OpenIssueInput!) { openIssue(input: $input) { issue { id } } }`,
        { input: { title: "Bad", body: "b.", features: [feature] } },
      );
      assert.notDeepEqual(result.errors ?? [], [], JSON.stringify(feature));
      assert.deepEqual(openIssues(), [], `${JSON.stringify(feature)} was written`);
    }
  });

  it("on updateIssue", async () => {
    const opened = await h.gql<{ openIssue: { issue: { id: string } } }>(
      `mutation { openIssue(input: { title: "Good", body: "b." }) { issue { id } } }`,
    );
    const id = opened.data?.openIssue.issue.id as string;
    for (const feature of BAD) {
      const result = await h.gql(
        `mutation Update($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }`,
        { input: { ref: id, features: [feature] } },
      );
      assert.notDeepEqual(result.errors ?? [], [], JSON.stringify(feature));
    }
    const read = await h.gql<{ issue: { features: string[] } }>(
      `query { issue(ref: "${id}") { features } }`,
    );
    assert.deepEqual(read.data?.issue.features, []);
  });
});

describe("nav refuses a feature the plugin refuses", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    const plain = repo.nav.bind(repo);
    repo.nav = (args, env, input) => plain(args, { NAVBOOK_PLUGIN_PATH: KB, ...env }, input);
  });
  after(() => repo.cleanup());

  it("on issue open", () => {
    const result = repo.nav(["issue", "open", "Bad", "--feature", "Bad Slug", "-m", "b."]);
    assert.notEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /feature/);
    assert.deepEqual(
      readdirSync(join(repo.dir, ".navbook/issues/open")).filter((name) => name !== ".gitkeep"),
      [],
    );
  });
});
