/**
 * The Markdown grammar plans and runs share — `doc/spec.md` §3.1 and §4.1.
 *
 * Both files are a preamble followed by one `###` block per step, each block
 * made of `####` sections. Only the section names differ (`Actions` and
 * `Expected` in a plan, `Status` and `Actual` in a run), so the scanner here
 * knows nothing about either: it splits a body into blocks and sections, and
 * `planSteps` and `runRecords` say what a plan's and a run's blocks mean.
 *
 * Pure, and free of `@navbook/core`: nothing here needs the running core, and
 * a grammar a second implementation must reproduce is easiest to reproduce
 * when it stands on its own.
 */

/** A fault in a body's structure, worded for somebody reading the file. */
export interface Fault {
  message: string;
}

/** One `####` section of a block, with its text trimmed of surrounding blank lines. */
export interface Section {
  name: string;
  text: string;
}

/** One `###` block: the heading's text, anything before its first section, and the sections. */
export interface Block {
  heading: string;
  /** Text between the heading and its first section; a plan or run has none. */
  lead: string;
  sections: Section[];
}

/** A body split into its preamble and blocks. */
export interface Sectioned {
  preamble: string;
  blocks: Block[];
  faults: Fault[];
}

/** An ATX heading: up to three spaces, one to six `#`, then a space or the end of the line. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** The opening of a fenced code block: three or more backticks or tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** A closing sequence of `#`, which an ATX heading may end with. */
const CLOSING_HASHES = /(?:^|[ \t]+)#+$/;

/** A body line as the grammar sees it: a heading, or text (fences included). */
type Line =
  | { kind: "text"; line: string }
  | { kind: "heading"; line: string; level: number; text: string };

/**
 * Classify a body's lines, keeping track of fenced code blocks.
 *
 * A line inside a fenced code block is never a heading, so a step may quote
 * Markdown — or a shell prompt's `#` — without starting a new one. An
 * unclosed fence runs to the end of the body, as CommonMark says; `unclosed`
 * reports it, because the steps it swallowed are almost never what the author
 * meant.
 */
function scan(body: string): { lines: Line[]; unclosed: boolean } {
  const lines: Line[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence !== null) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close?.[1]?.[0] === fence.char && (close[1]?.length ?? 0) >= fence.length) fence = null;
      lines.push({ kind: "text", line });
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open?.[1] !== undefined) {
      fence = { char: open[1][0] as string, length: open[1].length };
      lines.push({ kind: "text", line });
      continue;
    }
    const heading = line.match(HEADING);
    const level = heading?.[1]?.length ?? 0;
    if (level === 0 || level >= 5) {
      lines.push({ kind: "text", line });
      continue;
    }
    const text = (heading?.[2] ?? "").replace(CLOSING_HASHES, "").trim();
    lines.push({ kind: "heading", line, level, text });
  }
  return { lines, unclosed: fence !== null };
}

/** Split a body into its preamble and `###` blocks. */
export function parseSections(body: string): Sectioned {
  const faults: Fault[] = [];
  const preamble: string[] = [];
  type Draft = { heading: string; lead: string[]; sections: { name: string; lines: string[] }[] };
  const drafts: Draft[] = [];
  let block: Draft | null = null;

  const append = (line: string): void => {
    if (block === null) preamble.push(line);
    else {
      const section = block.sections[block.sections.length - 1];
      if (section === undefined) block.lead.push(line);
      else section.lines.push(line);
    }
  };

  const scanned = scan(body);
  for (const entry of scanned.lines) {
    if (entry.kind === "text") {
      append(entry.line);
      continue;
    }
    if (entry.level === 3) {
      block = { heading: entry.text, lead: [], sections: [] };
      drafts.push(block);
      continue;
    }
    if (entry.level === 4) {
      if (block === null) {
        faults.push({ message: `a '#### ${entry.text}' heading before the first step` });
        preamble.push(entry.line);
      } else {
        block.sections.push({ name: entry.text, lines: [] });
      }
      continue;
    }
    // Levels 1 and 2: the preamble's own structure, and nothing a step may hold.
    if (block !== null) {
      faults.push({
        message: `a level-${entry.level} heading '${entry.text}' after the first step`,
      });
    }
    append(entry.line);
  }
  if (scanned.unclosed) faults.push({ message: "a code fence that is never closed" });

  return {
    preamble: trimBlankLines(preamble),
    blocks: drafts.map((draft) => ({
      heading: draft.heading,
      lead: trimBlankLines(draft.lead),
      sections: draft.sections.map((section) => ({
        name: section.name,
        text: trimBlankLines(section.lines),
      })),
    })),
    faults,
  };
}

