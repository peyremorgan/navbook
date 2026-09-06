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
  buildIssuePatch,
  type IssueEdit,
  normalizeList,
  normalizeOptional,
  PatchError,
} from "../../app/utils/patch";

const BEFORE: IssueEdit = {
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

describe("buildIssuePatch", () => {
  it("is null when nothing was said", () => {
    assert.equal(buildIssuePatch(BEFORE, {}), null);
  });

  it("is null when what was said is what is already there", () => {
    // The server refuses an empty patch, and an editor opened and closed again
    // must not be an error.
    assert.equal(buildIssuePatch(BEFORE, { title: BEFORE.title }), null);
    assert.equal(buildIssuePatch(BEFORE, { title: `  ${BEFORE.title}  ` }), null);
    assert.equal(buildIssuePatch(BEFORE, { labels: ["bug", "auth"] }), null);
    assert.equal(buildIssuePatch(BEFORE, { labels: [" bug ", " auth "] }), null);
    assert.equal(buildIssuePatch(BEFORE, { milestone: "1.0" }), null);
    assert.equal(buildIssuePatch(BEFORE, { milestone: " 1.0 " }), null);
    assert.equal(buildIssuePatch(BEFORE, { ...BEFORE }), null);
  });

  it("carries only the field that changed", () => {
    assert.deepEqual(buildIssuePatch(BEFORE, { title: "Sign-in times out" }), {
      title: "Sign-in times out",
    });
    // Not the body, not the labels: an untouched key must not be rewritten.
    assert.deepEqual(Object.keys(buildIssuePatch(BEFORE, { body: "Different." }) ?? {}), ["body"]);
  });

  it("spells clearing as the mutation spells it", () => {
    // An empty list removes the key; an explicit null removes the milestone.
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: [] }), { labels: [] });
    assert.deepEqual(buildIssuePatch(BEFORE, { assignees: [] }), { assignees: [] });
    assert.deepEqual(buildIssuePatch(BEFORE, { milestone: null }), { milestone: null });
    assert.deepEqual(buildIssuePatch(BEFORE, { milestone: "" }), { milestone: null });
  });

  it("does not offer to clear what is already absent", () => {
    const bare: IssueEdit = { ...BEFORE, labels: [], assignees: [], milestone: null };
    assert.equal(buildIssuePatch(bare, { labels: [] }), null);
    assert.equal(buildIssuePatch(bare, { milestone: null }), null);
    assert.equal(buildIssuePatch(bare, { milestone: "" }), null);
  });

  it("treats reordering as a change, because the file records the order", () => {
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: ["auth", "bug"] }), {
      labels: ["auth", "bug"],
    });
  });

  it("treats a change of case as a change, because the file records the spelling", () => {
    // The server matches labels case-insensitively, so `BUG` and `bug` filter
    // alike — but the file holds one of them, and rewriting it is what was
    // asked for. Only duplicates *within* one list are folded.
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: ["BUG", "auth"] }), {
      labels: ["BUG", "auth"],
    });
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: ["bug", "BUG", "auth"] }), null);
  });

  it("normalises what it does send", () => {
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: [" bug ", "auth", "AUTH", ""] }), null);
    assert.deepEqual(buildIssuePatch(BEFORE, { labels: ["bug", "auth", " docs "] }), {
      labels: ["bug", "auth", "docs"],
    });
    assert.deepEqual(buildIssuePatch(BEFORE, { title: "  Trimmed  " }), { title: "Trimmed" });
  });

  it("refuses to empty a title or a body", () => {
    // The format needs a title to name the directory, and the server refuses
    // both — better to say so before a request than after one.
    assert.throws(() => buildIssuePatch(BEFORE, { title: "" }), PatchError);
    assert.throws(() => buildIssuePatch(BEFORE, { title: "   " }), /a title is required/);
    assert.throws(() => buildIssuePatch(BEFORE, { body: "" }), PatchError);
    assert.throws(() => buildIssuePatch(BEFORE, { body: "\n\t " }), /a description is required/);
  });

  it("changes several fields at once when several were edited", () => {
    assert.deepEqual(buildIssuePatch(BEFORE, { title: "New", labels: ["docs"], milestone: null }), {
      title: "New",
      labels: ["docs"],
      milestone: null,
    });
  });
});
