/**
 * Who gets in.
 *
 * There is no unauthenticated mode, so every one of these is a real token
 * verified against a real JWKS — including the ones that must be refused. The
 * refusals are all the same answer on purpose: which check failed is more use
 * to somebody probing than to a client.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

const VIEWER = `query { viewer { name email } }`;

describe("authentication", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness();
  });

  after(async () => {
    await h.stop();
  });

  it("accepts a properly signed token", async () => {
    const data = ok<{ viewer: { name: string; email: string } }>(await h.gql(VIEWER));
    assert.deepEqual(data.viewer, { name: "A Person", email: "person@example.invalid" });
  });

  it("refuses a request with no token at all", async () => {
    const response = await h.gql(VIEWER, undefined, null);
    assert.equal(errorCode(response), "UNAUTHENTICATED");
    assert.equal(response.status, 401);
  });

  it("refuses a malformed header and a token that is not a JWT", async () => {
    for (const bad of ["not-a-token", "", "   "]) {
      assert.equal(errorCode(await h.gql(VIEWER, undefined, bad)), "UNAUTHENTICATED");
    }
  });

  it("refuses a token signed with a key the issuer does not publish", async () => {
    const forged = await h.token({ wrongKey: true });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, forged)), "UNAUTHENTICATED");
  });

  it("refuses an expired token", async () => {
    const stale = await h.token({ expired: true });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, stale)), "UNAUTHENTICATED");
  });

  it("refuses a token with no expiry at all", async () => {
    // An expiry is only checked when present, so a token issued once without
    // one would otherwise be accepted for as long as the signing key lived.
    const forever = await h.token({ noExpiry: true });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, forever)), "UNAUTHENTICATED");
  });

  it("refuses a token minted for another audience", async () => {
    const elsewhere = await h.token({ audience: "some-other-service" });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, elsewhere)), "UNAUTHENTICATED");
  });

  it("refuses a token claiming another issuer", async () => {
    const impostor = await h.token({ issuer: "https://issuer.invalid" });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, impostor)), "UNAUTHENTICATED");
  });

  it("refuses a valid token that carries no email claim", async () => {
    // Valid, but of no use: `author:` is built from the email, and committing
    // as somebody anonymous is worse than refusing.
    const anonymous = await h.token({ noEmail: true });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, anonymous)), "UNAUTHENTICATED");
  });

  it("accepts a token with an email but no name", async () => {
    const bare = await h.token({ email: "bare@example.invalid", name: undefined });
    const data = ok<{ viewer: { name: string | null; email: string } }>(
      await h.gql(VIEWER, undefined, bare),
    );
    assert.deepEqual(data.viewer, { name: null, email: "bare@example.invalid" });
  });

  it("guards mutations as well as queries", async () => {
    const response = await h.gql(
      `mutation { openIssue(input: { title: "Sneaky", body: "x" }) { issue { id } } }`,
      undefined,
      null,
    );
    assert.equal(errorCode(response), "UNAUTHENTICATED");
    // Nothing was filed, because the token was checked before any operation ran.
    const issues = ok<{ issues: unknown[] }>(await h.gql(`query { issues { id } }`));
    assert.deepEqual(issues.issues, []);
  });
});

describe("authentication with a discovered JWKS", () => {
  let h: Harness;

  before(async () => {
    // Told only the issuer, so the server must fetch its discovery document
    // and find the key set the way it would from a real provider.
    h = await startHarness({ discover: true });
  });

  after(async () => {
    await h.stop();
  });

  it("finds the key set through OpenID discovery", async () => {
    const data = ok<{ viewer: { email: string } }>(await h.gql(VIEWER));
    assert.equal(data.viewer.email, "person@example.invalid");
  });
});
