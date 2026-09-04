/**
 * The translation between GraphQL's vocabulary and the format's.
 *
 * Small, but it is the seam where a schema change and a format change would
 * silently disagree, so both directions are pinned.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyQuery } from "@navbook/core";
import {
  toCoreKind,
  toCoreStatus,
  toCoreVerdict,
  toGqlKind,
  toGqlLevel,
  toGqlStatus,
  toGqlVerdict,
  toQuery,
} from "../../src/resolvers/map.ts";

describe("enum translation", () => {
  it("round-trips every status and kind", () => {
    for (const status of ["open", "closed", "merged"] as const) {
      assert.equal(toCoreStatus(toGqlStatus(status)), status);
    }
    for (const kind of ["issue", "pr"] as const) {
      assert.equal(toCoreKind(toGqlKind(kind)), kind);
    }
  });

  it("spells the hyphenated verdict as an enum value and back", () => {
    assert.equal(toGqlVerdict("request-changes"), "REQUEST_CHANGES");
    assert.equal(toCoreVerdict("REQUEST_CHANGES"), "request-changes");
    assert.equal(toGqlVerdict("approve"), "APPROVE");
  });

  it("treats a verdict the format does not define as absent", () => {
    // Frontmatter is open and hand-editable, so a stored value need not be one
    // of ours; a null is the honest answer, and doctor reports the fault.
    assert.equal(toGqlVerdict("looks-fine"), null);
    assert.equal(toGqlVerdict(undefined), null);
    assert.equal(toGqlVerdict(42), null);
  });

  it("does not mistake an inherited property for a verdict", () => {
    // Anyone who can push a comment file chooses this string, so the lookup
    // must not walk the prototype chain and hand back a function the schema
    // cannot serialize.
    for (const planted of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
      assert.equal(toGqlVerdict(planted), null, planted);
    }
  });

  it("maps diagnostic levels", () => {
    assert.equal(toGqlLevel("error"), "ERROR");
    assert.equal(toGqlLevel("warning"), "WARNING");
  });
});

describe("toQuery", () => {
  it("is an empty query when no filter was given", () => {
    assert.deepEqual(toQuery(null), emptyQuery());
    assert.deepEqual(toQuery(undefined), emptyQuery());
  });

  it("carries every key across, translating the statuses", () => {
    assert.deepEqual(
      toQuery({
        status: ["OPEN", "CLOSED"],
        labels: ["bug"],
        assignees: ["a@x.invalid"],
        authors: ["b@x.invalid"],
        milestones: ["v1"],
        text: ["crash"],
      }),
      {
        status: ["open", "closed"],
        labels: ["bug"],
        assignees: ["a@x.invalid"],
        authors: ["b@x.invalid"],
        milestones: ["v1"],
        text: ["crash"],
      },
    );
  });

  it("leaves an unmentioned key empty, which filters by none of its values", () => {
    assert.deepEqual(toQuery({ labels: ["bug"] }).status, []);
  });
});
