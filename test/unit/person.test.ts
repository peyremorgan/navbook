import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPerson, parsePerson, personMatches, sameEmail } from "../../src/core/person.ts";

describe("parsePerson", () => {
  it("accepts both spec forms", () => {
    assert.deepEqual(parsePerson("alice@example.com"), { email: "alice@example.com" });
    assert.deepEqual(parsePerson("Alice Smith <alice@example.com>"), {
      name: "Alice Smith",
      email: "alice@example.com",
    });
  });

  it("tolerates surrounding and internal whitespace and quoted names", () => {
    assert.deepEqual(parsePerson("  Alice Smith   <alice@example.com>  "), {
      name: "Alice Smith",
      email: "alice@example.com",
    });
    assert.deepEqual(parsePerson('"Smith, Alice" <alice@example.com>'), {
      name: "Smith, Alice",
      email: "alice@example.com",
    });
  });

  it("drops an empty display name", () => {
    assert.deepEqual(parsePerson("<alice@example.com>"), { email: "alice@example.com" });
  });

  it("rejects things that are not addresses", () => {
    for (const input of [
      "",
      "   ",
      "alice",
      "alice@",
      "@example.com",
      "alice@example",
      "a b@c.d",
      "<>",
    ]) {
      assert.equal(parsePerson(input), null, JSON.stringify(input));
    }
  });

  it("round-trips through formatPerson", () => {
    for (const input of ["alice@example.com", "Alice Smith <alice@example.com>"]) {
      assert.equal(formatPerson(parsePerson(input)!), input);
    }
  });
});

describe("sameEmail", () => {
  it("compares addresses case-insensitively", () => {
    assert.equal(sameEmail("Alice@Example.COM", "alice@example.com"), true);
    assert.equal(sameEmail("alice@example.com", "bob@example.com"), false);
  });
});

describe("personMatches", () => {
  it("matches a full address regardless of case or display name", () => {
    assert.equal(personMatches("alice@example.com", "Alice Smith <ALICE@example.com>"), true);
    assert.equal(personMatches("ALICE@EXAMPLE.COM", "alice@example.com"), true);
  });

  it("matches a fragment of the domain", () => {
    assert.equal(personMatches("example.com", "alice@example.com"), true);
    assert.equal(personMatches("example", "alice@example.com"), true);
    assert.equal(personMatches("com", "alice@example.com"), true);
  });

  it("does not match the local part as a fragment", () => {
    assert.equal(personMatches("alice", "alice@example.com"), false);
  });

  it("does not partially match a different full address", () => {
    assert.equal(personMatches("ali@example.com", "alice@example.com"), false);
    assert.equal(personMatches("bob@example.com", "alice@example.com"), false);
  });

  it("never matches an empty query", () => {
    assert.equal(personMatches("", "alice@example.com"), false);
    assert.equal(personMatches("   ", "alice@example.com"), false);
  });

  it("still compares when the stored field is not a parseable address", () => {
    assert.equal(personMatches("not-an-address", "not-an-address"), true);
  });
});
