/**
 * The structured patch, over file text.
 *
 * The end-to-end tests prove a patch reaches the tree; these prove what it does
 * to the bytes — which is where "unknown keys MUST be preserved" (spec 02 §2.4)
 * is either honoured or quietly lost.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFile } from "@navbook/core";
import { applyEntityPatch, isEmptyPatch, movedFields, namedFields } from "../../src/patch.ts";

// Repository-relative: `applyEntityPatch` reports the path it is given rather
// than prefixing one, so the Navbook directory's name stays the caller's business.
const PATH = ".navbook/issues/open/aa111111-x/issue.md";

const ORIGINAL = `---
title: Original
author: A Person <person@example.invalid>
created: 2026-08-01T10:00:00Z
labels: [one, two]
milestone: v1
imported-from: github:acme/repo#12
---

The body.
`;

const patch = (input: Record<string, unknown>): string =>
  applyEntityPatch(ORIGINAL, { ref: "aa111111", ...input }, PATH);

describe("applyEntityPatch — reviewers", () => {
  // The pull-request half of the same patch: `reviewer` is singular on disk and
  // takes a scalar or a list, exactly as `assignee` does (spec 02 §2.7).
  const reviewer = (value: readonly string[] | null | undefined, from = ORIGINAL): string =>
    applyEntityPatch(from, { ref: "aa111111", reviewers: value }, PATH);

  it("writes one as a scalar and several as a flow list", () => {
    assert.match(reviewer(["alice@example.com"]), /^reviewer: alice@example\.com$/m);
    assert.match(
      reviewer(["alice@example.com", "bo@example.com"]),
      /^reviewer: \[alice@example\.com, bo@example\.com\]$/m,
    );
  });

  it("clears the key for an empty list or a null, and leaves it alone when absent", () => {
    const asked = reviewer(["alice@example.com"]);
    assert.equal(reviewer([], asked).includes("reviewer"), false);
    assert.equal(reviewer(null, asked).includes("reviewer"), false);
    assert.match(reviewer(undefined, asked), /^reviewer: alice@example\.com$/m);
  });
});

describe("applyEntityPatch", () => {
  it("leaves a file it was asked to change nothing about byte-identical", () => {
    assert.equal(patch({}), ORIGINAL);
  });

  it("replaces the title and nothing else", () => {
    const result = patch({ title: "Renamed" });
    const { fm, body } = parseFile(result);
    assert.equal(fm.title, "Renamed");
    assert.equal(fm.milestone, "v1");
    assert.deepEqual(fm.labels, ["one", "two"]);
    assert.equal(body.trim(), "The body.");
  });

  it("preserves keys it does not know about", () => {
    const result = patch({ title: "Renamed", labels: ["three"] });
    assert.match(result, /^imported-from: github:acme\/repo#12$/m);
  });

  it("replaces the body and replays the frontmatter verbatim", () => {
    const result = patch({ body: "A new body." });
    // Byte-for-byte: an edit that did not touch the frontmatter must not
    // round-trip it through the YAML printer.
    assert.equal(result.split("---\n")[1], ORIGINAL.split("---\n")[1]);
    assert.equal(parseFile(result).body.trim(), "A new body.");
  });

  it("normalizes a body's trailing whitespace to one newline", () => {
    assert.ok(patch({ body: "Trailing.\n\n\n  " }).endsWith("Trailing.\n"));
  });

  it("clears a key with null and with an empty list", () => {
    assert.doesNotMatch(patch({ milestone: null }), /^milestone:/m);
    assert.doesNotMatch(patch({ labels: null }), /^labels:/m);
    assert.doesNotMatch(patch({ labels: [] }), /^labels:/m);
  });

  it("writes one assignee as a scalar and several in flow style", () => {
    assert.match(patch({ assignees: ["A <a@x.invalid>"] }), /^assignee: A <a@x\.invalid>$/m);
    assert.match(
      patch({ assignees: ["A <a@x.invalid>", "B <b@x.invalid>"] }),
      /^assignee: \[A <a@x\.invalid>, B <b@x\.invalid>\]$/m,
    );
  });

  it("refuses to empty a title or a body", () => {
    assert.throws(() => patch({ title: "   " }), /must not be empty/);
    assert.throws(() => patch({ body: "\n\n" }), /must not be empty/);
  });

  it("reports frontmatter it cannot rewrite, naming the file", () => {
    const broken = "---\ntitle: [unclosed\n---\n\nBody.\n";
    assert.throws(
      () => applyEntityPatch(broken, { ref: "aa111111", title: "New" }, PATH),
      (error: unknown) => {
        const extensions = (error as { extensions?: Record<string, unknown> }).extensions ?? {};
        assert.equal(extensions.code, "FRONTMATTER");
        assert.match((error as Error).message, /\.navbook\/issues\/open\/aa111111-x\/issue\.md/);
        return true;
      },
    );
  });
});

/**
 * Rank and deadline through the same three-state contract as everything else:
 * absent leaves the key alone, an explicit null clears it, a value replaces it.
 */
