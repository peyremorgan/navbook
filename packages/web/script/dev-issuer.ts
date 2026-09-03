/**
 * An OIDC provider for development, and nothing else.
 *
 * `@navbook/server` has no way to turn authentication off — every operation,
 * read or write, needs a token whose `email` claim becomes `author:`. That is
 * the right default for a deployment and an obstacle for `nuxi dev`, so this
 * serves the smallest provider the browser flow will accept: discovery, a key,
 * an authorize page that asks who you are, and a token endpoint.
 *
 * It is grown from the server suite's stub issuer, which mints tokens in
 * process and needs no browser. The shape is deliberately the same, so both
 * exercise the real verification path — discovery, key fetch, signature,
 * issuer, audience and expiry — rather than a bypass.
 *
 * There is no client secret, no consent, no session and no user database: type
 * a name and an address and you are that person. That is a development tool
 * and would be a catastrophe anywhere else, which is why it lives beside the
 * dev scripts and not in the published package.
 */

import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, type JWK, type KeyObject, SignJWT } from "jose";

export const DEFAULT_PORT = 9000;
export const DEFAULT_AUDIENCE = "navbook";
export const DEFAULT_CLIENT_ID = "navbook-web";

export interface DevIssuerOptions {
  /** 0 binds any free port, which is what the end-to-end harness wants. */
  port?: number;
  /**
   * The host name the issuer calls itself by.
   *
   * It has to be the one the API server is configured with and the one the
   * browser reaches, because a token's `iss` claim is compared as a string:
   * `localhost` and `127.0.0.1` are the same socket and two different issuers.
   */
  hostname?: string;
  /** The `aud` minted when a request does not ask for one. */
  audience?: string;
  /** The only client id accepted, so a misconfigured app fails loudly. */
  clientId?: string;
  /** How long an access token lasts, in seconds. */
  lifetimeSeconds?: number;
}

export interface DevIssuer {
  issuer: string;
  port: number;
  close(): Promise<void>;
}

/** What `/authorize` remembers until `/token` comes to collect it. */
interface PendingCode {
  name: string;
  email: string;
  nonce: string | null;
  audience: string;
  codeChallenge: string;
  clientId: string;
  redirectUri: string;
}

/** What a refresh token stands for. */
interface Session {
  name: string;
  email: string;
  audience: string;
  clientId: string;
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

export async function startDevIssuer(options: DevIssuerOptions = {}): Promise<DevIssuer> {
  const audienceDefault = options.audience ?? DEFAULT_AUDIENCE;
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const lifetime = options.lifetimeSeconds ?? 3600;

  const pair = await generateKeyPair("RS256", { extractable: true });
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "dev-key" };

  const pending = new Map<string, PendingCode>();
  const sessions = new Map<string, Session>();
  let issuer = "";

