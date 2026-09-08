/**
 * The patch builder is where an edit can quietly destroy data, so this is the
 * suite that matters most.
 *
 * `updateIssue` reads an absent field as "leave it alone", an explicit null or
 * an empty list as "remove the key", and anything else as a replacement. Send
 * the whole form and you rewrite frontmatter nobody touched; send an empty
 * patch and the server refuses it. Both are tested here.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildEntityPatch,
  type EntityEdit,
  normalizeList,
  normalizeOptional,
  PatchError,
  parseRankInput,
} from "../../app/utils/patch";

const BEFORE: EntityEdit = {
  title: "Sign-in is unreliable",
  body: "It gives up too early.",
  labels: ["bug", "auth"],
  assignees: ["A Person <person@example.invalid>"],
  milestone: "1.0",
  features: ["auth"],
};

describe("normalizeList", () => {
  it("trims, drops blanks and folds duplicates by case", () => {
    assert.deepEqual(normalizeList([" bug ", "", "BUG", "auth", "  "]), ["bug", "auth"]);
  });

  it("keeps the first spelling of a duplicate", () => {
    assert.deepEqual(normalizeList(["Bug", "bug"]), ["Bug"]);
  });
});

describe("normalizeOptional", () => {
  it("turns blank into the absence of a value", () => {
    assert.equal(normalizeOptional(""), null);
    assert.equal(normalizeOptional("   "), null);
    assert.equal(normalizeOptional(null), null);
    assert.equal(normalizeOptional(undefined), null);
    assert.equal(normalizeOptional("  1.0 "), "1.0");
  });
});

describe("buildEntityPatch — reviewers", () => {
  // A pull request's alone (spec 02 §2.7); an issue's patch never mentions it,
  // and a builder that sent it anyway would be asking the server for a key the
  // input does not have.
  it("is absent for a form that never edited it", () => {
    assert.equal("reviewers" in (buildEntityPatch(BEFORE, { title: "New" }) ?? {}), false);
  });

  it("carries the list when it changed, and an empty one to clear it", () => {
    const before: EntityEdit = { ...BEFORE, reviewers: ["alice@example.invalid"] };
    assert.deepEqual(
      buildEntityPatch(before, { reviewers: ["alice@example.invalid", "bo@x.invalid"] }),
      {
        reviewers: ["alice@example.invalid", "bo@x.invalid"],
      },
    );
    assert.deepEqual(buildEntityPatch(before, { reviewers: [] }), { reviewers: [] });
    assert.equal(buildEntityPatch(before, { reviewers: ["alice@example.invalid"] }), null);
  });

  it("treats a pull request that asked nobody as an empty list", () => {
    assert.deepEqual(buildEntityPatch(BEFORE, { reviewers: ["alice@example.invalid"] }), {
      reviewers: ["alice@example.invalid"],
    });
    assert.equal(buildEntityPatch(BEFORE, { reviewers: [] }), null);
  });
});

describe("buildEntityPatch", () => {
  it("is null when nothing was said", () => {
    assert.equal(buildEntityPatch(BEFORE, {}), null);
  });

  it("is null when what was said is what is already there", () => {
    // The server refuses an empty patch, and an editor opened and closed again
    // must not be an error.
    assert.equal(buildEntityPatch(BEFORE, { title: BEFORE.title }), null);
    assert.equal(buildEntityPatch(BEFORE, { title: `  ${BEFORE.title}  ` }), null);
    assert.equal(buildEntityPatch(BEFORE, { labels: ["bug", "auth"] }), null);
    assert.equal(buildEntityPatch(BEFORE, { labels: [" bug ", " auth "] }), null);
    assert.equal(buildEntityPatch(BEFORE, { milestone: "1.0" }), null);
    assert.equal(buildEntityPatch(BEFORE, { milestone: " 1.0 " }), null);
    assert.equal(buildEntityPatch(BEFORE, { ...BEFORE }), null);
  });

  it("carries only the field that changed", () => {
    assert.deepEqual(buildEntityPatch(BEFORE, { title: "Sign-in times out" }), {
      title: "Sign-in times out",
    });
    // Not the body, not the labels: an untouched key must not be rewritten.
    assert.deepEqual(Object.keys(buildEntityPatch(BEFORE, { body: "Different." }) ?? {}), ["body"]);
  });

  it("spells clearing as the mutation spells it", () => {
    // An empty list removes the key; an explicit null removes the milestone.
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: [] }), { labels: [] });
    assert.deepEqual(buildEntityPatch(BEFORE, { assignees: [] }), { assignees: [] });
    assert.deepEqual(buildEntityPatch(BEFORE, { milestone: null }), { milestone: null });
    assert.deepEqual(buildEntityPatch(BEFORE, { milestone: "" }), { milestone: null });
  });

  it("does not offer to clear what is already absent", () => {
    const bare: EntityEdit = { ...BEFORE, labels: [], assignees: [], milestone: null };
    assert.equal(buildEntityPatch(bare, { labels: [] }), null);
    assert.equal(buildEntityPatch(bare, { milestone: null }), null);
    assert.equal(buildEntityPatch(bare, { milestone: "" }), null);
  });

  it("treats reordering as a change, because the file records the order", () => {
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: ["auth", "bug"] }), {
      labels: ["auth", "bug"],
    });
  });

  it("treats a change of case as a change, because the file records the spelling", () => {
    // The server matches labels case-insensitively, so `BUG` and `bug` filter
    // alike — but the file holds one of them, and rewriting it is what was
    // asked for. Only duplicates *within* one list are folded.
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: ["BUG", "auth"] }), {
      labels: ["BUG", "auth"],
    });
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: ["bug", "BUG", "auth"] }), null);
  });

  it("normalises what it does send", () => {
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: [" bug ", "auth", "AUTH", ""] }), null);
    assert.deepEqual(buildEntityPatch(BEFORE, { labels: ["bug", "auth", " docs "] }), {
      labels: ["bug", "auth", "docs"],
    });
    assert.deepEqual(buildEntityPatch(BEFORE, { title: "  Trimmed  " }), { title: "Trimmed" });
  });

  it("refuses to empty a title or a body", () => {
    // The format needs a title to name the directory, and the server refuses
    // both — better to say so before a request than after one.
    assert.throws(() => buildEntityPatch(BEFORE, { title: "" }), PatchError);
    assert.throws(() => buildEntityPatch(BEFORE, { title: "   " }), /a title is required/);
    assert.throws(() => buildEntityPatch(BEFORE, { body: "" }), PatchError);
    assert.throws(() => buildEntityPatch(BEFORE, { body: "\n\t " }), /a description is required/);
  });

  it("changes several fields at once when several were edited", () => {
    assert.deepEqual(
      buildEntityPatch(BEFORE, { title: "New", labels: ["docs"], milestone: null }),
      {
        title: "New",
        labels: ["docs"],
        milestone: null,
      },
    );
  });
});

/**
 * Rank and deadline through the same three states as every other field, plus
 * the two things only true of these: a rank of zero is a position and not an
 * absence, and a bad deadline is refused here rather than at the server.
 */
