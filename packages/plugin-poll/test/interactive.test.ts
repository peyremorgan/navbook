/**
 * What a voter types at the walk's prompt, read — `nav poll vote` at a
 * terminal. The walk itself is driven end to end in `cli-vote.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optionByRef, parseAnswerLine } from "../src/cli/interactive.ts";
import type { PollQuestion } from "../src/core/files.ts";

const single: PollQuestion = {
  id: "backend",
  text: "Which?",
  multi: false,
  other: true,
  options: [
    { id: "s3", label: "S3", description: null },
    { id: "disk", label: "Disk", description: null },
  ],
};
const multi: PollQuestion = { ...single, id: "limits", multi: true, other: false };
/** Options whose IDs are numbers, and not their positions. */
const numbered: PollQuestion = {
  ...single,
  options: ["0", "1", "2"].map((id) => ({ id, label: `Option ${id}`, description: null })),
};

describe("an answer line", () => {
  it("takes numbers, IDs, and a write-in last", () => {
    assert.deepEqual(parseAnswerLine(single, "2"), { picks: ["disk"], other: null });
    assert.deepEqual(parseAnswerLine(single, "S3"), { picks: ["s3"], other: null });
    assert.deepEqual(parseAnswerLine(single, "o: MinIO, really"), {
      picks: [],
      other: "MinIO, really",
    });
    assert.deepEqual(parseAnswerLine(multi, "1, disk 1"), { picks: ["s3", "disk"], other: null });
  });

  it("says what is wrong", () => {
    assert.deepEqual(parseAnswerLine(single, "1,2"), {
      error: "this question takes one answer: one option, or one in other words",
    });
    assert.deepEqual(parseAnswerLine(single, "1 o:x"), {
      error: "this question takes one answer: one option, or one in other words",
    });
    assert.deepEqual(parseAnswerLine(multi, "o:x"), {
      error: "this question takes no answer in other words",
    });
    assert.deepEqual(parseAnswerLine(single, "o:  "), { error: "write your answer after 'o:'" });
    assert.deepEqual(parseAnswerLine(single, "3"), { error: "'3' is not one of the options" });
  });

  it("reads a number as the position the walk shows, even where an option's ID is a number", () => {
    assert.deepEqual(parseAnswerLine(numbered, "1"), { picks: ["0"], other: null });
    assert.equal(optionByRef(numbered, "1"), "1", "a flag names options by ID first");
    assert.equal(optionByRef(numbered, "1", "position"), "0");
    assert.equal(optionByRef(numbered, "4"), undefined);
  });
});
