/**
 * The authorization rules, one at a time and together.
 *
 * Pure functions over a token's payload: the server suite proves the policy
 * is applied to every request, and this proves each rule reads a claim the
 * way its documentation says — the shapes `roles` and `scope` actually take,
 * and the address forms a domain rule has to see through.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuthPolicy,
  claimCarries,
  emailDomain,
  isOpen,
  normalizeDomain,
  parseClaimRequirement,
  policyViolation,
} from "../../src/policy.ts";

const OPEN: AuthPolicy = { requireClaims: [], allowEmailDomains: [], requireEmailVerified: false };
const MEMBER: AuthPolicy = {
  ...OPEN,
  requireClaims: [{ name: "roles", value: "d3952bfb::developer" }],
};
const EMAIL = "person@example.invalid";

/** The check as `verify` calls it: with the identity's trimmed email. */
function violation(payload: Record<string, unknown>, policy: AuthPolicy): string | null {
  const email = typeof payload.email === "string" ? payload.email.trim() : EMAIL;
  return policyViolation(payload, email, policy);
}

describe("parseClaimRequirement", () => {
  it("splits on the first equals sign, so a value may carry one", () => {
    assert.deepEqual(parseClaimRequirement("roles=navbook::member"), {
      name: "roles",
      value: "navbook::member",
    });
    assert.deepEqual(parseClaimRequirement("scope=a=b"), { name: "scope", value: "a=b" });
    assert.deepEqual(parseClaimRequirement(" roles = admin "), { name: "roles", value: "admin" });
  });

  it("refuses anything that is not name=value", () => {
    for (const bad of ["roles", "=admin", "roles=", "", " = "]) {
      assert.equal(parseClaimRequirement(bad), null, bad);
    }
  });
});

describe("normalizeDomain", () => {
  it("lower-cases and drops a leading @", () => {
    assert.equal(normalizeDomain("Example.COM"), "example.com");
    assert.equal(normalizeDomain("@example.com"), "example.com");
    assert.equal(normalizeDomain("  example.com "), "example.com");
  });

  it("refuses an address, or nothing", () => {
    for (const bad of ["", "@", "someone@example.com", "exa mple.com"]) {
      assert.equal(normalizeDomain(bad), null, bad);
    }
  });
});

describe("claimCarries", () => {
  it("compares a string claim whole, and word by word", () => {
    assert.equal(claimCarries("admin", "admin"), true);
    assert.equal(claimCarries("navbook::member other::role", "navbook::member"), true);
    assert.equal(claimCarries("navbook::member", "member"), false);
    assert.equal(claimCarries("navbook::members", "navbook::member"), false);
  });

  it("looks for the value among an array's members", () => {
    assert.equal(claimCarries(["reader", "d3952bfb::developer"], "d3952bfb::developer"), true);
    assert.equal(claimCarries(["d3952bfb::developer"], "d3952bfb"), false);
    assert.equal(claimCarries([], "anything"), false);
  });

  it("does not split an array member into words", () => {
    // A member that is itself "a b" is one role named "a b", not two.
    assert.equal(claimCarries(["a b"], "a"), false);
  });

  it("matches a value with a space in it whole, never as two words", () => {
    assert.equal(claimCarries("Site Admins", "Site Admins"), true);
    assert.equal(claimCarries(["Site Admins"], "Site Admins"), true);
    assert.equal(claimCarries("Some Site Admins Here", "Site Admins"), false);
    // And a single word is not found inside a longer sentence's words either
    // when it is only part of one of them.
    assert.equal(claimCarries("John Doe", "John"), true);
    assert.equal(claimCarries("Johnny", "John"), false);
  });

  it("compares a number or a boolean by its spelling", () => {
    assert.equal(claimCarries(true, "true"), true);
    assert.equal(claimCarries(42, "42"), true);
    assert.equal(claimCarries(false, "true"), false);
  });

  it("never matches an object, a null or an absence", () => {
    assert.equal(claimCarries({ roles: "admin" }, "admin"), false);
    assert.equal(claimCarries(null, "null"), false);
    assert.equal(claimCarries(undefined, "undefined"), false);
  });
});

describe("emailDomain", () => {
  it("is what follows the last @, lower-cased", () => {
    assert.equal(emailDomain("Someone@Example.COM"), "example.com");
    assert.equal(emailDomain('"odd@local"@example.com'), "example.com");
  });

  it("is null when there is no domain", () => {
    assert.equal(emailDomain("nobody"), null);
    assert.equal(emailDomain("nobody@"), null);
  });
});

describe("policyViolation", () => {
  it("passes everything under the open policy", () => {
    assert.equal(violation({}, OPEN), null);
    assert.equal(isOpen(OPEN), true);
    assert.equal(isOpen(MEMBER), false);
  });

  it("requires a claim to carry its value", () => {
    assert.equal(violation({ roles: ["d3952bfb::developer"] }, MEMBER), null);
    assert.equal(violation({ roles: "d3952bfb::developer" }, MEMBER), null);
    assert.match(violation({ roles: ["other::role"] }, MEMBER) ?? "", /does not carry/);
    assert.match(violation({}, MEMBER) ?? "", /no 'roles' claim/);
  });

  it("ANDs several claim requirements together", () => {
    const both: AuthPolicy = {
      ...OPEN,
      requireClaims: [
        { name: "roles", value: "member" },
        { name: "scope", value: "navbook" },
      ],
    };
    assert.equal(violation({ roles: "member", scope: "openid navbook" }, both), null);
    assert.match(violation({ roles: "member", scope: "openid" }, both) ?? "", /'scope'/);
  });

  it("restricts the email domain to the allowed ones", () => {
    const domains: AuthPolicy = { ...OPEN, allowEmailDomains: ["example.com", "b.test"] };
    assert.equal(violation({ email: "a@Example.com" }, domains), null);
    assert.equal(violation({ email: "a@b.test" }, domains), null);
    // Judged on the identity's address, which `verify` has trimmed already.
    assert.equal(violation({ email: " a@example.com " }, domains), null);
    assert.match(violation({ email: "a@evil.example.com" }, domains) ?? "", /domain/);
    assert.match(violation({ email: "a@other.test" }, domains) ?? "", /domain/);
    assert.match(policyViolation({}, "nobody", domains) ?? "", /domain/);
  });

  it("quotes the address in the reason, so it cannot break the line", () => {
    const domains: AuthPolicy = { ...OPEN, allowEmailDomains: ["example.com"] };
    const reason = policyViolation({}, "x@evil.test\nforged: line", domains) ?? "";
    assert.equal(reason.includes("\n"), false);
    assert.match(reason, /"x@evil\.test\\nforged: line"/);
  });

  it("requires email_verified to be exactly true", () => {
    const verified: AuthPolicy = { ...OPEN, requireEmailVerified: true };
    assert.equal(violation({ email_verified: true }, verified), null);
    for (const not of [false, "true", 1, undefined]) {
      assert.match(violation({ email_verified: not }, verified) ?? "", /email_verified/);
    }
  });

  it("names the rule that failed, for the log", () => {
    const reason = violation({ roles: ["a"] }, MEMBER);
    assert.match(reason ?? "", /'roles'.*'d3952bfb::developer'.*\["a"\]/);
  });
});
