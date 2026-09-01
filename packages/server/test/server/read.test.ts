/**
 * The read half, over HTTP.
 *
 * Every assertion here goes through a real request against a real clone, so
 * what is proved is what a web client would actually get back.
 *
 * IDs are taken from the payloads that made the entities rather than scripted:
 * `NAV_IDS` is a per-context hook and the server builds a context per request,
 * so a scripted list would hand the same id to every one of them.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

const OPEN = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id } }
}`;

describe("reads", () => {
  let h: Harness;
  let bug: string;
  let theme: string;

  before(async () => {
    h = await startHarness();
    bug = ok<{ openIssue: { issue: { id: string } } }>(
      await h.gql(OPEN, {
        input: {
          title: "Login is broken",
          body: "It does not work.",
          labels: ["bug", "auth"],
          assignees: ["Dev <dev@example.invalid>"],
          milestone: "v1",
        },
      }),
    ).openIssue.issue.id;

    theme = ok<{ openIssue: { issue: { id: string } } }>(
      await h.gql(OPEN, { input: { title: "Add a dark theme", body: "Please." } }),
    ).openIssue.issue.id;
  });

  after(async () => {
    await h.stop();
  });

  it("lists the open issues", async () => {
    const data = ok<{ issues: { id: string; title: string; status: string }[] }>(
      await h.gql(`query { issues { id title status } }`),
    );
    assert.deepEqual([...data.issues.map((issue) => issue.title)].sort(), [
      "Add a dark theme",
      "Login is broken",
    ]);
    assert.ok(data.issues.every((issue) => issue.status === "OPEN"));
  });

  it("projects an issue's frontmatter onto named fields", async () => {
    const data = ok<{
      issue: {
        id: string;
        slug: string;
        kind: string;
        path: string;
        archived: boolean;
        author: string;
        created: string;
        labels: string[];
        assignees: string[];
        milestone: string;
        body: string;
        comments: unknown[];
      };
    }>(
      await h.gql(
        `query Show($ref: ID!) { issue(ref: $ref) {
           id slug kind path archived author created labels assignees milestone body
           comments { id }
         } }`,
        { ref: bug },
      ),
    );
    assert.equal(data.issue.id, bug);
    assert.equal(data.issue.slug, "login-is-broken");
    assert.equal(data.issue.kind, "ISSUE");
    assert.equal(data.issue.path, `.navbook/issues/open/${bug}-login-is-broken`);
    assert.equal(data.issue.archived, false);
    // The token's identity, not the clone's committer — spec 06 §6.2.
    assert.equal(data.issue.author, "A Person <person@example.invalid>");
    assert.equal(data.issue.created, "2026-08-01T10:00:00Z");
    assert.deepEqual(data.issue.labels, ["bug", "auth"]);
    assert.deepEqual(data.issue.assignees, ["Dev <dev@example.invalid>"]);
    assert.equal(data.issue.milestone, "v1");
    assert.equal(data.issue.body, "It does not work.");
    assert.deepEqual(data.issue.comments, []);
  });

  it("leaves keys the file does not carry null, not empty", async () => {
    const data = ok<{
      issue: { milestone: string | null; resolution: string | null; duplicateOf: string | null };
    }>(
      await h.gql(
        `query Show($ref: ID!) { issue(ref: $ref) { milestone resolution duplicateOf } }`,
        {
          ref: theme,
        },
      ),
    );
    assert.deepEqual(data.issue, { milestone: null, resolution: null, duplicateOf: null });
  });

  it("resolves an issue by prefix", async () => {
    const data = ok<{ issue: { id: string } }>(
      await h.gql(`query Show($ref: ID!) { issue(ref: $ref) { id } }`, { ref: bug.slice(0, 4) }),
    );
    assert.equal(data.issue.id, bug);
  });

  it("reports a prefix that is too short, and one that matches nothing", async () => {
    assert.equal(errorCode(await h.gql(`query { issue(ref: "aa") { id } }`)), "PREFIX_TOO_SHORT");
    assert.equal(errorCode(await h.gql(`query { issue(ref: "zzzzzzzz") { id } }`)), "NOT_FOUND");
  });

  it("filters by label, milestone and text", async () => {
    const ids = async (filter: string): Promise<string[]> =>
      ok<{ issues: { id: string }[] }>(
        await h.gql(`query { issues(filter: ${filter}) { id } }`),
      ).issues.map((issue) => issue.id);

    assert.deepEqual(await ids(`{ labels: ["bug"] }`), [bug]);
    // Multi-valued keys AND their terms, so both must be present.
    assert.deepEqual(await ids(`{ labels: ["bug", "auth"] }`), [bug]);
    assert.deepEqual(await ids(`{ labels: ["bug", "nope"] }`), []);
    assert.deepEqual(await ids(`{ text: ["dark"] }`), [theme]);
    assert.deepEqual(await ids(`{ milestones: ["v1"] }`), [bug]);
    assert.deepEqual(await ids(`{ assignees: ["dev@example.invalid"] }`), [bug]);
    assert.deepEqual(await ids(`{ authors: ["person@example.invalid"] }`), [theme, bug].sort());
  });

  it("lists closed issues only when the filter asks for them", async () => {
    ok(
      await h.gql(
        `mutation Close($ref: ID!) { closeIssue(input: { ref: $ref }) { issue { id } } }`,
        {
          ref: theme,
        },
      ),
    );

    const open = ok<{ issues: { id: string }[] }>(await h.gql(`query { issues { id } }`));
    assert.deepEqual(open.issues, [{ id: bug }]);

    const closed = ok<{ issues: { id: string; status: string }[] }>(
      await h.gql(`query { issues(filter: { status: [CLOSED] }) { id status } }`),
    );
    assert.deepEqual(closed.issues, [{ id: theme, status: "CLOSED" }]);

    ok(
      await h.gql(`mutation Reopen($ref: ID!) { reopenIssue(ref: $ref) { issue { id } } }`, {
        ref: theme,
      }),
    );
  });

  it("reports who the token says is asking", async () => {
    const data = ok<{ viewer: { name: string; email: string } }>(
      await h.gql(`query { viewer { name email } }`),
    );
    assert.deepEqual(data.viewer, { name: "A Person", email: "person@example.invalid" });
  });

  it("finds nothing wrong with a tree the API itself made", async () => {
    const data = ok<{ doctor: { diagnostics: unknown[] } }>(
      await h.gql(`query { doctor { diagnostics { check level path message fixable } } }`),
    );
    assert.deepEqual(data.doctor.diagnostics, []);
  });

  it("reports what doctor finds when a file is broken by hand", async () => {
    h.fixture.server.write(".navbook/issues/open/notanid/issue.md", "---\ntitle: Bad\n---\n\nx\n");
    h.fixture.server.commitAll("break it");
    try {
      const data = ok<{ doctor: { diagnostics: { check: string; level: string }[] } }>(
        await h.gql(`query { doctor { diagnostics { check level } } }`),
      );
      assert.ok(data.doctor.diagnostics.some((d) => d.check === "D1" && d.level === "ERROR"));
    } finally {
      h.fixture.server.git(["rm", "-r", "--quiet", ".navbook/issues/open/notanid"]);
      h.fixture.server.commitAll("unbreak it");
    }
  });

  it("has no pull requests to list", async () => {
    assert.deepEqual(ok<{ prs: unknown[] }>(await h.gql(`query { prs { id } }`)).prs, []);
    assert.deepEqual(
      ok<{ prs: unknown[] }>(await h.gql(`query { prs(allRefs: true) { id refs } }`)).prs,
      [],
    );
    assert.equal(errorCode(await h.gql(`query { pr(ref: "zzzzzzzz") { id } }`)), "NOT_FOUND");
  });

  it("points a query at the wrong noun back at the right one", async () => {
    const response = await h.gql(`query Show($ref: ID!) { pr(ref: $ref) { id } }`, { ref: bug });
    // The id resolves, but it is an issue: NOT_FOUND would be misleading, so
    // the cross-ref scan's own answer stands.
    assert.ok(errorCode(response) !== null);
  });
});
