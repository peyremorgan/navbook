/**
 * The bridge in a real server: threads opened, told and archived as the
 * tracker moves — whether it moves over the API or by somebody's push.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ok } from "@navbook/server/test-helpers";
import { eventually, startBridged } from "./helpers/bridge.ts";
import { FORUM, TEXT } from "./helpers/stub-discord.ts";

const OPEN_ISSUE = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "It does not work." }) { issue { id } } }`;

describe("threads", () => {
  it("opens one for an issue opened over the API, with its card", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const opened = ok(
        await harness.gql<{ openIssue: { issue: { id: string } } }>(OPEN_ISSUE, {
          title: "Login is broken",
        }),
      );
      const id = opened.openIssue.issue.id;
      await eventually(
        () => stub.threadsOf(TEXT).length === 1,
        () => harness.stderr(),
      );
      const [thread] = stub.threadsOf(TEXT);
      assert.equal(thread?.name, `#${id} Login is broken`);
      const card = stub.card(thread?.id as string);
      assert.equal(card?.embeds[0]?.footer?.text, `navbook:${id}`);
      assert.equal(card?.embeds[0]?.url, `https://tracker.example/issues/${id}`);
      assert.match(card?.embeds[0]?.description ?? "", /It does not work\./);
    } finally {
      await bridged.stop();
    }
  });

  it("opens a forum post for a pull request somebody pushed from a terminal", async () => {
    const bridged = await startBridged();
    const { stub, harness } = bridged;
    try {
      const { peer } = harness.fixture;
      peer.filePr("Fix the login", "Retries once.", "pr111111", "fix-login");
      assert.equal(peer.git(["push", "--quiet", "origin", "fix-login"]).code, 0);
      await eventually(
        () => stub.threadsOf(FORUM).length === 1,
        () => harness.stderr(),
      );
      assert.equal(stub.threadsOf(FORUM)[0]?.name, "#pr111111 Fix the login");
      assert.equal(stub.threadsOf(TEXT).length, 0);
    } finally {
      await bridged.stop();
    }
  });
});
