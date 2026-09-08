/**
 * The structured patch, over file text.
 *
 * The end-to-end tests prove a patch reaches the tree; these prove what it does
 * to the bytes — which is where "unknown keys MUST be preserved" (spec 02 §2.4)
 * is either honoured or quietly lost.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFile, readFeatures } from "@navbook/core";
import {
  applyEntityPatch,
  applyFeaturePatch,
  applySpecPatch,
  isEmptyPatch,
  isEmptySpecPatch,
} from "../../src/patch.ts";

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

/* ----------------------------------------------------------------- features */

const FEATURE_PATH = ".navbook/specs/auth/feature.md";
const SPEC_PATH = ".navbook/specs/auth/login-flow.md";

const FEATURE = `---
title: Authentication
author: A Person <person@example.invalid>
created: 2026-09-01T10:00:00Z
my-tool-state: {phase: draft}
---

Signing in.
`;

const SPEC = `---
title: Login flow
author: A Person <person@example.invalid>
imported-from: github:acme/repo#12
---

## Requirements
`;

describe("the feature key on an issue patch", () => {
  it("writes one feature as a scalar and several as a flow list", () => {
    assert.match(patch({ features: ["auth"] }), /^feature: auth$/m);
    assert.match(patch({ features: ["auth", "mobile"] }), /^feature: \[auth, mobile\]$/m);
  });

  it("clears the key on an explicit null and on an empty list", () => {
    const attached = applyEntityPatch(ORIGINAL, { ref: "aa111111", features: ["auth"] }, PATH);
    for (const features of [null, []]) {
      const cleared = applyEntityPatch(attached, { ref: "aa111111", features }, PATH);
      assert.deepEqual(readFeatures(parseFile(cleared).fm), []);
      assert.doesNotMatch(cleared, /^feature:/m);
    }
  });

  it("leaves the key alone when the patch does not name it", () => {
    const attached = applyEntityPatch(ORIGINAL, { ref: "aa111111", features: ["auth"] }, PATH);
    const renamed = applyEntityPatch(attached, { ref: "aa111111", title: "Renamed" }, PATH);
    assert.deepEqual(readFeatures(parseFile(renamed).fm), ["auth"]);
  });

  it("counts as something to change", () => {
    assert.equal(isEmptyPatch({ ref: "aa111111" }), true);
    assert.equal(isEmptyPatch({ ref: "aa111111", features: [] }), false);
  });
});

describe("applyFeaturePatch", () => {
  it("leaves a file it was asked to change nothing about byte-identical", () => {
    assert.equal(applyFeaturePatch(FEATURE, { slug: "auth", baseSha: "x" }, FEATURE_PATH), FEATURE);
  });

  it("replaces the title, preserving a key the schema does not name", () => {
    const result = applyFeaturePatch(
      FEATURE,
      { slug: "auth", title: "Authentication and sessions", baseSha: "x" },
      FEATURE_PATH,
    );
    const { fm, body } = parseFile(result);
    assert.equal(fm.title, "Authentication and sessions");
    assert.deepEqual(fm["my-tool-state"], { phase: "draft" });
    assert.equal(body.trim(), "Signing in.");
  });

  it("clears the summary on an explicit null, leaving no trailing blank line", () => {
    const result = applyFeaturePatch(
      FEATURE,
      { slug: "auth", summary: null, baseSha: "x" },
      FEATURE_PATH,
    );
    assert.equal(parseFile(result).body, "");
    assert.ok(result.endsWith("---\n"));
  });

  it("refuses a title emptied rather than replaced", () => {
    assert.throws(() =>
      applyFeaturePatch(FEATURE, { slug: "auth", title: "  ", baseSha: "x" }, FEATURE_PATH),
    );
  });
});

describe("applySpecPatch", () => {
  it("leaves a file it was asked to change nothing about byte-identical", () => {
    assert.equal(
      applySpecPatch(SPEC, { feature: "auth", fileName: "x.md", baseSha: "x" }, SPEC_PATH),
      SPEC,
    );
  });

  it("replaces the body, preserving keys the schema does not name", () => {
    const result = applySpecPatch(
      SPEC,
      { feature: "auth", fileName: "x.md", body: "Rewritten.", baseSha: "x" },
      SPEC_PATH,
    );
    const { fm, body } = parseFile(result);
    assert.equal(fm.title, "Login flow");
    assert.equal(fm.author, "A Person <person@example.invalid>");
    assert.equal(fm["imported-from"], "github:acme/repo#12");
    assert.equal(body.trim(), "Rewritten.");
  });

  it("refuses a title or body emptied rather than replaced", () => {
    for (const input of [{ title: "  " }, { body: "  " }]) {
      assert.throws(() =>
        applySpecPatch(
          SPEC,
          { feature: "auth", fileName: "x.md", baseSha: "x", ...input },
          SPEC_PATH,
        ),
      );
    }
  });

  it("knows a patch that names nothing to change", () => {
    assert.equal(isEmptySpecPatch({ feature: "auth", fileName: "x.md", baseSha: "x" }), true);
    assert.equal(
      isEmptySpecPatch({ feature: "auth", fileName: "x.md", baseSha: "x", body: "y" }),
      false,
    );
  });
});
