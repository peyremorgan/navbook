/**
 * Turning the server's review numbers into the sentence a reader needs.
 *
 * The policy (spec 02 §2.10) is advisory everywhere, and nowhere more plainly
 * than here: the API exposes no merge, so there is nothing in this client for
 * a policy to gate. What these decide is only whether a count is worth drawing
 * and how the policy reads in one line.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { approvalLabel, describePolicy, type ReviewPolicy } from "../../app/utils/reviews";

const policy = (over: Partial<ReviewPolicy> = {}): ReviewPolicy => ({
  selfReview: false,
  minApprovals: 1,
  declared: true,
  problems: [],
  ...over,
});

describe("approvalLabel", () => {
  it("counts what stands against what is wanted", () => {
    assert.equal(approvalLabel({ given: 1, required: 2 }), "1 of 2 approvals");
  });

  it("draws nothing where one approval is wanted", () => {
    // "1 of 1" beside a decision is a fact nobody was missing, and drawing it
    // everywhere would make the number that matters harder to spot.
    assert.equal(approvalLabel({ given: 0, required: 1 }), null);
    assert.equal(approvalLabel({ given: 1, required: 1 }), null);
  });

  it("keeps counting once the policy is satisfied", () => {
    // The badge says "Approved" either way; the count says by how much, which
    // is what tells a reader the repository asks for more than one opinion.
    assert.equal(approvalLabel({ given: 2, required: 2 }), "2 of 2 approvals");
    assert.equal(approvalLabel({ given: 3, required: 2 }), "3 of 2 approvals");
  });

  it("draws nothing for a pull request that reported none", () => {
    assert.equal(approvalLabel(null), null);
    assert.equal(approvalLabel(undefined), null);
  });
});

describe("describePolicy", () => {
  it("says what a repository counts by", () => {
    assert.equal(
      describePolicy(policy({ minApprovals: 2 })),
      "Requires 2 approvals · self-review off",
    );
  });

  it("says one approval in the singular", () => {
    assert.equal(describePolicy(policy()), "Requires 1 approval · self-review off");
  });

  it("says when an author may review their own work", () => {
    assert.equal(
      describePolicy(policy({ selfReview: true })),
      "Requires 1 approval · self-review on",
    );
  });

  it("says nothing at all where nothing was declared", () => {
    // A repository that never opted in reads exactly as it did, and a line
    // about a choice nobody made is noise on every pull request in it.
    assert.equal(describePolicy(policy({ declared: false })), null);
    assert.equal(describePolicy(null), null);
    assert.equal(describePolicy(undefined), null);
  });

  it("still describes a declared policy whose keys fell back", () => {
    // `problems` is drawn separately; the line above it says what is being
    // counted by, which is the defaults, and that is the honest answer.
    assert.equal(
      describePolicy(policy({ problems: ["'review.minApprovals' must be a whole number"] })),
      "Requires 1 approval · self-review off",
    );
  });
});
