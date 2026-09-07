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
