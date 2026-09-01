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
  /** Override the audience, to prove a wrong one is refused. */
  audience?: string;
  /** Override the issuer, likewise. */
  issuer?: string;
  /** Issue a token that expired an hour ago. */
  expired?: boolean;
  /** Sign with a key the issuer does not publish. */
  wrongKey?: boolean;
}

export interface StubIssuer {
  issuer: string;
  jwksUrl: string;
  sign(opts?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

export async function startStubIssuer(): Promise<StubIssuer> {
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
    if (url.startsWith("/jwks")) {
      respond(response, { keys: [publicJwk] });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  issuer = `http://127.0.0.1:${port}`;

  return {
    issuer,
    jwksUrl: `${issuer}/jwks`,
    async sign(opts: SignOptions = {}) {
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {};
      if (!opts.noEmail) claims.email = opts.email ?? "person@example.invalid";
      if (opts.name !== undefined) claims.name = opts.name;

      return await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(opts.issuer ?? issuer)
        .setAudience(opts.audience ?? AUDIENCE)
        .setIssuedAt(opts.expired ? now - 7200 : now)
        .setExpirationTime(opts.expired ? now - 3600 : now + 3600)
        .sign((opts.wrongKey ? stranger : pair).privateKey);
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function respond(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}
