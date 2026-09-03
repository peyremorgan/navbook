/**
 * Splitting an address for display, and nothing more: no validation, no
 * deciding whether two of them are the same person. Those are format
 * questions, and the server answers those.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { displayPerson, personInitials, personLabel } from "../../app/utils/people";

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
