/**
 * A throwaway OIDC issuer.
 *
 * Authentication has no off switch (see `src/config.ts`), so the suite runs a
 * real one: a key pair, a discovery document, a JWKS endpoint, and a signer.
 * That means the tests exercise the same verification path a deployment does —
 * discovery, key fetch, signature, issuer, audience and expiry — rather than a
 * bypass that only exists for them.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

export const AUDIENCE = "navbook-test";

export interface SignOptions {
  name?: string;
  email?: string;
  /** Leave the `email` claim out, to prove a token without one is refused. */
  noEmail?: boolean;
  /**
   * Override the audience, to prove a wrong one is refused — or give several,
   * as a provider that adds its own userinfo endpoint does.
   */
  audience?: string | string[];
  /** Override the issuer, likewise. */
  issuer?: string;
  /** Issue a token that expired an hour ago. */
  expired?: boolean;
  /** Issue a token with no expiry at all, which would never go stale. */
  noExpiry?: boolean;
  /** Sign with a key the issuer does not publish. */
  wrongKey?: boolean;
  /** Anything else the token should carry — `roles`, `email_verified` — for the policy to read. */
  claims?: Record<string, unknown>;
}

export interface StubIssuerOptions {
  /**
   * A path the issuer carries that its discovery document does not sit under:
   * the document stays at the host root while `issuer`, and everything else,
   * moves beneath the path. That is the shape of a provider such as
   * `https://auth.example/api/auth`, and the case discovery by URL exists for.
   */
  issuerPath?: string;
}

export interface StubIssuer {
  issuer: string;
  /** Where the discovery document is: at the host root, whatever the issuer's path. */
  discoveryUrl: string;
  jwksUrl: string;
  sign(opts?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

export async function startStubIssuer(options: StubIssuerOptions = {}): Promise<StubIssuer> {
  const path = options.issuerPath ?? "";
  const pair = await generateKeyPair("RS256", { extractable: true });
  const stranger = await generateKeyPair("RS256", { extractable: true });
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test-key" };

  let issuer = "";
  const server: Server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/.well-known/openid-configuration")) {
      respond(response, { issuer, jwks_uri: `${issuer}/jwks` });
      return;
    }
    if (url.startsWith(`${path}/jwks`)) {
      respond(response, { keys: [publicJwk] });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const host = `http://127.0.0.1:${port}`;
  issuer = `${host}${path}`;

  return {
    issuer,
    discoveryUrl: `${host}/.well-known/openid-configuration`,
    jwksUrl: `${issuer}/jwks`,
    async sign(opts: SignOptions = {}) {
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = { ...opts.claims };
      if (!opts.noEmail) claims.email = opts.email ?? "person@example.invalid";
      if (opts.name !== undefined) claims.name = opts.name;

      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(opts.issuer ?? issuer)
        .setAudience(opts.audience ?? AUDIENCE)
        .setIssuedAt(opts.expired ? now - 7200 : now);
      if (!opts.noExpiry) jwt.setExpirationTime(opts.expired ? now - 3600 : now + 3600);
      return await jwt.sign((opts.wrongKey ? stranger : pair).privateKey);
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function respond(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}
