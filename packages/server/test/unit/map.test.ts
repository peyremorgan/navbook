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
  toIssueQuery,
  toPrQuery,
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

describe("toIssueQuery and toPrQuery", () => {
  const TODAY = "2026-09-08";

  it("is an empty query but for the day, when no filter was given", () => {
    for (const toQuery of [toIssueQuery, toPrQuery]) {
      assert.deepEqual(toQuery(null, TODAY), { ...emptyQuery(), today: TODAY, ext: {} });
      assert.deepEqual(toQuery(undefined, TODAY), { ...emptyQuery(), today: TODAY, ext: {} });
    }
  });

  it("carries every issue key across, translating the statuses", () => {
    assert.deepEqual(
      toIssueQuery(
        {
          status: ["OPEN", "CLOSED"],
          labels: ["bug"],
          assignees: ["a@x.invalid"],
          authors: ["b@x.invalid"],
          milestones: ["v1"],
          deadline: ["OVERDUE", "NONE"],
          text: ["crash"],
        },
        TODAY,
      ),
      {
        status: ["open", "closed"],
        labels: ["bug"],
        assignees: ["a@x.invalid"],
        authors: ["b@x.invalid"],
        milestones: ["v1"],
        reviewers: [],
        reviews: [],
        awaiting: [],
        deadline: ["overdue", "none"],
        today: TODAY,
        text: ["crash"],
        // No plugin terms: the API's filter is the schema's fields, and a
        // plugin adds its own rather than smuggling one through these.
        ext: {},
      },
    );
  });

  it("carries every pull request key across, translating the decisions", () => {
    assert.deepEqual(
      toPrQuery(
        {
          status: ["MERGED"],
          labels: ["bug"],
          assignees: ["a@x.invalid"],
          authors: ["b@x.invalid"],
          milestones: ["v1"],
          reviewers: ["c@x.invalid"],
          reviews: ["CHANGES_REQUESTED", "PENDING"],
          awaiting: ["d@x.invalid"],
          text: ["crash"],
        },
        TODAY,
      ),
      {
        status: ["merged"],
        labels: ["bug"],
        assignees: ["a@x.invalid"],
        authors: ["b@x.invalid"],
        milestones: ["v1"],
        reviewers: ["c@x.invalid"],
        reviews: ["changes-requested", "pending"],
        awaiting: ["d@x.invalid"],
        deadline: [],
        today: TODAY,
        text: ["crash"],
        ext: {},
      },
    );
  });

  it("reads only its own noun's keys, even when handed the other's", () => {
    // Validation refuses these before a resolver runs; this is the second
    // line, so a caller that skipped validation still cannot ask an issue
    // about reviews (spec 04 §4.3). `reviews: [PENDING]` on an issue would
    // otherwise match every one of them.
    const issue = toIssueQuery(
      { reviewers: ["c@x.invalid"], reviews: ["PENDING"], awaiting: ["d@x.invalid"] } as never,
      TODAY,
    );
    assert.deepEqual([issue.reviewers, issue.reviews, issue.awaiting], [[], [], []]);
    assert.deepEqual(toPrQuery({ deadline: ["OVERDUE"] } as never, TODAY).deadline, []);
  });

  it("carries the terms plugins read out of their own fields, on either noun", () => {
    const ext = { features: ["auth"] };
    assert.deepEqual(toIssueQuery({ labels: ["bug"] }, TODAY, ext).ext, ext);
    assert.deepEqual(toPrQuery(null, TODAY, ext).ext, ext);
  });

  it("leaves an unmentioned key empty, which filters by none of its values", () => {
    assert.deepEqual(toIssueQuery({ labels: ["bug"] }, TODAY).status, []);
    assert.deepEqual(toIssueQuery({ labels: ["bug"] }, TODAY).deadline, []);
  });

  it("always carries the day, so `overdue` is never a question with no answer", () => {
    assert.equal(toIssueQuery({ deadline: ["OVERDUE"] }, TODAY).today, TODAY);
  });
});
