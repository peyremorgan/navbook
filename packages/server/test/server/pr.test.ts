/**
 * Pull requests, which are not where you look for them.
 *
 * A PR's files live on the branch it proposes to merge (spec 03 §3.5), so the
 * branch the server has checked out does not hold them. Everything here turns
 * on that: finding them, and reviewing one that is not in the working tree.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

interface PrShape {
  id: string;
  title: string;
  status: string;
  target: string;
  source: string;
  draft: boolean;
  refs: string[];
  revisions: { head: string; base: string; date: string }[];
  merged: unknown;
}

describe("pull requests", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ pullIntervalMs: 0 });
    // Opened from a terminal on its own branch, then pushed — which is how a
    // pull request reaches a server that never opens one itself.
    h.fixture.peer.filePr("Fix the login", "Here is the change.", "pr111111", "fix-login");
    const pushed = h.fixture.peer.git(["push", "--quiet", "origin", "fix-login:fix-login"]);
    assert.equal(pushed.code, 0, pushed.stderr);
  });

  after(async () => {
    await h.stop();
  });

  it("does not list a pull request that is on another branch", async () => {
    // The working tree genuinely does not hold it, and saying otherwise would
    // be inventing a view the checkout does not have.
    const data = ok<{ prs: PrShape[] }>(await h.gql(`query { prs { id } }`));
    assert.deepEqual(data.prs, []);
  });

  it("finds it by scanning the fetched branches", async () => {
    const data = ok<{ prs: PrShape[] }>(
      await h.gql(
        `query { prs(allRefs: true) {
           id title status target source draft refs
           revisions { head base date }
           merged { date by commit }
         } }`,
      ),
    );

    assert.equal(data.prs.length, 1);
    const pr = data.prs[0] as PrShape;
    assert.equal(pr.id, "pr111111");
    assert.equal(pr.title, "Fix the login");
    assert.equal(pr.status, "OPEN");
    assert.equal(pr.target, "main");
    assert.equal(pr.source, "fix-login");
    assert.equal(pr.draft, false);
    assert.equal(pr.merged, null);
    // The branches it was actually found on, not an aggregate truth.
    assert.deepEqual(pr.refs, ["origin/fix-login"]);

    assert.equal(pr.revisions.length, 1);
    assert.match(pr.revisions[0]?.head ?? "", /^[0-9a-f]{40}$/);
    assert.match(pr.revisions[0]?.base ?? "", /^[0-9a-f]{40}$/);
  });

  it("shows one by id, falling back to the branches", async () => {
    const data = ok<{ pr: PrShape }>(
      await h.gql(`query Q($ref: ID!) { pr(ref: $ref) { id title refs } }`, { ref: "pr11" }),
    );
    assert.equal(data.pr.id, "pr111111");
    assert.deepEqual(data.pr.refs, ["origin/fix-login"]);
  });

  it("filters a cross-ref listing like any other", async () => {
    const matched = ok<{ prs: { id: string }[] }>(
      await h.gql(`query { prs(filter: { text: ["login"] }, allRefs: true) { id } }`),
    );
    assert.deepEqual(matched.prs, [{ id: "pr111111" }]);

    const missed = ok<{ prs: { id: string }[] }>(
      await h.gql(`query { prs(filter: { labels: ["nope"] }, allRefs: true) { id } }`),
    );
    assert.deepEqual(missed.prs, []);
  });

  it("refuses to comment on one this checkout does not hold, saying where it is", async () => {
    // Writing the comment here would put it in a directory with no pr.md
    // beside it, which is a stranded comment (spec 03 §3.3.1), not a review.
    const response = await h.gql(
      `mutation R($ref: ID!) {
         addComment(input: { kind: PR, ref: $ref, body: "x" }) { comment { id } }
       }`,
      { ref: "pr111111" },
    );
    assert.equal(errorCode(response), "PRECONDITION");
    assert.equal(response.errors[0]?.extensions?.sourceRef, "origin/fix-login");
    assert.match(response.errors[0]?.message ?? "", /does not have checked out/);
  });

  it("points an issue query at a pull request back at the right noun", async () => {
    const response = await h.gql(`query { issue(ref: "pr111111") { id } }`);
    // The id is real, but it names a pull request. The working tree does not
    // hold it, so NOT_FOUND is the honest answer from here.
    assert.ok(["WRONG_KIND", "NOT_FOUND"].includes(errorCode(response) ?? ""));
  });
});

describe("reviewing, on the branch that carries the pull request", () => {
  let h: Harness;
  let head: string;

  before(async () => {
    h = await startHarness({
      pullIntervalMs: 0,
      // A server serving the PR's own branch is the deployment in which
      // reviewing is meaningful, because the files are here.
      prepare: (fixture) => {
        fixture.server.filePr("Fix the login", "Here is the change.", "pr111111", "fix-login");
        fixture.server.git(["checkout", "--quiet", "fix-login"]);
      },
    });
    head = ok<{ pr: { revisions: { head: string }[] } }>(
      await h.gql(`query { pr(ref: "pr111111") { revisions { head } } }`),
    ).pr.revisions[0]?.head as string;
  });

  after(async () => {
    await h.stop();
  });

  it("lists it from the working tree, with no refs to report", async () => {
    const data = ok<{ prs: { id: string; refs: string[] }[] }>(
      await h.gql(`query { prs { id refs } }`),
    );
    assert.deepEqual(data.prs, [{ id: "pr111111", refs: [] }]);
  });

  it("records a review, binding the verdict to the latest revision", async () => {
    const added = ok<{
      addComment: {
        comment: { id: string; verdict: string; revision: string; file: string; line: string };
        entity: { id: string };
        commit: { subject: string; pushed: boolean };
      };
    }>(
      await h.gql(
        `mutation Review($ref: ID!) {
           addComment(input: {
             kind: PR, ref: $ref, body: "Looks right.",
             verdict: APPROVE, file: "src/login.ts", line: "12-15"
           }) {
             comment { id verdict revision file line }
             entity { id }
             commit { subject pushed }
           }
         }`,
        { ref: "pr111111" },
      ),
    ).addComment;

    assert.equal(added.comment.verdict, "APPROVE");
    // Bound to the latest recorded revision, since none was named.
    assert.equal(added.comment.revision, head);
    assert.equal(added.comment.file, "src/login.ts");
    assert.equal(added.comment.line, "12-15");
    assert.equal(added.entity.id, "pr111111");
    // A verdict is what makes it a review rather than a comment, and the
    // commit subject says so.
    assert.equal(added.commit.subject, "docs(pr): review #pr111111");
    assert.equal(added.commit.pushed, true);
  });

  it("binds to a revision named by prefix", async () => {
    const added = ok<{ addComment: { comment: { revision: string } } }>(
      await h.gql(
        `mutation R($ref: ID!, $rev: String!) {
           addComment(input: {
             kind: PR, ref: $ref, body: "Pinned.", verdict: REQUEST_CHANGES, revision: $rev
           }) { comment { revision } }
         }`,
        { ref: "pr111111", rev: head.slice(0, 7) },
      ),
    ).addComment;
    assert.equal(added.comment.revision, head);
  });

  it("renders a plain line number as a string", async () => {
    const added = ok<{ addComment: { comment: { line: string; verdict: string | null } } }>(
      await h.gql(
        `mutation R($ref: ID!) {
           addComment(input: { kind: PR, ref: $ref, body: "Here.", file: "src/a.ts", line: "7" }) {
             comment { line verdict }
           }
         }`,
        { ref: "pr111111" },
      ),
    ).addComment;
    assert.equal(added.comment.line, "7");
    // No verdict, so it is a comment that points at a line, not a review.
    assert.equal(added.comment.verdict, null);
  });

  it("adds a plain comment with no review fields at all", async () => {
    const added = ok<{
      addComment: { comment: { verdict: null; revision: null; file: null; line: null } };
    }>(
      await h.gql(
        `mutation R($ref: ID!) {
           addComment(input: { kind: PR, ref: $ref, body: "Just a thought." }) {
             comment { verdict revision file line }
           }
         }`,
        { ref: "pr111111" },
      ),
    ).addComment;
    assert.deepEqual(added.comment, { verdict: null, revision: null, file: null, line: null });
  });

  it("refuses a review bound to a revision the pull request never had", async () => {
    const response = await h.gql(
      `mutation R($ref: ID!) {
         addComment(input: {
           kind: PR, ref: $ref, body: "x", verdict: APPROVE, revision: "deadbeef"
         }) { comment { id } }
       }`,
      { ref: "pr111111" },
    );
    assert.equal(errorCode(response), "NOT_FOUND");
  });

  it("reads the reviews back on the pull request", async () => {
    const data = ok<{ pr: { comments: { body: string; verdict: string | null }[] } }>(
      await h.gql(`query { pr(ref: "pr111111") { comments { body verdict } } }`),
    );
    assert.ok(data.pr.comments.length >= 4);
    assert.ok(data.pr.comments.some((c) => c.verdict === "APPROVE"));
    assert.ok(data.pr.comments.some((c) => c.verdict === "REQUEST_CHANGES"));
    assert.ok(data.pr.comments.some((c) => c.verdict === null));
  });
});
