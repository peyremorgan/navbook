/**
 * Who, among the people the issuer vouches for, is allowed in.
 *
 * Verifying a token answers "is this person who they say they are"; it says
 * nothing about whether they belong on this repository. An identity provider
 * is often shared — one sign-in for every project an organisation runs — and
 * one that vouches for everybody it knows would otherwise open the tracker to
 * everybody it knows. This is the policy applied after verification, from a
 * handful of optional rules ANDed together, each answering a question a
 * provider's tokens can already answer: a claim carrying a value, an address
 * under a domain, an address the provider has checked.
 *
 * The rule that failed is for the operator's log, never for the client: a
 * person who has been refused is told they are not allowed here, and nothing
 * about what would have let them in.
 */

import type { JWTPayload } from "jose";

/** One `name=value` requirement on a claim. */
export interface ClaimRequirement {
  name: string;
  value: string;
}

export interface AuthPolicy {
  /** Every one of these claims must carry its value. */
  requireClaims: readonly ClaimRequirement[];
  /** The `email` claim's domain must be one of these, when any are given. */
  allowEmailDomains: readonly string[];
  /** The token's `email_verified` must be `true`. */
  requireEmailVerified: boolean;
}

/** No rules at all: anyone the issuer signs for may read and write. */
export const OPEN_POLICY: AuthPolicy = {
  requireClaims: [],
  allowEmailDomains: [],
  requireEmailVerified: false,
};

export function isOpen(policy: AuthPolicy): boolean {
  return (
    policy.requireClaims.length === 0 &&
    policy.allowEmailDomains.length === 0 &&
    !policy.requireEmailVerified
  );
}

/**
 * `name=value`, as a flag or an environment entry spells a requirement.
 *
 * The first `=` splits it, so a value may itself carry one; the name may not,
 * and neither side may be empty. Returns null when it is not of that shape.
 */
export function parseClaimRequirement(text: string): ClaimRequirement | null {
  const separator = text.indexOf("=");
  if (separator === -1) return null;
  const name = text.slice(0, separator).trim();
  const value = text.slice(separator + 1).trim();
  if (name === "" || value === "") return null;
  return { name, value };
}

/**
 * A domain as a rule names it: lower-cased, without a leading `@`.
 *
 * Returns null for something that is not a domain at all — empty, or still
 * carrying an `@` after the leading one is dropped, which is an address.
 */
export function normalizeDomain(text: string): string | null {
  const domain = text.trim().replace(/^@/, "").toLowerCase();
  if (domain === "" || domain.includes("@") || /\s/.test(domain)) return null;
  return domain;
}

/**
 * Whether a claim carries a value.
 *
 * Equal when the claim is a scalar; contained when it is an array, or a
 * string of space-separated words — the shape `scope` always has and the one
 * Better Auth gives `roles`. A single-word string is both, and reads the same
 * either way.
 */
export function claimCarries(claim: unknown, value: string): boolean {
  if (Array.isArray(claim)) return claim.some((item) => scalarIs(item, value));
  if (typeof claim === "string") return claim.split(/\s+/).includes(value);
  return scalarIs(claim, value);
}

function scalarIs(claim: unknown, value: string): boolean {
  switch (typeof claim) {
    case "string":
      return claim === value;
    case "number":
    case "boolean":
      return String(claim) === value;
    default:
      return false;
  }
}

/** The domain of an address: what follows its last `@`, lower-cased. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Why a verified token fails the policy, or null when it passes.
 *
 * The reason is written for the operator's log: it names the rule and what
 * the token had instead, which is exactly what a client must never be told.
 */
export function policyViolation(payload: JWTPayload, policy: AuthPolicy): string | null {
  for (const { name, value } of policy.requireClaims) {
    const claim = payload[name];
    if (claim === undefined) return `the token carries no '${name}' claim (required: ${value})`;
    if (!claimCarries(claim, value)) {
      return `the token's '${name}' claim does not carry '${value}' (has ${describe(claim)})`;
    }
  }

  if (policy.allowEmailDomains.length > 0) {
    const email = typeof payload.email === "string" ? payload.email : "";
    const domain = emailDomain(email);
    if (domain === null || !policy.allowEmailDomains.includes(domain)) {
      return `the email domain of '${email}' is not one of ${policy.allowEmailDomains.join(", ")}`;
    }
  }

  if (policy.requireEmailVerified && payload.email_verified !== true) {
    return `the token's 'email_verified' is ${describe(payload.email_verified)}, not true`;
  }

  return null;
}

function describe(value: unknown): string {
  if (value === undefined) return "no value";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
