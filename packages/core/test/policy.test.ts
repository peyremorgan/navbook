/**
 * The review policy a marker declares — spec 02 §2.10.
 *
 * Two properties are worth more than any individual case here. A repository
 * that declares nothing must read exactly as it did before the key existed,
 * and a marker somebody mistyped must still yield a usable policy: every fault
 * is reported and defaulted, never thrown.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_REVIEW_POLICY,
  describeReviewPolicy,
  parseReviewPolicy,
} from "../src/core/policy.ts";

const marker = (value: unknown): string => JSON.stringify(value, null, 2);

describe("parseReviewPolicy", () => {
  it("declares nothing for a repository with no marker at all", () => {
    const reading = parseReviewPolicy(undefined);
    assert.deepEqual(reading, { policy: DEFAULT_REVIEW_POLICY, declared: false, problems: [] });
  });

  it("declares nothing for the marker `nav init` writes", () => {
    const reading = parseReviewPolicy(marker({ version: 1 }));
    assert.deepEqual(reading, { policy: DEFAULT_REVIEW_POLICY, declared: false, problems: [] });
  });

  it("reads both keys", () => {
    const reading = parseReviewPolicy(
      marker({ version: 1, review: { selfReview: true, minApprovals: 3 } }),
    );
    assert.deepEqual(reading, {
      policy: { selfReview: true, minApprovals: 3 },
      declared: true,
      problems: [],
    });
  });

  it("counts an empty policy as declared, since somebody wrote it down", () => {
    // It asks for the defaults, which is a thing a repository may mean; what it
    // must not do is read as though the key were absent, or a tool would stop
    // saying what it counts by the moment the answer was "the usual".
    const reading = parseReviewPolicy(marker({ version: 1, review: {} }));
    assert.deepEqual(reading, { policy: DEFAULT_REVIEW_POLICY, declared: true, problems: [] });
  });

  it("keeps the keys it can read when another is wrong", () => {
    const reading = parseReviewPolicy(
      marker({ version: 1, review: { selfReview: true, minApprovals: "two" } }),
    );
    assert.deepEqual(reading.policy, { selfReview: true, minApprovals: 1 });
    assert.equal(reading.declared, true);
    assert.deepEqual(reading.problems, [
      "'review.minApprovals' must be a whole number of at least 1",
    ]);
  });

  it("reports every fault, so one fix does not uncover the next", () => {
    const reading = parseReviewPolicy(
      marker({ version: 1, review: { selfReview: "yes", minApprovals: 0 } }),
    );
    assert.deepEqual(reading.policy, DEFAULT_REVIEW_POLICY);
    assert.equal(reading.problems.length, 2);
  });

  it("ignores keys it does not recognize, as §2.10 requires", () => {
    const reading = parseReviewPolicy(
      marker({ version: 1, extra: true, review: { minApprovals: 2, whenever: "friday" } }),
    );
    assert.deepEqual(reading.policy, { selfReview: false, minApprovals: 2 });
    assert.deepEqual(reading.problems, []);
  });

  describe("minApprovals", () => {
    const rejected: [string, unknown][] = [
      ["zero, which would approve with nobody approving", 0],
      ["a negative number", -1],
      ["a fraction", 1.5],
      ["a number written as text", "2"],
      ["null", null],
      ["a list", [2]],
    ];
    for (const [description, value] of rejected) {
      it(`refuses ${description}`, () => {
        const reading = parseReviewPolicy(marker({ review: { minApprovals: value } }));
        assert.equal(reading.policy.minApprovals, 1, "falls back to the default");
        assert.deepEqual(reading.problems, [
          "'review.minApprovals' must be a whole number of at least 1",
        ]);
      });
    }

    it("refuses a number too large for JSON to hold, which parses as infinity", () => {
      // `JSON.stringify` cannot write this, so the case has to be typed out:
      // it is what a generated marker with a runaway number would contain.
      const reading = parseReviewPolicy('{"review": {"minApprovals": 1e999}}');
      assert.equal(reading.policy.minApprovals, 1);
      assert.deepEqual(reading.problems, [
        "'review.minApprovals' must be a whole number of at least 1",
      ]);
    });

    it("accepts one, which is the default said out loud", () => {
      const reading = parseReviewPolicy(marker({ review: { minApprovals: 1 } }));
      assert.deepEqual(reading.policy, { selfReview: false, minApprovals: 1 });
      assert.deepEqual(reading.problems, []);
    });

    it("accepts a number larger than any team", () => {
      assert.equal(
        parseReviewPolicy(marker({ review: { minApprovals: 99 } })).policy.minApprovals,
        99,
      );
    });
  });

  describe("selfReview", () => {
    const rejected: [string, unknown][] = [
      ["the string 'true'", "true"],
      ["the string 'yes'", "yes"],
      ["1, which is not a boolean however it reads", 1],
      ["null", null],
    ];
    for (const [description, value] of rejected) {
      it(`refuses ${description}`, () => {
        const reading = parseReviewPolicy(marker({ review: { selfReview: value } }));
        assert.equal(reading.policy.selfReview, false, "falls back to the default");
        assert.deepEqual(reading.problems, ["'review.selfReview' must be true or false"]);
      });
    }

    it("accepts false, which is the default said out loud", () => {
      const reading = parseReviewPolicy(marker({ review: { selfReview: false } }));
      assert.deepEqual(reading.problems, []);
      assert.equal(reading.declared, true);
    });
  });

  describe("a marker that is not a policy at all", () => {
    it("reports text that is not JSON", () => {
      const reading = parseReviewPolicy("{ version: 1 ");
      assert.deepEqual(reading.policy, DEFAULT_REVIEW_POLICY);
      assert.deepEqual(reading.problems, ["is not valid JSON"]);
      assert.equal(reading.declared, false);
    });

    it("reports an empty file, which is not JSON either", () => {
      assert.deepEqual(parseReviewPolicy("").problems, ["is not valid JSON"]);
    });

    it("reports JSON that is not an object", () => {
      for (const text of ["[]", '"a marker"', "1", "null", "true"]) {
        assert.deepEqual(parseReviewPolicy(text).problems, ["is not a JSON object"], `for ${text}`);
      }
    });

    it("reports a `review` that is not an object", () => {
      for (const value of [2, "strict", ["alice"], null]) {
        const reading = parseReviewPolicy(marker({ review: value }));
        assert.deepEqual(reading.problems, ["'review' must be an object"], `for ${marker(value)}`);
        assert.equal(reading.declared, false, "nothing usable was declared");
        assert.deepEqual(reading.policy, DEFAULT_REVIEW_POLICY);
      }
    });

    it("tolerates a marker whose `version` is wrong, which is not its business", () => {
      // §2.10 says version MUST be 1, and D15 is about the policy; a tool that
      // conflated the two would refuse to count approvals over a typo in a key
      // it does not read.
      const reading = parseReviewPolicy(marker({ version: 7, review: { minApprovals: 2 } }));
      assert.deepEqual(reading.problems, []);
      assert.equal(reading.policy.minApprovals, 2);
    });
  });
});

describe("describeReviewPolicy", () => {
  it("says what it counts by", () => {
    assert.equal(
      describeReviewPolicy({ selfReview: false, minApprovals: 2 }),
      "2 approvals required, self-review off",
    );
  });

  it("says one approval in the singular", () => {
    assert.equal(
      describeReviewPolicy({ selfReview: true, minApprovals: 1 }),
      "1 approval required, self-review on",
    );
  });
});
