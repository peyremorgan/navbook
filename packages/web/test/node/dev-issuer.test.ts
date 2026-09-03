// @vitest-environment node

/**
 * The development issuer stands in for a real provider, so what is worth
 * testing about it is the parts a real provider would refuse: a replayed code,
 * a mismatched PKCE verifier, a redirect that was not the one agreed. If it
 * accepted those, the app could be built against a flow no deployment allows.
 */

import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { type DevIssuer, pkceOf, startDevIssuer } from "../../script/dev-issuer.ts";

const REDIRECT = "http://localhost:3000/auth/callback";
const VERIFIER = "verifier-".repeat(6);

let issuer: DevIssuer;

beforeAll(async () => {
  issuer = await startDevIssuer({ port: 0 });
});

afterAll(async () => {
  await issuer.close();
});

function authorizeUrl(overrides: Record<string, string> = {}): URL {
  const url = new URL(`${issuer.issuer}/authorize`);
  const parameters: Record<string, string> = {
    client_id: "navbook-web",
    response_type: "code",
    redirect_uri: REDIRECT,
    state: "st8",
    nonce: "n0nce",
    scope: "openid profile email offline_access",
    code_challenge: pkceOf(VERIFIER),
    code_challenge_method: "S256",
    ...overrides,
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

/** Drive the login form the way a browser would, and return the code. */
async function signIn(email = "person@example.invalid"): Promise<string> {
  const form = new URLSearchParams({
    name: "A Person",
    email,
    client_id: "navbook-web",
    redirect_uri: REDIRECT,
    state: "st8",
    nonce: "n0nce",
    audience: "navbook",
    code_challenge: pkceOf(VERIFIER),
  });
  const response = await fetch(`${issuer.issuer}/authorize/submit`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.searchParams.get("state"), "st8", "the state must come back untouched");
  return location.searchParams.get("code") ?? "";
}

async function exchange(body: Record<string, string>): Promise<{ status: number; json: never }> {
  const response = await fetch(`${issuer.issuer}/token`, {
    method: "POST",
    body: new URLSearchParams(body),
  });
  return { status: response.status, json: (await response.json()) as never };
}

function claims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("discovery", () => {
  it("advertises the endpoints and only the code flow with S256", async () => {
    const response = await fetch(`${issuer.issuer}/.well-known/openid-configuration`);
    const document = (await response.json()) as Record<string, unknown>;
    assert.equal(document.issuer, issuer.issuer);
    assert.equal(document.jwks_uri, `${issuer.issuer}/jwks`);
    assert.equal(document.authorization_endpoint, `${issuer.issuer}/authorize`);
    assert.equal(document.token_endpoint, `${issuer.issuer}/token`);
    assert.deepEqual(document.response_types_supported, ["code"]);
    assert.deepEqual(document.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(document.grant_types_supported, ["authorization_code", "refresh_token"]);
  });

  it("publishes one signing key", async () => {
    const { keys } = (await (await fetch(`${issuer.issuer}/jwks`)).json()) as { keys: unknown[] };
    assert.equal(keys.length, 1);
  });

  it("answers the browser's preflight", async () => {
    const response = await fetch(`${issuer.issuer}/token`, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

describe("authorize", () => {
  it("serves a form carrying the request forward", async () => {
    const response = await fetch(authorizeUrl());
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /name="code_challenge" value="[^"]+"/);
    assert.match(page, /name="nonce" value="n0nce"/);
    assert.match(page, /name="email"/);
  });

  it("escapes what it reflects into the page", async () => {
    const response = await fetch(authorizeUrl({ state: '"><script>alert(1)</script>' }));
    const page = await response.text();
    assert.ok(!page.includes("<script>alert(1)</script>"), "the state must not become markup");
    assert.match(page, /&quot;&gt;&lt;script&gt;/);
  });

  it("refuses a request no real provider would serve", async () => {
    const cases: [string, Record<string, string>][] = [
      ["an unknown client", { client_id: "somebody-else" }],
      ["the implicit flow", { response_type: "token" }],
      ["a plain challenge", { code_challenge_method: "plain" }],
      ["no challenge at all", { code_challenge: "" }],
    ];
    for (const [what, overrides] of cases) {
      const response = await fetch(authorizeUrl(overrides));
      assert.equal(response.status, 400, `${what} should be refused`);
    }
  });
});

describe("the token endpoint", () => {
  it("mints an access token the API will accept and an id token the browser will", async () => {
    const code = await signIn();
    const { status, json } = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
      client_id: "navbook-web",
    });
    assert.equal(status, 200);
    const tokens = json as unknown as Record<string, string>;

    // The API checks issuer, audience, expiry and the email claim.
    const access = claims(tokens.access_token as string);
    assert.equal(access.iss, issuer.issuer);
    assert.equal(access.aud, "navbook");
    assert.equal(access.email, "person@example.invalid");
    assert.equal(access.name, "A Person");
    assert.equal(typeof access.exp, "number");

    // oidc-client-ts checks the issuer, the client id and the nonce it sent.
    const identity = claims(tokens.id_token as string);
    assert.equal(identity.iss, issuer.issuer);
    assert.equal(identity.aud, "navbook-web");
    assert.equal(identity.nonce, "n0nce");
  });

  it("refuses a code whose verifier does not match the challenge", async () => {
    const code = await signIn();
    const { status, json } = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: "some-other-verifier",
      redirect_uri: REDIRECT,
    });
    assert.equal(status, 400);
    assert.equal((json as unknown as Record<string, string>).error, "invalid_grant");
  });

  it("spends a code on first use, however that use ended", async () => {
    const code = await signIn();
    const first = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    });
    assert.equal(first.status, 200);
    const replay = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    });
    assert.equal(replay.status, 400);

    // Even a failed exchange spends it, so a stolen code cannot be retried.
    const other = await signIn();
    await exchange({ grant_type: "authorization_code", code: other, code_verifier: "wrong" });
    const after = await exchange({
      grant_type: "authorization_code",
      code: other,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    });
    assert.equal(after.status, 400);
  });

  it("refuses a redirect that was not the one agreed", async () => {
    const code = await signIn();
    const { status } = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: "http://evil.example.invalid/callback",
    });
    assert.equal(status, 400);
  });

  it("renews from a refresh token, and rotates it", async () => {
    const code = await signIn("someone@example.invalid");
    const first = await exchange({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    });
    const refresh = (first.json as unknown as Record<string, string>).refresh_token as string;

    const renewed = await exchange({ grant_type: "refresh_token", refresh_token: refresh });
    assert.equal(renewed.status, 200);
    const tokens = renewed.json as unknown as Record<string, string>;
    assert.equal(claims(tokens.access_token as string).email, "someone@example.invalid");
    assert.notEqual(tokens.refresh_token, refresh, "the spent token must not still work");

    const replayed = await exchange({ grant_type: "refresh_token", refresh_token: refresh });
    assert.equal(replayed.status, 400);
  });

  it("refuses a grant it does not implement", async () => {
    const { status, json } = await exchange({ grant_type: "password", username: "a" });
    assert.equal(status, 400);
    assert.equal((json as unknown as Record<string, string>).error, "unsupported_grant_type");
  });
});
