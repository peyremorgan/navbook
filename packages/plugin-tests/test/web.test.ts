/**
 * The web layer's pure helpers: what a row's `ext` says, how a run's links to
 * its attachments are shown, and how a runner's draft relates to the server.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  base64Of,
  changedSteps,
  draftDiffers,
  draftFromRun,
  draftKey,
  isImage,
  markAttachments,
  parseDraft,
  passRate,
  readTestsExt,
  stateLook,
  stateOf,
} from "../web/app/utils/tests.ts";

describe("states", () => {
  it("reads the API's enums and the format's words alike", () => {
    assert.equal(stateOf("IN_PROGRESS"), "in-progress");
    assert.equal(stateOf("in-progress"), "in-progress");
    assert.equal(stateOf("PASSED"), "passed");
    assert.equal(stateOf(null), "not-run");
    assert.equal(stateOf(undefined), "not-run");
    assert.equal(stateLook("failed").color, "error");
    assert.equal(stateLook("none").label, "Not tested");
    assert.equal(stateLook("not-run").label, "Not run");
  });
});

describe("a row's ext", () => {
  it("reads this plugin's slice, and nothing from a row without one", () => {
    assert.deepEqual(readTestsExt({ tests: { tested: "failed", runs: 2 } }), {
      tested: "failed",
      runs: 2,
    });
    assert.equal(readTestsExt({}), null);
    assert.equal(readTestsExt(null), null);
    assert.equal(readTestsExt({ tests: "failed" }), null);
    assert.equal(readTestsExt({ tests: { tested: "green", runs: 1 } }), null);
    assert.deepEqual(readTestsExt({ tests: { tested: "none", runs: -1 } }), {
      tested: "none",
      runs: 0,
    });
  });
});

describe("links to a run's attachments", () => {
  const path = ".navbook/tests/login/runs/2026-09-21T090000Z-t3w8p1q4.md";

  it("become markers naming the file, whatever the link looks like", () => {
    assert.equal(
      markAttachments("Blank.\n\n![shot](2026-09-21T090000Z-t3w8p1q4/shot.png)", path),
      "Blank.\n\n📎 `shot.png`",
    );
    assert.equal(
      markAttachments("[log](./2026-09-21T090000Z-t3w8p1q4/con%20sole.log)", path),
      "📎 `con sole.log`",
    );
    assert.equal(markAttachments("[x](<2026-09-21T090000Z-t3w8p1q4/a.txt>)", path), "📎 `a.txt`");
  });

  it("leave every other link alone", () => {
    const other = "[docs](https://example.com/a.png) and ![](2026-09-21T090000Z-zzzz9999/b.png)";
    assert.equal(markAttachments(other, path), other);
  });
});

describe("a runner's draft", () => {
  const run = {
    baseSha: "abc",
    notes: "Notes.",
    results: [
      { number: 1, status: "PASSED", actual: null },
      { number: 2, status: null, actual: null },
      { number: 3, status: "FAILED", actual: "Broken." },
    ],
  };

  it("starts from what the server holds, and sends only what changed", () => {
    const saved = draftFromRun(run);
    assert.deepEqual(saved.steps, {
      1: { status: "PASSED", actual: "" },
      3: { status: "FAILED", actual: "Broken." },
    });
    assert.equal(draftDiffers(saved, saved), false);
    const draft = structuredClone(saved);
    draft.steps[2] = { status: "BLOCKED", actual: "  down  " };
    draft.steps[3] = { status: "FAILED", actual: "Broken. " };
    assert.deepEqual(changedSteps(draft, saved), [
      { number: 2, status: "BLOCKED", actual: "down" },
    ]);
    assert.equal(draftDiffers(draft, saved), true);
    const notes = structuredClone(saved);
    notes.notes = "Other.";
    assert.equal(draftDiffers(notes, saved), true);
  });

  it("is kept under one key per run, and a stored one that does not parse is ignored", () => {
    assert.equal(draftKey("t3w8p1q4"), "navbook:tests:draft:t3w8p1q4");
    const kept = parseDraft(
      JSON.stringify({
        baseSha: "abc",
        notes: "",
        steps: {
          2: { status: "BLOCKED", actual: 7 },
          0: { status: "PASSED" },
          3: { status: "OK" },
        },
      }),
    );
    assert.deepEqual(kept, {
      baseSha: "abc",
      notes: "",
      steps: { 2: { status: "BLOCKED", actual: "" } },
    });
    assert.equal(parseDraft(null), null);
    assert.equal(parseDraft("{"), null);
    assert.equal(parseDraft(JSON.stringify({ steps: {} })), null);
  });
});

describe("small things", () => {
  it("takes a file's base64 out of its data address", () => {
    assert.equal(base64Of("data:image/png;base64,iVBOR"), "iVBOR");
    assert.equal(base64Of("iVBOR"), "iVBOR");
  });

  it("knows a picture by its name", () => {
    assert.equal(isImage("shot.PNG"), true);
    assert.equal(isImage("console.log"), false);
  });

  it("gives a pass rate over finished runs only", () => {
    assert.equal(passRate({ runs: 4, passed: 1, inProgress: 2 }), 50);
    assert.equal(passRate({ runs: 2, passed: 0, inProgress: 2 }), null);
    assert.equal(passRate({ runs: 0, passed: 0, inProgress: 0 }), null);
  });
});
