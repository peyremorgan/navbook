import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  comparePeople,
  dedupePeople,
  formatPerson,
  mergePeople,
  parsePerson,
  personMatches,
  sameEmail,
} from "../src/core/person.ts";

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

describe("dedupePeople", () => {
  it("folds addresses case-insensitively, keeping the first spelling", () => {
    assert.deepEqual(
      dedupePeople([{ email: "Alice@Example.com" }, { email: "alice@example.com" }]),
      [{ email: "Alice@Example.com" }],
    );
  });

  it("keeps the first name an address was given", () => {
    assert.deepEqual(
      dedupePeople([
        { name: "Alice New", email: "alice@example.com" },
        { name: "Alice Old", email: "alice@example.com" },
      ]),
      [{ name: "Alice New", email: "alice@example.com" }],
    );
  });

  it("lets a later entry name an address every earlier one left bare", () => {
    assert.deepEqual(
      dedupePeople([{ email: "alice@example.com" }, { name: "Alice", email: "ALICE@example.com" }]),
      [{ name: "Alice", email: "alice@example.com" }],
    );
  });

  it("keeps the order the addresses first appeared in", () => {
    assert.deepEqual(
      dedupePeople([
        { email: "c@example.com" },
        { email: "a@example.com" },
        { email: "c@example.com" },
      ]).map((person) => person.email),
      ["c@example.com", "a@example.com"],
    );
  });

  it("is empty for nothing", () => {
    assert.deepEqual(dedupePeople([]), []);
  });
});

describe("comparePeople", () => {
  it("orders by what is shown, ignoring case", () => {
    const sorted = [
      { name: "Bob", email: "b@example.com" },
      { name: "alice", email: "a@example.com" },
    ].sort(comparePeople);
    assert.deepEqual(
      sorted.map((person) => person.name),
      ["alice", "Bob"],
    );
  });

  it("orders a nameless person by the address that is shown instead", () => {
    const sorted = [{ name: "Zoe", email: "z@example.com" }, { email: "bare@example.com" }].sort(
      comparePeople,
    );
    assert.deepEqual(
      sorted.map((person) => person.email),
      ["bare@example.com", "z@example.com"],
    );
  });

  it("settles two people shown the same way by their addresses", () => {
    const sorted = [
      { name: "Alex", email: "b@example.com" },
      { name: "alex", email: "a@example.com" },
    ].sort(comparePeople);
    assert.deepEqual(
      sorted.map((person) => person.email),
      ["a@example.com", "b@example.com"],
    );
    assert.equal(
      comparePeople({ name: "A", email: "a@example.com" }, { name: "a", email: "A@example.com" }),
      0,
    );
  });
});

describe("mergePeople", () => {
  it("takes each name from the earliest source that has one", () => {
    assert.deepEqual(
      mergePeople(
        [{ name: "From History", email: "one@example.com" }, { email: "two@example.com" }],
        [
          { name: "From The Tree", email: "ONE@example.com" },
          { name: "Also The Tree", email: "two@example.com" },
        ],
      ),
      [
        { name: "Also The Tree", email: "two@example.com" },
        { name: "From History", email: "one@example.com" },
      ],
    );
  });

  it("sorts what it merged, whatever order the sources were in", () => {
    assert.deepEqual(
      mergePeople(
        [{ name: "Zoe", email: "z@example.com" }],
        [{ name: "Amy", email: "a@example.com" }],
      ).map((person) => person.name),
      ["Amy", "Zoe"],
    );
  });

  it("is empty for no sources at all", () => {
    assert.deepEqual(mergePeople(), []);
    assert.deepEqual(mergePeople([], []), []);
  });
});
