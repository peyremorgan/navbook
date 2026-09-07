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

  it("refuses to patch one this checkout does not hold, saying where it is", async () => {
    // There is no `pr.md` on this branch to patch at all, so the answer is the
    // same as for a comment: serve the branch that carries it.
    const response = await h.gql(
      `mutation P($ref: ID!) {
         updatePr(input: { ref: $ref, reviewers: ["alice@example.com"] }) { pr { id } }
       }`,
      { ref: "pr111111" },
    );
    assert.equal(errorCode(response), "PRECONDITION");
    assert.equal(response.errors[0]?.extensions?.sourceRef, "origin/fix-login");
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

  it("asks people to review, writing the key the format spells singular", async () => {
    const patched = ok<{
      updatePr: { pr: { reviewers: string[] }; commit: { subject: string; pushed: boolean } };
    }>(
      await h.gql(
        `mutation P($ref: ID!, $who: [String!]) {
           updatePr(input: { ref: $ref, reviewers: $who }) {
             pr { reviewers }
             commit { subject pushed }
           }
         }`,
        { ref: "pr111111", who: ["alice@example.com", "bo@example.com"] },
      ),
    ).updatePr;

    assert.deepEqual(patched.pr.reviewers, ["alice@example.com", "bo@example.com"]);
    assert.equal(patched.commit.subject, "docs(pr): edit #pr111111");
    assert.equal(patched.commit.pushed, true);
  });

  it("reports what each reviewer said about the latest revision", async () => {
    const data = ok<{
      pr: {
        reviewDecision: string;
        reviews: { person: string; state: string; volunteer: boolean; comment: string | null }[];
      };
    }>(
      await h.gql(
        `query { pr(ref: "pr111111") {
           reviewDecision
           reviews { person state volunteer comment }
         } }`,
      ),
    );

    // Neither person asked has answered, and both stay listed as pending with
    // nothing to point at. Everyone asked comes first, in the order the file
    // asks them (spec 02 §2.7).
    assert.deepEqual(data.pr.reviews.slice(0, 2), [
      { person: "alice@example.com", state: "PENDING", volunteer: false, comment: null },
      { person: "bo@example.com", state: "PENDING", volunteer: false, comment: null },
    ]);

    // The reviews recorded above were written through the API, so their author
    // is the token's identity rather than the pull request's — a volunteer,
    // whose verdict counts exactly as much as an invited one does. Which of
    // them is the latest is deliberately not asserted: they were written in the
    // same second, so the tie falls to the comment ids, exactly as the rendered
    // thread orders them.
    const volunteer = data.pr.reviews[2];
    assert.equal(volunteer?.person, "A Person <person@example.invalid>");
    assert.equal(volunteer?.volunteer, true);
    assert.ok(["APPROVE", "REQUEST_CHANGES"].includes(volunteer?.state ?? ""), volunteer?.state);
    assert.match(String(volunteer?.comment), /^[a-z][a-z0-9]{7}$/);
  });

  it("answers a request made of somebody the API never signed in", async () => {
    // Written by hand on the branch: the format's first-class path, and the
    // only way to get a review by one of the invited reviewers into a fixture
    // whose every API write carries the same token.
    const revision = ok<{ pr: { revisions: { head: string }[] } }>(
      await h.gql(`query { pr(ref: "pr111111") { revisions { head } } }`),
    ).pr.revisions[0]?.head as string;
    h.fixture.server.write(
      ".navbook/prs/open/pr111111-fix-the-login/comments/2026-08-09T101010Z-rv111111.md",
      `---\nauthor: alice@example.com\nverdict: request-changes\nrevision: ${revision}\n---\n\nNot yet.\n`,
    );
    h.fixture.server.commitAll("docs(pr): review #pr111111");

    const data = ok<{
      pr: { reviews: { person: string; state: string; comment: string }[] };
    }>(await h.gql(`query { pr(ref: "pr111111") { reviews { person state comment } } }`));
    assert.equal(data.pr.reviews[0]?.state, "REQUEST_CHANGES");
    assert.equal(data.pr.reviews[0]?.comment, "rv111111");
  });

  it("filters a listing by the request and by what it came to", async () => {
    const ids = async (filter: string): Promise<string[]> =>
      ok<{ prs: { id: string }[] }>(await h.gql(`query { prs(filter: ${filter}) { id } }`)).prs.map(
        (pr) => pr.id,
      );

    assert.deepEqual(await ids(`{ reviewers: ["alice@example.com"] }`), ["pr111111"]);
    assert.deepEqual(await ids(`{ reviewers: ["nobody@example.com"] }`), []);
    // Alice blocks, and a block outranks anything the volunteer said.
    assert.deepEqual(await ids(`{ reviews: [CHANGES_REQUESTED] }`), ["pr111111"]);
    assert.deepEqual(await ids(`{ reviews: [APPROVED] }`), []);
    assert.deepEqual(await ids(`{ reviews: [APPROVED, CHANGES_REQUESTED] }`), ["pr111111"]);
    assert.deepEqual(await ids(`{ awaiting: ["bo@example.com"] }`), ["pr111111"]);
    assert.deepEqual(await ids(`{ awaiting: ["alice@example.com"] }`), []);
  });

  it("clears the request with an empty list, and leaves it alone when unmentioned", async () => {
    const reviewers = async (patch: string): Promise<string[]> =>
      ok<{ updatePr: { pr: { reviewers: string[] } } }>(
        await h.gql(
          `mutation P($ref: ID!) { updatePr(input: { ref: $ref, ${patch} }) { pr { reviewers } } }`,
          { ref: "pr111111" },
        ),
      ).updatePr.pr.reviewers;

    assert.deepEqual(await reviewers(`milestone: "v2"`), ["alice@example.com", "bo@example.com"]);
    assert.deepEqual(await reviewers(`reviewers: []`), []);
  });

  it("refuses a reviewer who is not a person, before anything is written", async () => {
    const reviewers = async (): Promise<string[]> =>
      ok<{ pr: { reviewers: string[] } }>(
        await h.gql(`query { pr(ref: "pr111111") { reviewers } }`),
      ).pr.reviewers;
    const before = await reviewers();

    const response = await h.gql(
      `mutation P($ref: ID!) {
         updatePr(input: { ref: $ref, reviewers: ["the-auth-team"] }) { pr { reviewers } }
       }`,
      { ref: "pr111111" },
    );
    // The same refusal a composed file gets anywhere else: it is validated
    // before the tree is touched, so there is nothing written to undo.
    assert.equal(errorCode(response), "INVALID_INPUT");
    assert.deepEqual(await reviewers(), before, "and the pull request still says what it said");
  });

  it("refuses a patch that names nothing to change", async () => {
    const response = await h.gql(
      `mutation P($ref: ID!) { updatePr(input: { ref: $ref }) { pr { id } } }`,
      { ref: "pr111111" },
    );
    assert.equal(errorCode(response), "INVALID_INPUT");
  });

  /**
   * The same rule as `issues`: naming no status names no filter. Worth its own
   * assertion because `merged` exists only for pull requests, so this is the
   * listing where "any status" reaches widest.
   *
   * Last in the file because it declines the pull request the tests above
   * review, and a closed one is not what they are about.
   */
  it("keeps listing it once it is declined, until a status narrows it away", async () => {
    h.fixture.server.close("pr", "pr111111", "wontfix");

    const all = ok<{ prs: { id: string; status: string }[] }>(
      await h.gql(`query { prs { id status } }`),
    );
    assert.deepEqual(all.prs, [{ id: "pr111111", status: "CLOSED" }]);

    const open = ok<{ prs: { id: string }[] }>(
      await h.gql(`query { prs(filter: { status: [OPEN] }) { id } }`),
    );
    assert.deepEqual(open.prs, []);

    const gone = ok<{ prs: { id: string }[] }>(
      await h.gql(`query { prs(filter: { status: [CLOSED, MERGED] }) { id } }`),
    );
    assert.deepEqual(gone.prs, [{ id: "pr111111" }]);
  });
});
