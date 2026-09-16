/**
 * Who, among those who get in, is let in.
 *
 * Every token here verifies: signed by the issuer, for the audience, with an
 * expiry and an email. What differs is what else it carries, and whether the
 * policy the server was started with admits it. A refusal is `FORBIDDEN`, not
 * `UNAUTHENTICATED`, because the person is signed in, and the reason is in
 * the server's log rather than in the answer.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

const VIEWER = `query { viewer { name email } }`;
const OPEN_ISSUE = `mutation { openIssue(input: { title: "Sneaky", body: "x" }) { issue { id } } }`;

describe("a policy requiring a role", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ policy: { requireClaims: ["roles=d3952bfb::developer"] } });
  });

  after(async () => {
    await h.stop();
  });

  it("admits a token whose roles array carries the role", async () => {
    const member = await h.token({
      email: "dev@example.invalid",
      claims: { roles: ["reader", "d3952bfb::developer"] },
    });
    const data = ok<{ viewer: { email: string } }>(await h.gql(VIEWER, undefined, member));
    assert.equal(data.viewer.email, "dev@example.invalid");
  });

  it("admits the same role in a space-separated string, as Better Auth mints it", async () => {
    const member = await h.token({ claims: { roles: "reader d3952bfb::developer" } });
    ok(await h.gql(VIEWER, undefined, member));
  });

  it("refuses a verified token without the role, as FORBIDDEN with a 403", async () => {
    const outsider = await h.token({ claims: { roles: ["other::role"] } });
    const response = await h.gql(VIEWER, undefined, outsider);
    assert.equal(errorCode(response), "FORBIDDEN");
    assert.equal(response.status, 403);
    // The message says they are not allowed, and nothing about what would be.
    assert.doesNotMatch(response.errors[0]?.message ?? "", /roles|developer/);
  });

  it("refuses a token with no roles claim at all, the same way", async () => {
    // The harness's default token: a name and an email, nothing else.
    assert.equal(errorCode(await h.gql(VIEWER)), "FORBIDDEN");
  });

  it("refuses a role that merely contains the required one", async () => {
    const near = await h.token({ claims: { roles: ["d3952bfb::developers"] } });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, near)), "FORBIDDEN");
  });

  it("guards mutations, and nothing is filed", async () => {
    const outsider = await h.token({ claims: { roles: [] } });
    assert.equal(errorCode(await h.gql(OPEN_ISSUE, undefined, outsider)), "FORBIDDEN");

    const member = await h.token({ claims: { roles: ["d3952bfb::developer"] } });
    const issues = ok<{ issues: unknown[] }>(await h.gql(`query { issues { id } }`, {}, member));
    assert.deepEqual(issues.issues, []);
  });

  it("still answers a bad token with UNAUTHENTICATED, before the policy is consulted", async () => {
    const forged = await h.token({ wrongKey: true, claims: { roles: ["d3952bfb::developer"] } });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, forged)), "UNAUTHENTICATED");
    const anonymous = await h.token({ noEmail: true, claims: { roles: ["d3952bfb::developer"] } });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, anonymous)), "UNAUTHENTICATED");
  });

  it("names the rule that failed, and whom, in the log alone", async () => {
    const outsider = await h.token({
      email: "outsider@example.invalid",
      claims: { roles: ["other::role"] },
    });
    await h.gql(VIEWER, undefined, outsider);
    assert.match(h.stderr(), /refused outsider@example\.invalid: .*'roles'.*'d3952bfb::developer'/);
  });

  it("does not warn at startup that the deployment is open", () => {
    assert.doesNotMatch(h.stderr(), /no authorization policy/);
  });
});

describe("a policy of several rules", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({
      policy: {
        requireClaims: ["roles=member", "scope=navbook"],
        allowEmailDomains: ["example.invalid"],
        requireEmailVerified: true,
      },
    });
  });

  after(async () => {
    await h.stop();
  });

  const admitted = {
    roles: "member",
    scope: "openid profile navbook",
    email_verified: true,
  };

  it("admits a token that satisfies every rule", async () => {
    const member = await h.token({ email: "a@Example.invalid", claims: admitted });
    ok(await h.gql(VIEWER, undefined, member));
  });

  it("refuses one that fails any of them", async () => {
    for (const [what, token] of [
      ["a missing claim", await h.token({ claims: { ...admitted, scope: "openid" } })],
      ["another domain", await h.token({ email: "a@other.invalid", claims: admitted })],
      ["a subdomain", await h.token({ email: "a@sub.example.invalid", claims: admitted })],
      ["an unverified email", await h.token({ claims: { ...admitted, email_verified: false } })],
      ["a verified string", await h.token({ claims: { ...admitted, email_verified: "true" } })],
    ] as const) {
      assert.equal(errorCode(await h.gql(VIEWER, undefined, token)), "FORBIDDEN", what);
    }
  });
});

describe("no policy at all", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("admits anyone the issuer signs for, and says so at startup", async () => {
    ok(await h.gql(VIEWER));
    assert.match(h.stderr(), /warning: no authorization policy; every token the provider signs/);
  });
});
