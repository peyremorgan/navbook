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
import { AUDIENCE } from "../helpers/oidc.ts";

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

  it("says at startup that, with no policy, anyone the issuer signs for is admitted", () => {
    // This harness runs without one; `authorization.test.ts` is the other case.
    assert.match(h.stderr(), /warning: no authorization policy; every token the provider signs/);
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

  it("accepts a token whose audience is a list that includes this one", async () => {
    // Better Auth appends its userinfo URL to `aud` whenever `openid` was
    // asked for, so a token it mints for the API names two audiences.
    const both = await h.token({
      audience: [AUDIENCE, "https://id.example.invalid/api/auth/oauth2/userinfo"],
    });
    const data = ok<{ viewer: { email: string } }>(await h.gql(VIEWER, undefined, both));
    assert.equal(data.viewer.email, "person@example.invalid");
  });

  it("refuses a token whose audience is a list that leaves this one out", async () => {
    const others = await h.token({ audience: ["some-other-service", "and-another"] });
    assert.equal(errorCode(await h.gql(VIEWER, undefined, others)), "UNAUTHENTICATED");
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

describe("the GraphiQL explorer", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ graphiql: true });
  });

  after(async () => {
    await h.stop();
  });

  it("serves the explorer page without a token", async () => {
    // The page itself is static HTML, so it is reachable unauthenticated; a
    // person pastes their own Authorization header into it to run anything.
    const response = await fetch(`http://127.0.0.1:${h.port}/graphql`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /graphiql/i);
  });

  it("still refuses an operation sent without one", async () => {
    // Reaching the explorer is not reaching the data.
    assert.equal(errorCode(await h.gql(VIEWER, undefined, null)), "UNAUTHENTICATED");
  });

  it("does not answer introspection without a token either", async () => {
    const response = await h.gql(`query { __schema { types { name } } }`, undefined, null);
    assert.equal(errorCode(response), "UNAUTHENTICATED");
  });
});

describe("authentication with a discovered provider", () => {
  let h: Harness;

  before(async () => {
    // Told only where the discovery document is, so the server must fetch it
    // and take both the issuer and the key set from it, the way it would from
    // a real provider.
    h = await startHarness({ discover: true });
  });

  after(async () => {
    await h.stop();
  });

  it("finds the issuer and the key set through OpenID discovery", async () => {
    const data = ok<{ viewer: { email: string } }>(await h.gql(VIEWER));
    assert.equal(data.viewer.email, "person@example.invalid");
  });

  it("still checks the issuer the document declared", async () => {
    const response = await h.gql(
      VIEWER,
      undefined,
      await h.token({ issuer: "https://other.invalid" }),
    );
    assert.equal(errorCode(response), "UNAUTHENTICATED");
  });
});

describe("a provider whose discovery document is not under its issuer", () => {
  let h: Harness;

  before(async () => {
    // The issuer is `http://host/api/auth`; `http://host/api/auth/.well-known/…`
    // is a 404, and the document sits at the host root. Discovery by issuer
    // cannot find it, discovery by URL can.
    h = await startHarness({ discover: true, issuerPath: "/api/auth" });
  });

  after(async () => {
    await h.stop();
  });

  it("accepts its tokens", async () => {
    assert.match(h.issuer.issuer, /\/api\/auth$/);
    const data = ok<{ viewer: { email: string } }>(await h.gql(VIEWER));
    assert.equal(data.viewer.email, "person@example.invalid");
  });
});
