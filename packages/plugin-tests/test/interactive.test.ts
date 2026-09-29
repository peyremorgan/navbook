/**
 * The walk through a run's steps, driven by scripted answers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Answer, walkSteps } from "../src/cli/interactive.ts";
import type { PlanStep } from "../src/core/steps.ts";

const STEPS: PlanStep[] = [
  { number: 1, title: "One", actions: "Do one.", expected: "One done." },
  { number: 2, title: "Two", actions: "Do two.", expected: null },
];

function walk(answers: (string | null)[], pending = [1, 2], edited = "") {
  const queue = [...answers];
  const recorded: Answer[] = [];
  let output = "";
  const end = walkSteps(
    {
      write: (text) => {
        output += text;
      },
      ask: (question) => {
        output += question;
        return queue.length === 0 ? null : (queue.shift() ?? null);
      },
      edit: () => edited,
    },
    STEPS,
    pending,
    (answer) => void recorded.push(answer),
  );
  return { end, recorded, output, left: queue };
}

describe("walking the steps", () => {
  it("records each answer as it is given, and finishes when told", () => {
    const { end, recorded } = walk(["passed", "B", "  the server was down  ", ""]);
    assert.equal(end, "finished");
    assert.deepEqual(recorded, [
      { number: 1, status: "passed", actual: null },
      { number: 2, status: "blocked", actual: "the server was down" },
    ]);
  });

  it("keeps a status whose actual result never came", () => {
    const { end, recorded } = walk(["f", null]);
    assert.equal(end, "stopped");
    assert.deepEqual(recorded, [{ number: 1, status: "failed", actual: null }]);
  });

  it("asks again after an answer it does not know, and stops on quit", () => {
    const { end, recorded, output } = walk(["yes", "q"]);
    assert.equal(end, "stopped");
    assert.deepEqual(recorded, []);
    assert.match(output, /Answer p, f, b, s or q\./);
  });

  it("takes an actual result from the editor, and leaves the run open on 'n'", () => {
    const { end, recorded } = walk(["s", "e", "p", "n"], [1, 2], "Edited text.\n");
    assert.equal(end, "complete");
    assert.equal(recorded[0]?.actual, "Edited text.");
  });

  it("walks only what is pending, and treats the end of input as leaving it open", () => {
    const { end, recorded, output } = walk(["p"], [2]);
    assert.equal(end, "complete");
    assert.deepEqual(recorded, [{ number: 2, status: "passed", actual: null }]);
    assert.doesNotMatch(output, /Step 1/);
    assert.match(
      output,
      /Step 2 of 2: Two\n {2}Actions:\n {4}Do two\.\n {2}\(a setup step: nothing to check\)/,
    );
  });
});