describe("applyEntityPatch — rank and deadline", () => {
  it("adds both keys, keeping the ones the file already had", () => {
    const written = patch({ rank: 20, deadline: "2026-10-01" });
    assert.match(written, /^rank: 20$/m);
    assert.match(written, /^deadline: 2026-10-01$/m);
    assert.match(written, /^title: Original$/m);
    assert.match(written, /^imported-from: github:acme\/repo#12$/m);
  });

  it("writes a rank of zero, which is a position like any other", () => {
    assert.match(patch({ rank: 0 }), /^rank: 0$/m);
    assert.match(patch({ rank: -2.5 }), /^rank: -2\.5$/m);
  });

  it("replaces a value that is already there", () => {
    const placed = applyEntityPatch(
      ORIGINAL.replace("milestone: v1", "milestone: v1\nrank: 10\ndeadline: 2026-10-01"),
      { ref: "aa111111", rank: 15, deadline: "2026-11-01" },
      PATH,
    );
    assert.match(placed, /^rank: 15$/m);
    assert.match(placed, /^deadline: 2026-11-01$/m);
  });

  it("clears a key on an explicit null, and leaves it alone when absent", () => {
    const placed = ORIGINAL.replace(
      "milestone: v1",
      "milestone: v1\nrank: 10\ndeadline: 2026-10-01",
    );
    const cleared = applyEntityPatch(placed, { ref: "aa111111", rank: null }, PATH);
    assert.doesNotMatch(cleared, /^rank:/m);
    assert.match(cleared, /^deadline: 2026-10-01$/m, "the key nobody named is untouched");

    const undated = applyEntityPatch(placed, { ref: "aa111111", deadline: null }, PATH);
    assert.doesNotMatch(undated, /^deadline:/m);
    assert.match(undated, /^rank: 10$/m);
  });

  it("refuses a deadline that is not a day, rather than writing an invalid file", () => {
    // This rewrites a file that was well formed a moment ago; a fault reported
    // against the file would be pointing at the wrong thing.
    for (const value of ["2026-02-30", "2026-10-01T09:00:00Z", "someday"]) {
      assert.throws(() => patch({ deadline: value }), /calendar date/, value);
    }
  });

  it("leaves the file byte for byte when neither key is named", () => {
    assert.equal(patch({ title: "Original" }), ORIGINAL);
  });
});

describe("isEmptyPatch", () => {
  it("is true only when no field was named", () => {
    assert.equal(isEmptyPatch({ ref: "aa111111" }), true);
    assert.equal(isEmptyPatch({ ref: "aa111111", title: "x" }), false);
    // An explicit null is a change: it clears the key.
    assert.equal(isEmptyPatch({ ref: "aa111111", milestone: null }), false);
    assert.equal(isEmptyPatch({ ref: "aa111111", labels: [] }), false);
  });

  it("counts rank and deadline, so unplacing one is not an empty request", () => {
    assert.equal(isEmptyPatch({ ref: "aa111111", rank: null }), false);
    assert.equal(isEmptyPatch({ ref: "aa111111", deadline: null }), false);
    // Zero is a rank, not an absent one.
    assert.equal(isEmptyPatch({ ref: "aa111111", rank: 0 }), false);
  });
});

/* ------------------------------------------------------------- plugin keys */

describe("applyEntityPatch — a plugin's keys", () => {
  // What a plugin's `patchFields` bridge returns, keyed by frontmatter key
  // (spec 02 §2.12). The host writes it as it writes its own multi-valued
  // fields, so a plugin's key reads on disk the way `assignee` does.
  const withExt = (from: string, ext: Record<string, unknown>): string =>
    applyEntityPatch(from, { ref: "aa111111" }, PATH, ext);

  it("writes one value as a scalar and several as a flow list", () => {
    assert.match(withExt(ORIGINAL, { component: ["auth"] }), /^component: auth$/m);
    assert.match(
      withExt(ORIGINAL, { component: ["auth", "mobile"] }),
      /^component: \[auth, mobile\]$/m,
    );
  });

  it("clears the key on an explicit null and on an empty list", () => {
    const attached = withExt(ORIGINAL, { component: ["auth"] });
    for (const component of [null, []]) {
      const cleared = withExt(attached, { component });
      assert.doesNotMatch(cleared, /^component:/m);
      assert.equal(parseFile(cleared).fm.title, "Original");
    }
  });

  it("leaves the key alone when the patch does not name it", () => {
    const attached = withExt(ORIGINAL, { component: ["auth"] });
    const renamed = applyEntityPatch(attached, { ref: "aa111111", title: "Renamed" }, PATH);
    assert.match(renamed, /^component: auth$/m);
    assert.match(renamed, /^title: Renamed$/m);
  });

  it("writes a scalar value as it is given", () => {
    assert.match(withExt(ORIGINAL, { phase: "draft" }), /^phase: draft$/m);
  });

  it("cannot replace a key the format defines", () => {
    // A plugin's keys are written first, so the format's own handling of the
    // same key, when the patch names it too, has the last word.
    const result = applyEntityPatch(ORIGINAL, { ref: "aa111111", labels: ["mine"] }, PATH, {
      labels: ["theirs"],
    });
    assert.match(result, /^labels: \[mine\]$/m);
  });
});

describe("movedFields", () => {
  // Two versions of one file, and a patch: which of the fields the patch would
  // write did somebody else change in between? Only those are a conflict.
  const RETITLED = ORIGINAL.replace("title: Original", "title: Retitled");
  const moved = (current: string, input: Record<string, unknown>): string[] =>
    movedFields(ORIGINAL, current, { ref: "aa111111", ...input });

  it("names a field the patch writes that has changed since", () => {
    assert.deepEqual(moved(RETITLED, { title: "Mine" }), ["title"]);
  });

  it("ignores a field that changed when the patch leaves it alone", () => {
    assert.deepEqual(moved(RETITLED, { labels: ["three"] }), []);
  });

  it("is empty when the two versions are the same file", () => {
    assert.deepEqual(moved(ORIGINAL, { title: "Mine", labels: [], body: "New." }), []);
  });

  it("lists every moved field the patch names, in a fixed order", () => {
    const both = RETITLED.replace("The body.", "Another body.");
    assert.deepEqual(moved(both, { body: "Mine.", title: "Mine", milestone: "v2" }), [
      "title",
      "body",
    ]);
  });

  it("reads a cleared key as a change", () => {
    const unlabelled = ORIGINAL.replace("labels: [one, two]\n", "");
    assert.deepEqual(moved(unlabelled, { labels: ["one"] }), ["labels"]);
    const unmilestoned = ORIGINAL.replace("milestone: v1\n", "");
    assert.deepEqual(moved(unmilestoned, { milestone: null }), ["milestone"]);
  });

  it("does not mistake a respelling for a change", () => {
    // `assignee: A` and `assignee: [A]` are one value to every reader (§2.5),
    // so a hand edit that switched spellings must not refuse the next patch.
    const scalar = ORIGINAL.replace(
      "milestone: v1",
      "milestone: v1\nassignee: A <a@example.invalid>",
    );
    const list = ORIGINAL.replace(
      "milestone: v1",
      "milestone: v1\nassignee: [A <a@example.invalid>]",
    );
    assert.deepEqual(movedFields(scalar, list, { ref: "aa111111", assignees: [] }), []);
  });

  it("compares the body trimmed, as the resolver reports it", () => {
    assert.deepEqual(moved(`${ORIGINAL}\n\n`, { body: "Mine." }), []);
  });

  it("reads rank and deadline the way their resolvers do", () => {
    const placed = ORIGINAL.replace(
      "milestone: v1",
      "milestone: v1\nrank: 3\ndeadline: 2026-10-01",
    );
    assert.deepEqual(moved(placed, { rank: 1, deadline: null }), ["rank", "deadline"]);
    // A deadline that is not a day reads as none, and none is what it was.
    const junk = ORIGINAL.replace("milestone: v1", "milestone: v1\ndeadline: soon");
    assert.deepEqual(moved(junk, { deadline: "2026-10-01" }), []);
  });

  it("does not count a null title or body, which the patch leaves alone", () => {
    // `applyEntityPatch` writes a title or body only when given one; a null
    // is not a clearing, so it is not a field to be refused over either.
    assert.deepEqual(moved(RETITLED, { title: null, labels: ["x"] }), []);
    assert.deepEqual(namedFields({ ref: "aa111111", title: null, body: null, labels: null }), [
      "labels",
    ]);
  });

  it("folds line endings before comparing the body", () => {
    // A clean filter hands git LF and keeps CRLF on disk; same body.
    const crlf = ORIGINAL.replace(/\n/g, "\r\n");
    assert.deepEqual(movedFields(ORIGINAL, crlf, { ref: "aa111111", body: "Mine." }), []);
  });

  it("names the pull request's reviewers by the input's spelling", () => {
    const asked = ORIGINAL.replace("milestone: v1", "milestone: v1\nreviewer: r@example.invalid");
    assert.deepEqual(moved(asked, { reviewers: [] }), ["reviewers"]);
  });
});

describe("namedFields", () => {
  it("lists what the patch names, and nothing about the hash or the ref", () => {
    assert.deepEqual(namedFields({ ref: "aa111111", baseSha: "x", labels: null, title: "T" }), [
      "title",
      "labels",
    ]);
    assert.deepEqual(namedFields({ ref: "aa111111" }), []);
  });
});