  const mint = async (session: Session, nonce: string | null) => {
    const now = Math.floor(Date.now() / 1000);
    // The access token is the one `nav-server` verifies: its audience is the
    // API's, and `email` is what every mutation records as the author.
    const accessToken = await new SignJWT({ email: session.email, name: session.name })
      .setProtectedHeader({ alg: "RS256", kid: "dev-key" })
      .setIssuer(issuer)
      .setAudience(session.audience)
      .setSubject(session.email)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .sign(pair.privateKey as KeyObject);

    // The id token is the browser's, and oidc-client-ts checks its issuer, its
    // audience — the client id, not the API's — and the nonce it sent.
    const idToken = await new SignJWT({
      email: session.email,
      email_verified: true,
      name: session.name,
      ...(nonce === null ? {} : { nonce }),
    })
      .setProtectedHeader({ alg: "RS256", kid: "dev-key" })
      .setIssuer(issuer)
      .setAudience(session.clientId)
      .setSubject(session.email)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .sign(pair.privateKey as KeyObject);

    const refreshToken = randomUUID();
    sessions.set(refreshToken, session);
    return {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: lifetime,
      scope: "openid profile email offline_access",
    };
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      json(response, 500, { error: "server_error", error_description: String(error) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // The browser fetches discovery, the keys and the token endpoint from the
    // app's origin, which is never this one.
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type, authorization");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? "/", issuer);
    switch (`${request.method} ${url.pathname}`) {
      case "GET /.well-known/openid-configuration":
        json(response, 200, discovery(issuer));
        return;
      case "GET /jwks":
        json(response, 200, { keys: [publicJwk] });
        return;
      case "GET /authorize":
        authorize(url, response);
        return;
      case "POST /authorize/submit":
        submit(await body(request), response);
        return;
      case "POST /token":
        await token(await body(request), response);
        return;
      default:
        json(response, 404, { error: "not_found" });
    }
  }

  function authorize(url: URL, response: ServerResponse): void {
    const parameters = url.searchParams;
    const redirectUri = parameters.get("redirect_uri");
    const failure = authorizeProblem(parameters, clientId);
    if (failure !== null || redirectUri === null) {
      json(response, 400, { error: "invalid_request", error_description: failure });
      return;
    }
    // The form carries the request forward, so nothing is remembered until
    // somebody says who they are: a page that was opened and abandoned leaves
    // nothing behind.
    response.writeHead(200, HTML_HEADERS).end(
      loginPage({
        clientId: parameters.get("client_id") ?? "",
        redirectUri,
        state: parameters.get("state") ?? "",
        nonce: parameters.get("nonce") ?? "",
        audience: parameters.get("audience") ?? audienceDefault,
        codeChallenge: parameters.get("code_challenge") ?? "",
      }),
    );
  }

  function submit(form: URLSearchParams, response: ServerResponse): void {
    const email = (form.get("email") ?? "").trim();
    const redirectUri = form.get("redirect_uri") ?? "";
    if (email === "" || redirectUri === "") {
      json(response, 400, { error: "invalid_request", error_description: "email is required" });
      return;
    }
    const code = randomUUID();
    pending.set(code, {
      name: (form.get("name") ?? "").trim(),
      email,
      nonce: form.get("nonce") || null,
      audience: form.get("audience") || audienceDefault,
      codeChallenge: form.get("code_challenge") ?? "",
      clientId: form.get("client_id") ?? clientId,
      redirectUri,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    const state = form.get("state");
    if (state) target.searchParams.set("state", state);
    response.writeHead(302, { location: target.toString() }).end();
  }

  async function token(form: URLSearchParams, response: ServerResponse): Promise<void> {
    const grant = form.get("grant_type");

    if (grant === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const session = sessions.get(presented);
      if (session === undefined) {
        json(response, 400, { error: "invalid_grant" });
        return;
      }
      // Rotated, as a provider that issues them should: the old one is spent.
      sessions.delete(presented);
      json(response, 200, await mint(session, null));
      return;
    }

    if (grant !== "authorization_code") {
      json(response, 400, { error: "unsupported_grant_type" });
      return;
    }

    const code = form.get("code") ?? "";
    const record = pending.get(code);
    // Single use, whatever happens next: a replayed code is not a code.
    pending.delete(code);
    if (record === undefined) {
      json(response, 400, { error: "invalid_grant", error_description: "unknown code" });
      return;
    }
    if (form.get("redirect_uri") !== record.redirectUri) {
      json(response, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
      return;
    }
    if (pkceOf(form.get("code_verifier") ?? "") !== record.codeChallenge) {
      json(response, 400, {
        error: "invalid_grant",
        error_description: "PKCE verification failed",
      });
      return;
    }
    json(
      response,
      200,
      await mint(
        {
          name: record.name,
          email: record.email,
          audience: record.audience,
          clientId: record.clientId,
        },
        record.nonce,
      ),
    );
  }

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? DEFAULT_PORT, "127.0.0.1", resolve),
  );
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);
  issuer = `http://${options.hostname ?? "127.0.0.1"}:${port}`;

  return {
    issuer,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Why this authorize request cannot be served, or null when it can. */
function authorizeProblem(parameters: URLSearchParams, clientId: string): string | null {
  if (parameters.get("client_id") !== clientId) return `unknown client_id (expected ${clientId})`;
  if (parameters.get("response_type") !== "code") return "only response_type=code is supported";
  if (parameters.get("redirect_uri") === null) return "redirect_uri is required";
  if (parameters.get("code_challenge_method") !== "S256") {
    return "only code_challenge_method=S256 is supported";
  }
  if ((parameters.get("code_challenge") ?? "") === "") return "code_challenge is required";
  return null;
}

/** The S256 challenge for a verifier, as RFC 7636 computes it. */
export function pkceOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function discovery(issuer: string): Record<string, unknown> {
  return {
    issuer,
    jwks_uri: `${issuer}/jwks`,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["none"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "email_verified", "name"],
  };
}

async function body(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response
    .writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
    .end(JSON.stringify(payload));
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

interface LoginFields {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  audience: string;
  codeChallenge: string;
}

function loginPage(fields: LoginFields): string {
  const hidden = Object.entries({
    client_id: fields.clientId,
    redirect_uri: fields.redirectUri,
    state: fields.state,
    nonce: fields.nonce,
    audience: fields.audience,
    code_challenge: fields.codeChallenge,
  })
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join("\n      ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to Navbook (development)</title>
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; margin: 0; display: grid;
             place-items: center; min-height: 100vh; background: #f5f5f4; color: #1c1917; }
      form { background: #fff; padding: 2rem; border-radius: .5rem; width: min(24rem, 90vw);
             box-shadow: 0 1px 3px rgb(0 0 0 / .1); }
      h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
      p  { margin: 0 0 1.5rem; color: #78716c; font-size: .875rem; }
      label { display: block; font-weight: 500; margin-bottom: .25rem; font-size: .875rem; }
      input[type=text], input[type=email] { width: 100%; padding: .5rem; margin-bottom: 1rem;
             border: 1px solid #d6d3d1; border-radius: .25rem; font: inherit; box-sizing: border-box; }
      button { width: 100%; padding: .55rem; border: 0; border-radius: .25rem;
               background: #0f766e; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
    </style>
  </head>
  <body>
    <form method="post" action="/authorize/submit">
      <h1>Sign in to Navbook</h1>
      <p>Development issuer. Anyone may be anyone; the address you give is what
         every issue and comment will record as its author.</p>
      ${hidden}
      <label for="name">Name</label>
      <input id="name" name="name" type="text" value="A Person" autocomplete="off">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="person@example.invalid"
             autocomplete="off" required>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
`;
}

/** Run as a command: `node script/dev-issuer.ts [--port N] [--audience A]`. */
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
) {
  const argument = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const port = Number(argument("port") ?? DEFAULT_PORT);
  const issuer = await startDevIssuer({
    port,
    ...(argument("audience") === undefined ? {} : { audience: argument("audience") as string }),
    ...(argument("client-id") === undefined ? {} : { clientId: argument("client-id") as string }),
    ...(argument("hostname") === undefined ? {} : { hostname: argument("hostname") as string }),
  });
  process.stdout.write(`dev-issuer: listening on ${issuer.issuer}\n`);
}
