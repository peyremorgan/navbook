/**
 * The review policy over the API — spec 02 §2.10.
 *
 * The API's job here is to report, never to enforce: it exposes what the
 * marker declares, what was wrong with it, and the approvals the decision
 * counted, so a client can explain a `PENDING` badge instead of merely drawing
 * one. Nothing it serves refuses anything, because the API exposes no merge.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";

const marker = (review?: unknown): string =>
  `${JSON.stringify(review === undefined ? { version: 1 } : { version: 1, review }, null, 2)}\n`;

const POLICY_QUERY = `query { reviewPolicy { selfReview minApprovals declared problems } }`;

interface PolicyShape {
  selfReview: boolean;
  minApprovals: number;
  declared: boolean;
  problems: string[];
}

/** A server on the pull request's own branch, so its reviews are readable. */
async function servingAPr(markerText: string): Promise<Harness> {
  return startHarness({
    pullIntervalMs: 0,
    marker: markerText,
    prepare: (fixture) => {
      fixture.server.filePr("Fix the login", "Here is the change.", "pr111111", "fix-login");
      fixture.server.git(["checkout", "--quiet", "fix-login"]);
    },
  });
}

/** Approve the fixture pull request as the signed-in viewer. */
async function approve(h: Harness, body: string, auth?: string): Promise<void> {
  const response = await h.gql(
    `mutation R { addComment(input: { kind: PR, ref: "pr111111", body: "${body}", verdict: APPROVE }) { comment { id } } }`,
    {},
    auth,
  );
  ok(response);
}

describe("a repository that declares no policy", () => {
  let h: Harness;
  before(async () => {
    h = await servingAPr(marker());
  });
  after(async () => {
    await h.stop();
  });

  it("serves the defaults, and says they were not declared", async () => {
    const data = ok<{ reviewPolicy: PolicyShape }>(await h.gql(POLICY_QUERY));
    assert.deepEqual(data.reviewPolicy, {
      selfReview: false,
      minApprovals: 1,
      declared: false,
      problems: [],
    });
  });

  it("counts one approval as enough", async () => {
    await approve(h, "Looks right.");
    const data = ok<{
      pr: { reviewDecision: string; approvals: { given: number; required: number } };
    }>(
      await h.gql(`query { pr(ref: "pr111111") { reviewDecision approvals { given required } } }`),
    );
    assert.equal(data.pr.reviewDecision, "APPROVED");
    assert.deepEqual(data.pr.approvals, { given: 1, required: 1 });
  });
});

describe("a repository that asks for two approvals", () => {
  let h: Harness;
  before(async () => {
    h = await servingAPr(marker({ selfReview: false, minApprovals: 2 }));
  });
  after(async () => {
    await h.stop();
  });

  it("serves what it declared", async () => {
    const data = ok<{ reviewPolicy: PolicyShape }>(await h.gql(POLICY_QUERY));
    assert.deepEqual(data.reviewPolicy, {
      selfReview: false,
      minApprovals: 2,
      declared: true,
      problems: [],
    });
  });

  it("reads one approval as pending, and says how far short it is", async () => {
    await approve(h, "Looks right.");
    const data = ok<{
      pr: { reviewDecision: string; approvals: { given: number; required: number } };
    }>(
      await h.gql(`query { pr(ref: "pr111111") { reviewDecision approvals { given required } } }`),
    );
    assert.equal(data.pr.reviewDecision, "PENDING");
    assert.deepEqual(data.pr.approvals, { given: 1, required: 2 });
  });

  it("reads the second approval as enough", async () => {
    // A second person, since a state is per person however often they say it.
    await approve(h, "Agreed.", await h.token({ email: "second@example.com" }));
    const data = ok<{
      pr: { reviewDecision: string; approvals: { given: number; required: number } };
    }>(
      await h.gql(`query { pr(ref: "pr111111") { reviewDecision approvals { given required } } }`),
    );
    assert.equal(data.pr.reviewDecision, "APPROVED");
    assert.deepEqual(data.pr.approvals, { given: 2, required: 2 });
  });

  it("counts a listing the same way it counts one pull request", async () => {
    const data = ok<{ prs: { id: string; approvals: { given: number; required: number } }[] }>(
      await h.gql(`query { prs { id approvals { given required } } }`),
    );
    assert.deepEqual(data.prs, [{ id: "pr111111", approvals: { given: 2, required: 2 } }]);
  });
});

describe("a repository that allows self-review", () => {
  let h: Harness;
  before(async () => {
    h = await servingAPr(marker({ selfReview: true }));
  });
  after(async () => {
    await h.stop();
  });

  it("counts the author's own approval", async () => {
    // The fixture's pull request is filed by the same identity the harness
    // signs in as, so this is an author approving their own work.
    await approve(h, "Mine, and it counts.");
    const data = ok<{
      pr: { reviewDecision: string; reviews: { person: string; state: string }[] };
    }>(await h.gql(`query { pr(ref: "pr111111") { reviewDecision reviews { person state } } }`));
    assert.equal(data.pr.reviewDecision, "APPROVED");
    assert.equal(data.pr.reviews.length, 1);
    assert.equal(data.pr.reviews[0]?.state, "APPROVE");
  });
});

describe("a marker nobody can read", () => {
  let h: Harness;
  before(async () => {
    h = await servingAPr('{"version": 1, "review": {"selfReview": "yes", "minApprovals": 0}}\n');
  });
  after(async () => {
    await h.stop();
  });

  it("serves the defaults and says what was wrong, rather than failing", async () => {
    const data = ok<{ reviewPolicy: PolicyShape }>(await h.gql(POLICY_QUERY));
    // Still declared: somebody wrote a policy down, and both of its values
    // fell back on their own. `problems` is what says why the numbers beside
    // them are the defaults.
    assert.equal(data.reviewPolicy.declared, true);
    assert.equal(data.reviewPolicy.selfReview, false);
    assert.equal(data.reviewPolicy.minApprovals, 1);
    assert.equal(data.reviewPolicy.problems.length, 2);
  });

  it("still answers every other question about the pull request", async () => {
    const data = ok<{ pr: { id: string; reviewDecision: string } }>(
      await h.gql(`query { pr(ref: "pr111111") { id reviewDecision } }`),
    );
    assert.equal(data.pr.id, "pr111111");
    assert.equal(data.pr.reviewDecision, "PENDING");
  });

  it("reports it as a doctor error, which is where the whole story is", async () => {
    const data = ok<{ doctor: { diagnostics: { check: string; path: string }[] } }>(
      await h.gql(`query { doctor { diagnostics { check path } } }`),
    );
    const d15 = data.doctor.diagnostics.filter((d) => d.check === "D15");
    assert.equal(d15.length, 2);
    // Relative to the Navbook directory, as every diagnostic path is.
    assert.equal(d15[0]?.path, "navbook.json");
  });
});
