/**
 * The structured patch over a feature's files — spec 06 §6.3.
 *
 * The end-to-end suite proves a patch reaches the tree; these prove what it
 * does to the bytes, which is where "unknown keys MUST be preserved" (spec 02
 * §2.4) is either honoured or quietly lost. They are the cases that asked the
 * same of `@navbook/server` before the knowledge base became a plugin.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import { parseFile } from "@navbook/core";
import { applyFeaturePatch, applySpecPatch, isEmptySpecPatch } from "../src/server/patch.ts";

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

describe("applyFeaturePatch", () => {
  it("leaves a file it was asked to change nothing about byte-identical", () => {
    assert.equal(applyFeaturePatch(core, FEATURE, {}, FEATURE_PATH), FEATURE);
  });

  it("replaces the title, preserving a key the schema does not name", () => {
    const result = applyFeaturePatch(
      core,
      FEATURE,
      { title: "Authentication and sessions" },
      FEATURE_PATH,
    );
    const { fm, body } = parseFile(result);
    assert.equal(fm.title, "Authentication and sessions");
    assert.deepEqual(fm["my-tool-state"], { phase: "draft" });
    assert.equal(body.trim(), "Signing in.");
  });

  it("replaces the summary", () => {
    const result = applyFeaturePatch(core, FEATURE, { summary: "Signing out." }, FEATURE_PATH);
    assert.equal(parseFile(result).body.trim(), "Signing out.");
  });

  it("clears the summary on an explicit null, leaving no trailing blank line", () => {
    for (const summary of [null, "   "]) {
      const result = applyFeaturePatch(core, FEATURE, { summary }, FEATURE_PATH);
      assert.equal(parseFile(result).body, "");
      assert.ok(result.endsWith("---\n"));
    }
  });

  it("refuses a title emptied rather than replaced", () => {
    assert.throws(
      () => applyFeaturePatch(core, FEATURE, { title: "  " }, FEATURE_PATH),
      /title must not be empty/,
    );
  });

  it("reports a file it cannot round-trip by path, as the file's fault", () => {
    const broken = "---\ntitle: X\nbad: [unclosed\n---\n\nBody.\n";
    assert.throws(
      () => applyFeaturePatch(core, broken, { title: "Y" }, FEATURE_PATH),
      (error: Error) => error.message.includes(FEATURE_PATH),
    );
  });
});

describe("applySpecPatch", () => {
  it("leaves a file it was asked to change nothing about byte-identical", () => {
    assert.equal(applySpecPatch(core, SPEC, {}, SPEC_PATH), SPEC);
  });

  it("replaces the body, preserving keys the schema does not name", () => {
    const result = applySpecPatch(core, SPEC, { body: "Rewritten." }, SPEC_PATH);
    const { fm, body } = parseFile(result);
    assert.equal(fm.title, "Login flow");
    assert.equal(fm.author, "A Person <person@example.invalid>");
    assert.equal(fm["imported-from"], "github:acme/repo#12");
    assert.equal(body.trim(), "Rewritten.");
  });

  it("replaces the title", () => {
    const result = applySpecPatch(core, SPEC, { title: "Sign-in flow" }, SPEC_PATH);
    assert.equal(parseFile(result).fm.title, "Sign-in flow");
  });

  it("refuses a title or body emptied rather than replaced", () => {
    for (const input of [{ title: "  " }, { body: "  " }]) {
      assert.throws(() => applySpecPatch(core, SPEC, input, SPEC_PATH), /must not be empty/);
    }
  });

  it("knows a patch that names nothing to change", () => {
    assert.equal(isEmptySpecPatch({}), true);
    assert.equal(isEmptySpecPatch({ body: "y" }), false);
    assert.equal(isEmptySpecPatch({ title: null }), false);
  });
});
