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
import { applyIssuePatch, isEmptyPatch } from "../../src/patch.ts";

const PATH = "issues/open/aa111111-x/issue.md";

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
  applyIssuePatch(ORIGINAL, { ref: "aa111111", ...input }, PATH);

describe("applyIssuePatch", () => {
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
      () => applyIssuePatch(broken, { ref: "aa111111", title: "New" }, PATH),
      (error: unknown) => {
        const extensions = (error as { extensions?: Record<string, unknown> }).extensions ?? {};
        assert.equal(extensions.code, "FRONTMATTER");
        assert.match((error as Error).message, /\.navbook\/issues\/open\/aa111111-x\/issue\.md/);
        return true;
      },
    );
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
});