/** Lines joined back, without the blank lines around them or trailing whitespace. */
function trimBlankLines(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] as string).trim() === "") start++;
  while (end > start && (lines[end - 1] as string).trim() === "") end--;
  return lines
    .slice(start, end)
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** The section of this name, compared as the grammar compares names. */
function sectionsNamed(block: Block, name: string): Section[] {
  const wanted = name.toLowerCase();
  return block.sections.filter((section) => section.name.toLowerCase() === wanted);
}

/* -------------------------------------------------------------------- plans */

/** One step of a plan, numbered by position from 1. */
export interface PlanStep {
  number: number;
  title: string;
  actions: string;
  /** What should be observed; null for a setup step, which checks nothing. */
  expected: string | null;
}

/** A number the author wrote at the start of a step's title, which does not count. */
const WRITTEN_NUMBER = /^\d+[.)](?:[ \t]+|$)/;

/** A plan's body as its description and steps (`doc/spec.md` §3.1). */
export function planSteps(body: string): {
  description: string;
  steps: PlanStep[];
  faults: Fault[];
} {
  const { preamble, blocks, faults } = parseSections(body);
  const steps: PlanStep[] = [];
  for (const [index, block] of blocks.entries()) {
    const number = index + 1;
    const title = block.heading.replace(WRITTEN_NUMBER, "").trim();
    const where = `step ${number}${title === "" ? "" : ` '${title}'`}`;
    if (title === "") faults.push({ message: `${where} has no title` });
    if (block.lead !== "") {
      faults.push({ message: `${where} has text before its '#### Actions' section` });
    }
    for (const section of block.sections) {
      const name = section.name.toLowerCase();
      if (name !== "actions" && name !== "expected") {
        faults.push({
          message: `${where} has a '#### ${section.name}' section; a step holds Actions and Expected`,
        });
      }
    }
    const actions = sectionsNamed(block, "actions");
    const expected = sectionsNamed(block, "expected");
    if (actions.length === 0) faults.push({ message: `${where} has no '#### Actions' section` });
    if (actions.length > 1) faults.push({ message: `${where} has more than one '#### Actions'` });
    if (expected.length > 1) faults.push({ message: `${where} has more than one '#### Expected'` });
    steps.push({
      number,
      title,
      actions: actions[0]?.text ?? "",
      expected: expected[0] === undefined ? null : expected[0].text,
    });
  }
  return { description: preamble, steps, faults };
}

/** A plan's body from its parts: the canonical text a tool writes. */
export function renderPlanBody(
  description: string,
  steps: readonly { title: string; actions: string; expected?: string | null }[],
): string {
  const parts: string[] = [];
  if (description.trim() !== "") parts.push(description.trim());
  for (const step of steps) {
    parts.push(`### ${step.title.trim()}`, "#### Actions", step.actions.trim());
    if (step.expected !== null && step.expected !== undefined && step.expected.trim() !== "") {
      parts.push("#### Expected", step.expected.trim());
    }
  }
  return parts.length === 0 ? "" : `\n${parts.join("\n\n")}\n`;
}

/* --------------------------------------------------------------------- runs */

export const STATUSES = ["passed", "failed", "blocked", "skipped"] as const;
export type StepStatus = (typeof STATUSES)[number];

/** True when the word is a step status (`doc/spec.md` §4.1). */
export function isStatus(word: string): word is StepStatus {
  return (STATUSES as readonly string[]).includes(word);
}

/** What a run recorded for one step of its plan. */
export interface StepRecord {
  /** The step's number in the plan. */
  number: number;
  /** Display only: the plan's title for the step when the run recorded it. */
  title: string;
  status: StepStatus;
  /** What the tester observed; null when they wrote nothing. */
  actual: string | null;
}

