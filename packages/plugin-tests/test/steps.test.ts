/**
 * The Markdown grammar plans and runs share — `doc/spec.md` §3.1 and §4.1.
 *
 * Hand-written files are the reason this grammar is strict about structure and
 * lenient about spelling: a tester typing `#### actual` or `### 2) Sign in`
 * wrote what they meant, while a stray `##` or a missing `#### Actions` is a
 * file a tool would otherwise read as something else.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSections,
  planSteps,
  renderPlanBody,
  renderRunBody,
  runRecords,
  type StepRecord,
  textFaults,
} from "../src/core/steps.ts";

const lines = (...text: string[]): string => `${text.join("\n")}\n`;

const PLAN = lines(
  "",
  "Sign in from a clean profile.",
  "",
  "## Setup",
  "",
  "A staging account.",
  "",
  "### Open the login page",
  "",
  "#### Actions",
  "",
  "Browse to `/login`.",
  "",
  "#### Expected",
  "",
  "The form shows.",
  "",
  "### 2. Sign in",
  "",
  "#### actions ##",
  "",
  "```sh",
  "### not a step",
  "# not a heading",
  "```",
  "",
  "##### A note, which is text",
  "",
  "#### EXPECTED",
  "",
  "The dashboard opens.",
  "",
  "### 3) Log out",
  "",
  "#### Actions",
  "",
  "Press **Log out**.",
);

describe("a plan's body", () => {
  it("reads the description and the steps, numbered by position", () => {
    const { description, steps, faults } = planSteps(PLAN);
    assert.deepEqual(faults, []);
    assert.equal(description, "Sign in from a clean profile.\n\n## Setup\n\nA staging account.");
    assert.deepEqual(
      steps.map((step) => [step.number, step.title]),
      [
        [1, "Open the login page"],
        [2, "Sign in"],
        [3, "Log out"],
      ],
    );
    assert.equal(steps[0]?.expected, "The form shows.");
    // A fence keeps its headings, and a level-5 heading is text.
    assert.equal(
      steps[1]?.actions,
      "```sh\n### not a step\n# not a heading\n```\n\n##### A note, which is text",
    );
    assert.equal(steps[1]?.expected, "The dashboard opens.");
    // No Expected: a setup step.
    assert.equal(steps[2]?.expected, null);
  });

  it("reads a body with Windows line endings the same way", () => {
    assert.deepEqual(planSteps(PLAN.replaceAll("\n", "\r\n")), planSteps(PLAN));
  });

  it("allows a plan with no steps yet", () => {
    assert.deepEqual(planSteps("\nJust a description.\n"), {
      description: "Just a description.",
      steps: [],
      faults: [],
    });
    assert.deepEqual(planSteps(""), { description: "", steps: [], faults: [] });
  });

  const faultsOf = (body: string): string[] => planSteps(body).faults.map((fault) => fault.message);

  it("reports a step without Actions, and sections given twice", () => {
    assert.deepEqual(faultsOf(lines("### A", "#### Expected", "x")), [
      "step 1 'A' has no '#### Actions' section",
    ]);
    assert.deepEqual(faultsOf(lines("### A", "#### Actions", "x", "#### Actions", "y")), [
      "step 1 'A' has more than one '#### Actions'",
    ]);
    assert.deepEqual(
      faultsOf(lines("### A", "#### Actions", "x", "#### Expected", "y", "#### Expected", "z")),
      ["step 1 'A' has more than one '#### Expected'"],
    );
  });

  it("reports a section a plan does not have, text before Actions, and an empty title", () => {
    assert.deepEqual(faultsOf(lines("### A", "#### Actions", "x", "#### Notes", "y")), [
      "step 1 'A' has a '#### Notes' section; a step holds Actions and Expected",
    ]);
    assert.deepEqual(faultsOf(lines("### A", "stray", "#### Actions", "x")), [
      "step 1 'A' has text before its '#### Actions' section",
    ]);
    assert.deepEqual(faultsOf(lines("###", "#### Actions", "x")), ["step 1 has no title"]);
    assert.deepEqual(faultsOf(lines("### 4.", "#### Actions", "x")), ["step 1 has no title"]);
  });

  it("reports structure in the wrong place", () => {
    assert.deepEqual(faultsOf(lines("#### Actions", "x", "### A", "#### Actions", "y")), [
      "a '#### Actions' heading before the first step",
    ]);
    assert.deepEqual(faultsOf(lines("### A", "#### Actions", "x", "## Later", "y")), [
      "a level-2 heading 'Later' after the first step",
    ]);
    assert.deepEqual(faultsOf(lines("### A", "#### Actions", "```", "never closed")), [
      "a code fence that is never closed",
    ]);
  });

  it("closes a fence only with the same character, at least as long", () => {
    const { steps, faults } = planSteps(
      lines(
        "### A",
        "#### Actions",
        "````",
        "```",
        "~~~",
        "### inside",
        "````",
        "### B",
        "#### Actions",
        "y",
      ),
    );
    assert.deepEqual(faults, []);
    assert.deepEqual(
      steps.map((step) => step.title),
      ["A", "B"],
    );
  });

  it("does not take a hash without a space for a heading", () => {
    const { steps } = planSteps(lines("### A", "#### Actions", "#hashtag", "###not-a-step"));
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.actions, "#hashtag\n###not-a-step");
  });

  it("renders the canonical text, which reads back as what it was made from", () => {
    const parts = {
      description: "Needs an account.",
      steps: [
        { title: "Open", actions: "Go to `/login`.", expected: "A form." },
        { title: "Wait", actions: "Wait a second.", expected: null },
      ],
    };
    const body = renderPlanBody(parts.description, parts.steps);
    assert.equal(
      body,
      lines(
        "",
        "Needs an account.",
        "",
        "### Open",
        "",
        "#### Actions",
        "",
        "Go to `/login`.",
        "",
        "#### Expected",
        "",
        "A form.",
        "",
        "### Wait",
        "",
        "#### Actions",
        "",
        "Wait a second.",
      ),
    );
    const read = planSteps(body);
    assert.deepEqual(read.faults, []);
    assert.equal(read.description, parts.description);
    assert.deepEqual(
      read.steps.map(({ title, actions, expected }) => ({ title, actions, expected })),
      parts.steps,
    );
    // Rendering what was read is stable, hand-written oddities and all.
    const reRender = (body: string): string => {
      const read = planSteps(body);
      return renderPlanBody(read.description, read.steps);
    };
    assert.equal(reRender(reRender(PLAN)), reRender(PLAN));
    assert.equal(renderPlanBody("", []), "");
    assert.equal(
      renderPlanBody("  ", [{ title: "A", actions: "x", expected: "  " }]).includes("Expected"),
      false,
    );
  });
});

describe("a run's body", () => {
  const RUN = lines(
    "",
    "Ran on staging.",
    "",
    "### 1. Open the login page",
    "",
    "#### Status",
    "",
    "passed",
    "",
    "### 3) Log out",
    "",
    "#### status",
    "",
    "  Skipped  ",
    "",
    "### 2.",
    "",
    "#### Status",
    "",
    "failed",
    "",
    "#### Actual",
    "",
    "A blank page.",
    "",
    "![shot](run/shot.png)",
  );

  it("reads the notes and the steps it records, in plan order", () => {
    const { notes, records, faults } = runRecords(RUN);
    assert.deepEqual(faults, []);
    assert.equal(notes, "Ran on staging.");
    assert.deepEqual(records, [
      { number: 1, title: "Open the login page", status: "passed", actual: null },
      { number: 2, title: "", status: "failed", actual: "A blank page.\n\n![shot](run/shot.png)" },
      { number: 3, title: "Log out", status: "skipped", actual: null },
    ]);
  });

  const faultsOf = (body: string): string[] =>
    runRecords(body).faults.map((fault) => fault.message);

  it("reports a heading without a step number, and a step recorded twice", () => {
    assert.deepEqual(faultsOf(lines("### Open", "#### Status", "passed")), [
      "'### Open' does not start with the number of a plan step, like '### 2. Open'",
    ]);
    assert.deepEqual(faultsOf(lines("### 0. Open", "#### Status", "passed")), [
      "'### 0. Open': steps are numbered from 1",
    ]);
    assert.deepEqual(
      faultsOf(lines("### 1. A", "#### Status", "passed", "### 1. A", "#### Status", "failed")),
      ["step 1 is recorded more than once"],
    );
  });

  it("reports a missing, doubled or unknown status", () => {
    assert.deepEqual(faultsOf(lines("### 1. A", "#### Actual", "x")), [
      "step 1 has no '#### Status' section",
    ]);
    assert.deepEqual(
      faultsOf(lines("### 1. A", "#### Status", "passed", "#### Status", "failed")),
      ["step 1 has more than one '#### Status'"],
    );
    assert.deepEqual(faultsOf(lines("### 1. A", "#### Status", "ok")), [
      "step 1: 'ok' is not a status; expected one of passed, failed, blocked, skipped",
    ]);
    assert.deepEqual(faultsOf(lines("### 1. A", "#### Status", "passed and more")), [
      "step 1: 'passed and more' is not a status; expected one of passed, failed, blocked, skipped",
    ]);
  });

  it("reports a section a run does not have, and text before the status", () => {
    assert.deepEqual(faultsOf(lines("### 1. A", "#### Status", "passed", "#### Expected", "x")), [
      "step 1 has a '#### Expected' section; a recorded step holds Status and Actual",
    ]);
    assert.deepEqual(faultsOf(lines("### 1. A", "stray", "#### Status", "passed")), [
      "step 1 has text before its '#### Status'",
    ]);
  });

  it("renders the canonical text, steps in order, which reads back unchanged", () => {
    const records: StepRecord[] = [
      { number: 2, title: "Sign in", status: "failed", actual: "Nothing." },
      { number: 1, title: "", status: "passed", actual: null },
    ];
    const body = renderRunBody("Notes.", records);
    assert.equal(
      body,
      lines(
        "",
        "Notes.",
        "",
        "### 1.",
        "",
        "#### Status",
        "",
        "passed",
        "",
        "### 2. Sign in",
        "",
        "#### Status",
        "",
        "failed",
        "",
        "#### Actual",
        "",
        "Nothing.",
      ),
    );
    const read = runRecords(body);
    assert.deepEqual(read.faults, []);
    assert.deepEqual(
      read.records,
      [...records].sort((a, b) => a.number - b.number),
    );
    assert.equal(renderRunBody("", []), "");
  });
});

describe("text somebody typed into one part of a file", () => {
  it("may not carry a heading that would start a step or a section", () => {
    assert.deepEqual(textFaults("plain\n\n##### deep is fine", "the actions", 0), []);
    assert.deepEqual(textFaults("```\n### quoted\n```", "the actions", 0), []);
    assert.deepEqual(
      textFaults("### Sneaky", "the actions", 0).map((fault) => fault.message),
      ["the actions contains a heading of level 1 to 4, which would change the file's structure"],
    );
    assert.deepEqual(
      textFaults("# Title", "the actual result", 0).map((fault) => fault.message),
      [
        "the actual result contains a heading of level 1 to 4, which would change the file's structure",
      ],
    );
  });

  it("lets a description use level-1 and level-2 headings, and nothing deeper", () => {
    assert.deepEqual(textFaults("# Scope\n\n## Setup", "the description", 2), []);
    assert.deepEqual(
      textFaults("#### Actions", "the description", 2).map((fault) => fault.message),
      [
        "the description contains a level-3 or level-4 heading, which would start a step or a section",
      ],
    );
  });

  it("may not open a fence it never closes", () => {
    assert.deepEqual(
      textFaults("```\nno end", "the notes", 2).map((fault) => fault.message),
      ["the notes opens a code fence it never closes"],
    );
  });
});

describe("the sections underneath", () => {
  it("keeps a preamble's own heading as text, and trims blank lines around each part", () => {
    const { preamble, blocks } = parseSections(
      lines("# Title", "", "", "### A  ###", "#### X", "", "  body  ", ""),
    );
    assert.equal(preamble, "# Title");
    assert.deepEqual(blocks, [
      { heading: "A", lead: "", sections: [{ name: "X", text: "  body" }] },
    ]);
  });
});
