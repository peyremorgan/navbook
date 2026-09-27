/**
 * How a tracker commit reads on the Changes tab. The server said what each
 * commit did; these are the words put to it.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  type ActivityCommit,
  activitySentence,
  factLabel,
  verbColor,
} from "../../app/utils/activity";

const commit = (over: Partial<ActivityCommit>): ActivityCommit => ({
  subject: "docs(issue): close #ozzaoa36",
  verb: "close",
  kind: "ISSUE",
  entity: "ozzaoa36",
  facts: [],
  ...over,
});

describe("activitySentence", () => {
  it("names a close's resolution, and links the issue", () => {
    const sentence = activitySentence(
      commit({ facts: [{ field: "resolution", before: null, after: "fixed" }] }),
      "rw1mjrnv",
    );
    assert.deepEqual(sentence, {
      lead: "Closed issue",
      record: { label: "#ozzaoa36", to: "/issues/ozzaoa36" },
      tail: " as",
      emphasis: "fixed",
    });
  });

  it("calls the page's own pull request this pull request, unlinked", () => {
    const sentence = activitySentence(
      commit({ subject: "docs(pr): open #rw1mjrnv", verb: "open", kind: "PR", entity: "rw1mjrnv" }),
      "rw1mjrnv",
    );
    assert.deepEqual(sentence, {
      lead: "Opened this pull request",
      record: null,
      tail: "",
      emphasis: null,
    });
  });

  it("links another pull request", () => {
    assert.equal(
      activitySentence(commit({ verb: "comment", kind: "PR", entity: "feu6fmzu" }), "rw1mjrnv")
        .record?.to,
      "/prs/feu6fmzu",
    );
  });

  it("gives a review its verdict", () => {
    const sentence = activitySentence(
      commit({
        verb: "review",
        kind: "PR",
        entity: "rw1mjrnv",
        facts: [{ field: "verdict", before: null, after: "request-changes" }],
      }),
      "rw1mjrnv",
    );
    assert.equal(sentence.lead, "Reviewed this pull request");
    assert.equal(sentence.emphasis, "request changes");
  });

  it("falls back to the subject when nothing was named", () => {
    assert.deepEqual(
      activitySentence(
        commit({ subject: "Tidy the tracker", verb: null, kind: null, entity: null }),
        "x",
      ),
      { lead: "Tidy the tracker", record: null, tail: "", emphasis: null },
    );
    // A verb this client has no words for is no better than none.
    assert.equal(activitySentence(commit({ subject: "S", verb: "transmogrify" }), "x").lead, "S");
  });
});

describe("factLabel", () => {
  it("shows a value that was set, a change, and a removal", () => {
    assert.deepEqual(factLabel({ field: "resolution", before: null, after: "fixed" }), {
      field: "resolution",
      value: "fixed",
    });
    assert.deepEqual(factLabel({ field: "status", before: "open", after: "closed" }), {
      field: "status",
      value: "open → closed",
    });
    assert.deepEqual(factLabel({ field: "milestone", before: "1.0", after: null }), {
      field: "milestone",
      value: "1.0 → —",
    });
  });
});

describe("verbColor", () => {
  it("tells making, ending, talking and changing apart", () => {
    assert.deepEqual(["open", "close", "review", "edit", null].map(verbColor), [
      "success",
      "secondary",
      "info",
      "neutral",
      "neutral",
    ]);
  });
});
