/**
 * The API is named on every request for a token, or a provider that
 * implements resource indicators hands out one the server cannot verify.
 *
 * What matters is what reaches the provider, so these drive oidc-client-ts
 * against a stub token endpoint and read the requests it received, rather than
 * inspecting the settings object: the library decides which setting goes on
 * which request, and it does not put them all everywhere.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { InMemoryWebStorage, OidcClient, User, WebStorageStateStore } from "oidc-client-ts";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { ApiUserManager, oidcSettings } from "../../app/utils/oidc";

const AUDIENCE = "https://api.example.invalid";

let server: Server;
let issuer = "";
/** The form bodies the token endpoint was sent, oldest first. */
const tokenRequests: URLSearchParams[] = [];

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    if (url.pathname === "/.well-known/openid-configuration") {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    tokenRequests.push(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
    // Refused on purpose: the request is the thing under test, and a refusal
    // spares the client validating tokens this stub has no key to sign.
    response
      .writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "invalid_grant" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  issuer = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  tokenRequests.length = 0;
});

function settings() {
  const store = new WebStorageStateStore({ store: new InMemoryWebStorage() });
  return {
    ...oidcSettings({
      issuer,
      clientId: "navbook-web",
      audience: AUDIENCE,
      origin: "http://app.example.invalid",
    }),
    stateStore: store,
    userStore: store,
    automaticSilentRenew: false,
  };
}

describe("oidc settings", () => {
  it("names the API under both spellings on the authorization request", async () => {
    const request = await new OidcClient(settings()).createSigninRequest({});
    const url = new URL(request.url);
    assert.equal(url.searchParams.get("audience"), AUDIENCE);
    assert.equal(url.searchParams.get("resource"), AUDIENCE);
  });

  it("names it as a resource on the code exchange", async () => {
    const client = new OidcClient(settings());
    const request = await client.createSigninRequest({});
    await assert.rejects(
      client.processSigninResponse(
        `http://app.example.invalid/auth/callback?code=c0de&state=${request.state.id}`,
      ),
    );
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0]?.get("grant_type"), "authorization_code");
    assert.equal(tokenRequests[0]?.get("resource"), AUDIENCE);
  });

  it("names it as a resource on a refresh called with no arguments", async () => {
    // The shape of both callers: `useAuth`'s renewal and oidc-client-ts's own
    // renewal timer call `signinSilent()` bare. Without the subclass, the
    // refresh would leave `resource` out and Better Auth would swap the JWT for
    // an opaque token an hour after sign-in.
    const manager = new ApiUserManager(settings(), AUDIENCE);
    await manager.storeUser(
      new User({
        access_token: "spent",
        refresh_token: "r3fresh",
        token_type: "Bearer",
        scope: "openid profile email offline_access",
        profile: { sub: "s", iss: issuer, aud: "navbook-web", exp: 0, iat: 0 },
        expires_at: 1,
      }),
    );
    await assert.rejects(manager.signinSilent());
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0]?.get("grant_type"), "refresh_token");
    assert.equal(tokenRequests[0]?.get("refresh_token"), "r3fresh");
    assert.equal(tokenRequests[0]?.get("resource"), AUDIENCE);
  });
});
