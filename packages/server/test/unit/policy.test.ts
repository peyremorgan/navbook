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
  OPEN_POLICY,
  parseClaimRequirement,
  policyViolation,
} from "../../src/policy.ts";

const MEMBER: AuthPolicy = {
  ...OPEN_POLICY,
  requireClaims: [{ name: "roles", value: "d3952bfb::developer" }],
};

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
    assert.equal(policyViolation({}, OPEN_POLICY), null);
    assert.equal(isOpen(OPEN_POLICY), true);
    assert.equal(isOpen(MEMBER), false);
  });

  it("requires a claim to carry its value", () => {
    assert.equal(policyViolation({ roles: ["d3952bfb::developer"] }, MEMBER), null);
    assert.equal(policyViolation({ roles: "d3952bfb::developer" }, MEMBER), null);
    assert.match(policyViolation({ roles: ["other::role"] }, MEMBER) ?? "", /does not carry/);
    assert.match(policyViolation({}, MEMBER) ?? "", /no 'roles' claim/);
  });

  it("ANDs several claim requirements together", () => {
    const both: AuthPolicy = {
      ...OPEN_POLICY,
      requireClaims: [
        { name: "roles", value: "member" },
        { name: "scope", value: "navbook" },
      ],
    };
    assert.equal(policyViolation({ roles: "member", scope: "openid navbook" }, both), null);
    assert.match(policyViolation({ roles: "member", scope: "openid" }, both) ?? "", /'scope'/);
  });

  it("restricts the email domain to the allowed ones", () => {
    const domains: AuthPolicy = { ...OPEN_POLICY, allowEmailDomains: ["example.com", "b.test"] };
    assert.equal(policyViolation({ email: "a@Example.com" }, domains), null);
    assert.equal(policyViolation({ email: "a@b.test" }, domains), null);
    assert.match(policyViolation({ email: "a@evil.example.com" }, domains) ?? "", /domain/);
    assert.match(policyViolation({ email: "a@other.test" }, domains) ?? "", /domain/);
    assert.match(policyViolation({}, domains) ?? "", /domain/);
  });

  it("requires email_verified to be exactly true", () => {
    const verified: AuthPolicy = { ...OPEN_POLICY, requireEmailVerified: true };
    assert.equal(policyViolation({ email_verified: true }, verified), null);
    for (const not of [false, "true", 1, undefined]) {
      assert.match(policyViolation({ email_verified: not }, verified) ?? "", /email_verified/);
    }
  });

  it("names the rule that failed, for the log", () => {
    const reason = policyViolation({ roles: ["a"] }, MEMBER);
    assert.match(reason ?? "", /'roles'.*'d3952bfb::developer'.*\["a"\]/);
  });
});
