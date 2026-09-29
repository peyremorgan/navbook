/**
 * The knowledge base over the API — spec 06 §6.3.
 *
 * The same questions the server's own feature suite used to ask, of a schema
 * that is now two documents merged rather than one. What they prove is that
 * `extend type Query` and `extend type Issue` really do compose: a client
 * cannot tell which half of the schema answered it.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { startHarness } from "@navbook/server/test-helpers";

const KB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = { NAVBOOK_PLUGIN_PATH: KB };

describe("the merged schema", () => {
  it("answers a feature query the host schema does not define", async () => {
    const harness = await startHarness({ env: ENV });
    try {
      const made = await harness.gql<{ createFeature: { feature: { slug: string } } }>(
        `mutation { createFeature(input: { title: "Authentication", slug: "auth", summary: "Signing in." }) { feature { slug title summary } } }`,
      );
      assert.deepEqual(made.errors, [], JSON.stringify(made.errors));
      assert.equal(made.data?.createFeature.feature.slug, "auth");

      const read = await harness.gql<{ features: { slug: string; summary: string }[] }>(
        "{ features { slug title summary path } }",
      );
      assert.deepEqual(read.errors, []);
      assert.equal(read.data?.features.length, 1);
      assert.equal(read.data?.features[0]?.summary, "Signing in.");
    } finally {
      await harness.stop();
    }
  });

  it("adds `features` to the Entity interface and both implementations", async () => {
    const harness = await startHarness({ env: ENV });
    try {
      await harness.gql(
        `mutation { createFeature(input: { title: "Auth", slug: "auth" }) { feature { slug } } }`,
      );
      const opened = await harness.gql<{
        openIssue: { issue: { id: string; features: string[] } };
      }>(
        `mutation { openIssue(input: { title: "Times out", body: "b.", features: ["auth"] }) { issue { id features } } }`,
      );
      assert.deepEqual(opened.errors, [], JSON.stringify(opened.errors));
      assert.deepEqual(opened.data?.openIssue.issue.features, ["auth"]);
    } finally {
      await harness.stop();
    }
  });

  it("filters a listing by the field the plugin added", async () => {
    const harness = await startHarness({ env: ENV });
    try {
      await harness.gql(
        `mutation { createFeature(input: { title: "Auth", slug: "auth" }) { feature { slug } } }`,
      );
      await harness.gql(
        `mutation { openIssue(input: { title: "Attached", body: "b.", features: ["auth"] }) { issue { id } } }`,
      );
      await harness.gql(
        `mutation { openIssue(input: { title: "Loose", body: "b." }) { issue { id } } }`,
      );

      const found = await harness.gql<{ issues: { title: string }[] }>(
        `{ issues(filter: { features: ["auth"] }) { title } }`,
      );
      assert.deepEqual(found.errors, []);
      assert.deepEqual(
        found.data?.issues.map((issue) => issue.title),
        ["Attached"],
      );
    } finally {
      await harness.stop();
    }
  });

  it("reports a feature's members and its documents", async () => {
    const harness = await startHarness({ env: ENV });
    try {
      await harness.gql(
        `mutation { createFeature(input: { title: "Auth", slug: "auth" }) { feature { slug } } }`,
      );
      await harness.gql(
        `mutation { addSpec(input: { feature: "auth", title: "Login flow", body: "It SHALL." }) { spec { fileName } } }`,
      );
      await harness.gql(
        `mutation { openIssue(input: { title: "T", body: "b.", features: ["auth"] }) { issue { id } } }`,
      );
      const read = await harness.gql<{
        feature: { specs: { fileName: string }[]; issues: { title: string }[] };
      }>(`{ feature(slug: "auth") { specs { fileName title } issues { title } } }`);
      assert.deepEqual(read.errors, []);
      assert.deepEqual(read.data?.feature.specs[0]?.fileName, "login-flow.md");
      assert.deepEqual(read.data?.feature.issues[0]?.title, "T");
    } finally {
      await harness.stop();
    }
  });
});

describe("a plugin's mutation", () => {
  it("refuses a stale save the way the host's own do", async () => {
    const harness = await startHarness({ env: ENV });
    try {
      await harness.gql(
        `mutation { createFeature(input: { title: "Auth", slug: "auth" }) { feature { slug } } }`,
      );
      const result = await harness.gql(
        `mutation { updateFeature(input: { slug: "auth", title: "Renamed", baseSha: "0000000000000000000000000000000000000000" }) { feature { title } } }`,
      );
      // A hash this clone has never seen: the host's own words for an entity
      // read from an unknown version, and every field the patch named.
      assert.equal(result.errors[0]?.extensions?.code, "STALE_CONTENT");
      assert.match(
        result.errors[0]?.message ?? "",
        /read from a version this server does not have/,
      );
      assert.deepEqual(result.errors[0]?.extensions?.moved, ["title"]);
    } finally {
      await harness.stop();
    }
  });

  it("emits the mutation event, so a service hears about a feature too", async () => {
    // The event is emitted by the host's `commitInfo`, which the plugin calls
    // through `host.api` — so a chat bridge learns about a feature without
    // either of them knowing the other exists.
    const harness = await startHarness({ env: ENV });
    try {
      const made = await harness.gql<{ createFeature: { commit: { subject: string } } }>(
        `mutation { createFeature(input: { title: "Auth", slug: "auth" }) { commit { subject committed } } }`,
      );
      assert.deepEqual(made.errors, []);
      assert.equal(made.data?.createFeature.commit.subject, "docs(feature): create auth");
    } finally {
      await harness.stop();
    }
  });
});

describe("without the plugin", () => {
  it("serves a schema with no feature in it at all", async () => {
    const harness = await startHarness();
    try {
      const result = await harness.gql("{ features { slug } }");
      assert.ok(result.errors.length > 0);
      assert.match(result.errors[0]?.message ?? "", /Cannot query field "features"/);
    } finally {
      await harness.stop();
    }
  });
});
