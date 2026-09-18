/**
 * Splitting an address for display, and nothing more: no validation, no
 * deciding whether two of them are the same person. Those are format
 * questions, and the server answers those.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  displayPerson,
  namesPerson,
  personInitials,
  personLabel,
  togglePerson,
  viewerField,
} from "../../app/utils/people";

describe("displayPerson", () => {
  it("prefers the display name of an RFC 5322 address", () => {
    assert.deepEqual(displayPerson("A Person <person@example.invalid>"), {
      label: "A Person",
      email: "person@example.invalid",
    });
  });

  it("falls back to the address when there is no name", () => {
    assert.deepEqual(displayPerson("person@example.invalid"), {
      label: "person@example.invalid",
      email: "person@example.invalid",
    });
    assert.deepEqual(displayPerson("<person@example.invalid>"), {
      label: "person@example.invalid",
      email: "person@example.invalid",
    });
  });

  it("unquotes a name that was quoted", () => {
    assert.equal(personLabel('"Person, A" <person@example.invalid>'), "Person, A");
  });

  it("trims the space around both halves", () => {
    assert.deepEqual(displayPerson("  A Person   <  person@example.invalid  >  "), {
      label: "A Person",
      email: "person@example.invalid",
    });
  });

  it("shows a field that is not an address as it stands", () => {
    // Anyone can write anything into frontmatter; showing it beats hiding it.
    assert.deepEqual(displayPerson("somebody"), { label: "somebody", email: null });
    assert.deepEqual(displayPerson(""), { label: "", email: null });
  });
});

describe("personInitials", () => {
  it("takes the first letter of the first two words of a name", () => {
    assert.equal(personInitials("A Person <person@example.invalid>"), "AP");
    assert.equal(personInitials("Navbook Dev Server <x@example.invalid>"), "ND");
  });

  it("reads only the local part of a bare address", () => {
    // A domain says nothing about anybody: initials taken from one would be
    // the same for everybody in an organisation.
    assert.equal(personInitials("first.last@example.invalid"), "FL");
    assert.equal(personInitials("someone@example.invalid"), "SO");
    assert.equal(personInitials("a_b@example.invalid"), "AB");
  });

  it("takes two letters when there is only one word", () => {
    assert.equal(personInitials("Cher <cher@example.invalid>"), "CH");
  });

  it("has nothing to show for nothing", () => {
    assert.equal(personInitials(""), "");
    assert.equal(personInitials("   "), "");
  });
});

describe("namesPerson", () => {
  const named = "A Person <person@example.invalid>";

  it("reads a value as naming somebody however either is spelled", () => {
    // The same assignee written three ways: nav writes `user.name`, the web
    // client writes the token's claim, and a hand edit may write neither.
    assert.equal(namesPerson(named, "person@example.invalid"), true);
    assert.equal(namesPerson(named, "<person@example.invalid>"), true);
    assert.equal(namesPerson(named, "P. Erson <person@example.invalid>"), true);
    assert.equal(namesPerson("person@example.invalid", named), true);
  });

  it("ignores the case of the address, as the server's dedupe does", () => {
    assert.equal(namesPerson(named, "PERSON@Example.Invalid"), true);
  });

  it("never reads two different addresses as one person", () => {
    assert.equal(namesPerson(named, "A Person <someone.else@example.invalid>"), false);
    assert.equal(namesPerson(named, "nobody@example.invalid"), false);
  });

  it("matches a value with no address only against itself", () => {
    assert.equal(namesPerson("somebody", "somebody"), true);
    assert.equal(namesPerson("somebody", "someone"), false);
    assert.equal(namesPerson(named, "somebody"), false);
  });
});

describe("togglePerson", () => {
  const values = ["A Person <person@example.invalid>", "other@example.invalid"];

  it("adds somebody who is not on the list", () => {
    assert.deepEqual(togglePerson(values, "new@example.invalid"), [
      ...values,
      "new@example.invalid",
    ]);
  });

  it("removes the entry that names them, not the string passed in", () => {
    // What comes off the list is what was on it; the two spellings differ.
    assert.deepEqual(togglePerson(values, "P. Erson <person@example.invalid>"), [
      "other@example.invalid",
    ]);
  });

  it("takes off every entry that names them, not just the first", () => {
    // One assignee written twice — the bare address beside the named one —
    // is still one assignee: taking half of it off would leave the button
    // still offering to remove you.
    assert.deepEqual(
      togglePerson(
        ["A Person <person@example.invalid>", "person@example.invalid", "x@y.invalid"],
        "person@example.invalid",
      ),
      ["x@y.invalid"],
    );
  });

  it("leaves the original alone", () => {
    const before = [...values];
    togglePerson(values, "new@example.invalid");
    assert.deepEqual(values, before);
  });
});

describe("viewerField", () => {
  const people = ["Morgan PEYRE <morgan@example.invalid>", "other@example.invalid"];

  it("prefers the repository's spelling over the token's claim", () => {
    assert.equal(
      viewerField(people, { name: "M. Peyre", email: "morgan@example.invalid" }),
      "Morgan PEYRE <morgan@example.invalid>",
    );
  });

  it("composes from the claim for somebody the answer does not hold", () => {
    assert.equal(
      viewerField(people, { name: "New Person", email: "new@example.invalid" }),
      "New Person <new@example.invalid>",
    );
    assert.equal(
      viewerField(people, { name: null, email: "new@example.invalid" }),
      "new@example.invalid",
    );
    assert.equal(
      viewerField(people, { name: "  ", email: "  new@example.invalid  " }),
      "new@example.invalid",
    );
  });

  it("has no answer before there is one", () => {
    // An empty list is the server not having answered rather than a repository
    // with nobody in it: it always holds at least the viewer.
    assert.equal(viewerField([], { name: "M", email: "morgan@example.invalid" }), null);
    assert.equal(viewerField(people, null), null);
    assert.equal(viewerField(people, { name: "M", email: "  " }), null);
  });
});
