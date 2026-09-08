/**
 * How a merge talks about an unmet review policy — spec 02 §2.10, 04 §4.3.
 *
 * These are the pieces that decide what a merge says and whether it stops to
 * ask, checked here rather than through a repository because the one property
 * that matters is a property of every combination at once: nothing refuses.
 * The terminal path in particular has no other home, since a test harness
 * spawns its child on pipes and can never be the terminal the question needs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewSummary } from "@navbook/core";
import { describeShortfall, type MergeAction, mergeAction } from "../../src/commands/policy.ts";

const summary = (spec: {
  given?: number;
  required?: number;
  blockers?: string[];
}): ReviewSummary => ({
  reviewers: (spec.blockers ?? []).map((person) => ({
    person,
    state: "request-changes" as const,
    volunteer: false,
  })),
  decision: "pending",
  approvals: { given: spec.given ?? 0, required: spec.required ?? 1 },
});

describe("describeShortfall", () => {
  it("is null when the approvals asked for are there", () => {
    assert.equal(describeShortfall(summary({ given: 2, required: 2 })), null);
  });

  it("is null when there are more approvals than asked for", () => {
    assert.equal(describeShortfall(summary({ given: 3, required: 2 })), null);
  });

  it("counts what is missing", () => {
    assert.equal(
      describeShortfall(summary({ given: 1, required: 2 })),
      "1 of 2 required approvals",
    );
  });

  it("says one approval in the singular", () => {
    assert.equal(describeShortfall(summary({ given: 0, required: 1 })), "0 of 1 required approval");
  });

  it("names whoever is blocking instead of counting, since a count would mislead", () => {
    // Two approvals out of two and one block is not "short of approvals"; it
    // is somebody asking for changes, and saying anything else buries that.
    assert.equal(
      describeShortfall(summary({ given: 2, required: 2, blockers: ["alice@example.com"] })),
      "changes requested by alice@example.com",
    );
  });

  it("names every blocker", () => {
    assert.equal(
      describeShortfall(summary({ blockers: ["alice@example.com", "bo@corp.example"] })),
      "changes requested by alice@example.com, bo@corp.example",
    );
  });
});

describe("mergeAction", () => {
  const cases: [
    MergeAction,
    { shortfall: string | null; assumeYes: boolean; interactive: boolean },
  ][] = [
    ["proceed", { shortfall: null, assumeYes: false, interactive: false }],
    ["proceed", { shortfall: null, assumeYes: false, interactive: true }],
    ["proceed", { shortfall: null, assumeYes: true, interactive: false }],
    ["proceed", { shortfall: null, assumeYes: true, interactive: true }],
    ["proceed", { shortfall: "1 of 2", assumeYes: true, interactive: false }],
    ["proceed", { shortfall: "1 of 2", assumeYes: true, interactive: true }],
    ["ask", { shortfall: "1 of 2", assumeYes: false, interactive: true }],
    ["warn-and-proceed", { shortfall: "1 of 2", assumeYes: false, interactive: false }],
  ];

  for (const [expected, situation] of cases) {
    const shortfall = situation.shortfall === null ? "nothing missing" : "short of the policy";
    const yes = situation.assumeYes ? "--yes" : "no --yes";
    const tty = situation.interactive ? "a terminal" : "no terminal";
    it(`${shortfall}, ${yes}, ${tty} → ${expected}`, () => {
      assert.equal(mergeAction(situation), expected);
    });
  }

  it("covers every combination there is, so nothing is decided by omission", () => {
    assert.equal(cases.length, 2 ** 3);
  });

  it("stops for nobody but a person at a terminal", () => {
    // The property the whole design rests on: spec 02 §2.7 forbids refusing an
    // operation on the strength of a review state, and §2.10 keeps a declared
    // policy inside that. `ask` is the only outcome that can end in a merge not
    // happening, and it is reachable only where somebody is there to say no.
    for (const shortfall of [null, "1 of 2"]) {
      for (const assumeYes of [false, true]) {
        const action = mergeAction({ shortfall, assumeYes, interactive: false });
        assert.notEqual(action, "ask", `for ${JSON.stringify({ shortfall, assumeYes })}`);
      }
    }
  });

  it("asks only about a shortfall, never about a pull request that has none", () => {
    assert.equal(mergeAction({ shortfall: null, assumeYes: false, interactive: true }), "proceed");
  });
});