describe("buildEntityPatch — rank and deadline", () => {
  /** An issue that is neither placed nor dated, which most of them are. */
  const UNPLACED: EntityEdit = { ...BEFORE, rank: null, deadline: null };
  /** And one that is both. */
  const PLACED: EntityEdit = { ...BEFORE, rank: 10, deadline: "2026-10-01" };

  it("places and dates an issue that was neither", () => {
    assert.deepEqual(buildEntityPatch(UNPLACED, { rank: 20 }), { rank: 20 });
    assert.deepEqual(buildEntityPatch(UNPLACED, { deadline: "2026-10-01" }), {
      deadline: "2026-10-01",
    });
  });

  it("sends a rank of zero, which is a position rather than an absence", () => {
    assert.deepEqual(buildEntityPatch(UNPLACED, { rank: 0 }), { rank: 0 });
    assert.deepEqual(buildEntityPatch(PLACED, { rank: 0 }), { rank: 0 });
  });

  it("sends a negative and a fractional rank, which the format allows", () => {
    assert.deepEqual(buildEntityPatch(UNPLACED, { rank: -5 }), { rank: -5 });
    assert.deepEqual(buildEntityPatch(UNPLACED, { rank: 12.5 }), { rank: 12.5 });
  });

  it("sends an explicit null to unplace and to undate", () => {
    assert.deepEqual(buildEntityPatch(PLACED, { rank: null }), { rank: null });
    assert.deepEqual(buildEntityPatch(PLACED, { deadline: null }), { deadline: null });
    // A blank field is how a form spells "no value", and means the same thing.
    assert.deepEqual(buildEntityPatch(PLACED, { deadline: "  " }), { deadline: null });
  });

  it("is null when what was said is what is already there", () => {
    assert.equal(buildEntityPatch(PLACED, { rank: 10 }), null);
    assert.equal(buildEntityPatch(PLACED, { deadline: "2026-10-01" }), null);
    assert.equal(buildEntityPatch(PLACED, { deadline: " 2026-10-01 " }), null);
    assert.equal(buildEntityPatch(UNPLACED, { rank: null, deadline: null }), null);
  });

  it("leaves a key nobody named alone", () => {
    assert.deepEqual(Object.keys(buildEntityPatch(PLACED, { rank: 30 }) ?? {}), ["rank"]);
    assert.equal(buildEntityPatch(PLACED, { title: PLACED.title }), null);
  });

  it("refuses a rank that is not a number, rather than sending it", () => {
    assert.throws(() => buildEntityPatch(UNPLACED, { rank: Number.NaN }), PatchError);
    assert.throws(() => buildEntityPatch(UNPLACED, { rank: Number.NaN }), /a rank is a number/);
    assert.throws(() => buildEntityPatch(UNPLACED, { rank: Number.POSITIVE_INFINITY }), PatchError);
  });

  it("refuses a deadline that is not a day, rather than sending it", () => {
    for (const value of ["2026-02-30", "2026-10-01T09:00:00Z", "2026-1-1", "someday"]) {
      assert.throws(() => buildEntityPatch(UNPLACED, { deadline: value }), PatchError, value);
    }
    assert.throws(
      () => buildEntityPatch(UNPLACED, { deadline: "someday" }),
      /a deadline is a date/,
    );
  });

  it("treats an issue with the keys absent as one carrying neither", () => {
    // A fragment that did not ask for them arrives with both undefined; that
    // must read as unplaced rather than as a change.
    assert.equal(buildEntityPatch(BEFORE, { rank: null }), null);
    assert.equal(buildEntityPatch(BEFORE, { deadline: null }), null);
    assert.deepEqual(buildEntityPatch(BEFORE, { rank: 5 }), { rank: 5 });
  });
});

describe("parseRankInput", () => {
  it("reads a blank field as no rank at all", () => {
    assert.equal(parseRankInput(""), null);
    assert.equal(parseRankInput("   "), null);
    assert.equal(parseRankInput(null), null);
    assert.equal(parseRankInput(undefined), null);
  });

  it("reads a number, whole, negative or fractional", () => {
    assert.equal(parseRankInput("10"), 10);
    assert.equal(parseRankInput(" 0 "), 0);
    assert.equal(parseRankInput("-5"), -5);
    assert.equal(parseRankInput("12.5"), 12.5);
  });

  it("reads text that is not a number as NaN, for the builder to refuse", () => {
    // Not null: "unplace it" and "that is not a rank" are different answers,
    // and only one of them is an edit.
    assert.equal(Number.isNaN(parseRankInput("soon") as number), true);
  });
});