/** A run heading: the step's number, a `.` or `)`, and the title after it. */
const RUN_HEADING = /^(\d+)[.)](?:[ \t]+(.*))?$/;

/** A run's body as its notes and recorded steps (`doc/spec.md` §4.1). */
export function runRecords(body: string): {
  notes: string;
  records: StepRecord[];
  faults: Fault[];
} {
  const { preamble, blocks, faults } = parseSections(body);
  const records: StepRecord[] = [];
  const seen = new Set<number>();
  for (const block of blocks) {
    const match = block.heading.match(RUN_HEADING);
    const number = match === null ? 0 : Number(match[1]);
    if (match === null) {
      faults.push({
        message: `'### ${block.heading}' does not start with the number of a plan step, like '### 2. ${block.heading}'`,
      });
      continue;
    }
    if (number < 1) {
      faults.push({ message: `'### ${block.heading}': steps are numbered from 1` });
      continue;
    }
    const where = `step ${number}`;
    if (seen.has(number)) {
      faults.push({ message: `${where} is recorded more than once` });
      continue;
    }
    seen.add(number);
    if (block.lead !== "") faults.push({ message: `${where} has text before its '#### Status'` });
    for (const section of block.sections) {
      const name = section.name.toLowerCase();
      if (name !== "status" && name !== "actual") {
        faults.push({
          message: `${where} has a '#### ${section.name}' section; a recorded step holds Status and Actual`,
        });
      }
    }
    const statuses = sectionsNamed(block, "status");
    const actuals = sectionsNamed(block, "actual");
    if (actuals.length > 1) faults.push({ message: `${where} has more than one '#### Actual'` });
    if (statuses.length !== 1) {
      faults.push({
        message:
          statuses.length === 0
            ? `${where} has no '#### Status' section`
            : `${where} has more than one '#### Status'`,
      });
      continue;
    }
    const word = (statuses[0]?.text ?? "").trim().toLowerCase();
    if (!isStatus(word)) {
      faults.push({
        message: `${where}: '${(statuses[0]?.text ?? "").trim()}' is not a status; expected one of ${STATUSES.join(", ")}`,
      });
      continue;
    }
    const actual = actuals[0]?.text ?? "";
    records.push({
      number,
      title: (match[2] ?? "").trim(),
      status: word,
      actual: actual === "" ? null : actual,
    });
  }
  records.sort((a, b) => a.number - b.number);
  return { notes: preamble, records, faults };
}

/** A run's body from its parts, steps in plan order: the canonical text a tool writes. */
export function renderRunBody(notes: string, records: readonly StepRecord[]): string {
  const parts: string[] = [];
  if (notes.trim() !== "") parts.push(notes.trim());
  for (const record of [...records].sort((a, b) => a.number - b.number)) {
    const title = record.title.trim();
    parts.push(`### ${record.number}.${title === "" ? "" : ` ${title}`}`);
    parts.push("#### Status", record.status);
    if (record.actual !== null && record.actual.trim() !== "") {
      parts.push("#### Actual", record.actual.trim());
    }
  }
  return parts.length === 0 ? "" : `\n${parts.join("\n\n")}\n`;
}

/* -------------------------------------------------------- text from a person */

/**
 * Faults in text somebody typed into one part of a plan or run — a step's
 * actions, an actual result, the description — that would change the file's
 * structure once written: a heading the grammar would read as a new step or
 * section, or a fence that swallows the rest of the body.
 *
 * `deepestAllowed` is the deepest heading level the part may contain and still
 * be read back as itself: a description may use levels 1 and 2 (0 allows
 * none), a section none of levels 1 to 4. Deeper headings are text anywhere.
 */
export function textFaults(text: string, what: string, deepestAllowed: 0 | 2): Fault[] {
  const scanned = scan(text);
  const out: Fault[] = [];
  if (scanned.unclosed) out.push({ message: `${what} opens a code fence it never closes` });
  const levels = scanned.lines.flatMap((line) => (line.kind === "heading" ? [line.level] : []));
  if (levels.some((level) => level > deepestAllowed)) {
    out.push({
      message:
        deepestAllowed === 0
          ? `${what} contains a heading of level 1 to 4, which would change the file's structure`
          : `${what} contains a level-3 or level-4 heading, which would start a step or a section`,
    });
  }
  return out;
}
