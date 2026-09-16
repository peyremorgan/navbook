/**
 * Who is asking — spec 06 §6.2.
 *
 * The server commits on a signed-in person's behalf, so it has to know who that
 * is: a bearer token from an OIDC provider, verified against that provider's
 * JWKS, whose `name` and `email` claims become the identity every operation runs
 * under. That is why `author:` is data rather than derived from the committer —
 * the committer is the gateway, the author is the person.
 *
 * Verifying is one question and admitting is another. A provider is often
 * shared, so a verified token proves who is asking and nothing about whether
 * they belong here; the authorization policy (`policy.ts`) is applied to the
 * verified claims, after the identity has been read out of them.
 *
 * Failures are deliberately uniform. A client learns that its token was not
 * accepted, or that its account is not admitted, never which of the checks
 * rejected it. The rule that refused a verified token goes to the log.
 */

import type { Identity } from "@navbook/core";
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import { forbidden, unauthenticated } from "./errors.ts";
import { type AuthPolicy, OPEN_POLICY, policyViolation } from "./policy.ts";

export interface Authenticator {
  /** The identity a request's headers prove and the policy admits, or a thrown 401 or 403. */
  verify(header: string | null): Promise<Identity>;
}

export interface AuthOptions {
  /** Where the provider is: its discovery document, or the issuer and its keys spelled out. */
  provider: OidcProvider;
  audience: string;
  /** Who is admitted among those the provider vouches for; everyone, when absent. */
  policy?: AuthPolicy;
  /** Told why a verified token was refused, for the operator's log. */
  report?: (line: string) => void;
  /** Key source, injected by tests that run their own issuer. */
  keys?: JWTVerifyGetKey;
}

/**
 * How the provider is named.
 *
 * Its discovery document says both what a token must carry as `iss` and where
 * the keys are, so its address is enough on its own — and is the only thing
 * that works for a provider whose document does not sit under its issuer.
 * A provider the server cannot reach at start is spelled out instead, both
 * halves at once, since neither can be derived from the other.
 */
export type OidcProvider = { discoveryUrl: string } | { issuer: string; jwksUrl: string };

export interface ResolvedProvider {
  issuer: string;
  jwksUrl: string;
}

/**
 * OpenID discovery: the document says who the issuer is and where its keys are.
 *
 * The `issuer` it declares is taken on the same trust as its `jwks_uri` was
 * already: whoever controls the document controls which keys are accepted,
 * so letting it name the issuer too gives it nothing it did not have.
 */
export async function discoverProvider(discoveryUrl: string): Promise<ResolvedProvider> {
  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${discoveryUrl}: HTTP ${response.status}`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  return {
    issuer: declared(document, "issuer", discoveryUrl),
    jwksUrl: declared(document, "jwks_uri", discoveryUrl),
  };
}

function declared(document: Record<string, unknown>, key: string, discoveryUrl: string): string {
  const value = document[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`OIDC discovery at ${discoveryUrl} returned no ${key}`);
  }
  return value;
}

export async function makeAuthenticator(opts: AuthOptions): Promise<Authenticator> {
  const { issuer, jwksUrl } =
    "discoveryUrl" in opts.provider
      ? await discoverProvider(opts.provider.discoveryUrl)
      : opts.provider;
  const keys = opts.keys ?? createRemoteJWKSet(new URL(jwksUrl));
  const policy = opts.policy ?? OPEN_POLICY;
  const report = opts.report ?? (() => undefined);

  return {
    async verify(header) {
      const token = bearerToken(header);
      if (token === null) throw unauthenticated("a bearer token is required");

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer,
          audience: opts.audience,
          // An expiry is required rather than merely honoured when present:
          // jose checks `exp` only if the token carries one, so without this a
          // token issued once would be accepted for as long as the key lives.
          requiredClaims: ["exp"],
        }));
      } catch {
        // Signature, expiry, issuer, audience: all one answer. Which check
        // failed is a detail an attacker would find more useful than a client.
        throw unauthenticated("the bearer token was not accepted");
      }
      const identity = identityFrom(payload);

      // Admission comes after identity: a token with no email is not a person
      // this server can act for, whatever else it carries.
      const violation = policyViolation(payload, policy);
      if (violation !== null) {
        report(`refused ${identity.email}: ${violation}`);
        throw forbidden("this account is not allowed on this repository");
      }
      return identity;
    },
  };
}

function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}

/**
 * The identity a verified token asserts.
 *
 * `email` is required because it is what `author:` is built from and what makes
 * one person's issues findable as theirs; a token without it is valid but of no
 * use here, and saying so plainly beats committing as somebody anonymous.
 */
function identityFrom(payload: JWTPayload): Identity {
  const email = payload.email;
  if (typeof email !== "string" || email.trim() === "") {
    throw unauthenticated("the bearer token carries no 'email' claim");
  }
  const name = payload.name;
  return typeof name === "string" && name.trim() !== ""
    ? { name: name.trim(), email: email.trim() }
    : { email: email.trim() };
}
