/**
 * How polls read in a terminal: the same labels, dim headings and padding
 * every built-in `show` uses, so a plugin's output does not look bolted on.
 */

import type { QuestionTally, VoterState } from "../core/ballot.ts";
import { type Answer, type Answers, type PollQuestion, runningCore } from "../core/files.ts";
import type { PollRecord } from "../core/tree.ts";

/** The colours a `Ctx` carries; only these are used. */
export interface Paint {
  bold(text: string): string;
  dim(text: string): string;
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
}

/** A label column, as `nav issue show` lays its fields out. */
export function label(text: string, c: Paint): string {
  return c.dim(`${text}:`.padEnd(13));
}

/** The person part of `Name <address>`, for a column that has little room. */
export function personName(person: string): string {
  return runningCore().parsePerson(person)?.name ?? person;
}

/** A poll's status, coloured: open is what is waiting on somebody. */
export function paintStatus(poll: PollRecord, c: Paint): string {
  return poll.status === "open" ? c.green("open") : c.dim("closed");
}

/** Where somebody stands, as a listing's column says it. */
export function stateWord(state: VoterState): string {
  switch (state) {
    case "counted":
      return "voted";
    case "withdrawn":
      return "withdrew";
    case "revoked":
      return "revoked";
    default:
      return "not voted";
  }
}

/** Where somebody stands, as a sentence about them. */
export function stateSentence(state: VoterState, c: Paint): string {
  switch (state) {
    case "counted":
      return "you voted";
    case "withdrawn":
      return "you withdrew your vote";
    case "revoked":
      return c.yellow("the questions changed since you voted; vote again");
    default:
      return "you have not voted";
  }
}

/** What kind of answer a question takes, briefly. */
export function kindOf(question: PollQuestion): string {
  const kind = question.multi ? "any number of answers" : "one answer";
  return question.other ? `${kind}, or in other words` : kind;
}

/** An answer in words: the options' labels, and the write-in quoted. */
export function describeAnswer(question: PollQuestion | undefined, answer: Answer): string {
  const labels = answer.picks.map(
    (pick) => question?.options.find((option) => option.id === pick)?.label ?? pick,
  );
  if (answer.other !== null) labels.push(JSON.stringify(answer.other));
  return labels.join(", ");
}

/** A block of Markdown indented under a heading, one element per line. */
function indented(text: string, by: string): string[] {
  return text.split("\n").map((line) => (line === "" ? "" : `${by}${line}`));
}

export interface RenderOptions {
  /** Show the counts beside the options. */
  results: boolean;
  /** The answers of the person looking, marked beside the options. */
  mine?: Answers;
}

/**
 * A poll's questions, numbered, with their options — and, when the results are
 * shown, the counts, who picked what, the write-ins, and who leads.
 */
export function renderQuestions(poll: PollRecord, c: Paint, opts: RenderOptions): string[] {
  const lines: string[] = [];
  poll.questions.forEach((question, q) => {
    const entry: QuestionTally | undefined = poll.tallies.find((t) => t.question === question.id);
    const mine = opts.mine?.get(question.id);
    if (q > 0) lines.push("");
    lines.push(`${c.bold(`${q + 1}.`)} ${question.text}  ${c.dim(`(${kindOf(question)})`)}`);
    const idWidth = Math.max(...question.options.map((option) => option.id.length));
    const labelWidth = Math.max(...question.options.map((option) => option.label.length));
    for (const option of question.options) {
      const mark = mine?.picks.includes(option.id) ? c.bold("*") : " ";
      let line = ` ${mark} ${c.dim(option.id.padEnd(idWidth))}  ${option.label}`;
      if (opts.results) {
        const count = entry?.options.find((o) => o.option === option.id);
        const voters = count?.voters.map(personName).join(", ") ?? "";
        line = `${line.padEnd(line.length + labelWidth - option.label.length)}  ${String(count?.count ?? 0).padStart(3)}${voters === "" ? "" : `  ${c.dim(voters)}`}`;
      }
      lines.push(line);
      if (option.description !== null)
        lines.push(...indented(option.description, `   ${" ".repeat(idWidth)}  `).map(c.dim));
    }
    if (mine?.other !== null && mine?.other !== undefined)
      lines.push(` ${c.bold("*")} ${c.dim("in your words:")} ${JSON.stringify(mine.other)}`);
    if (!opts.results || entry === undefined) return;
    for (const other of entry.others) {
      lines.push(
        `   ${c.dim("in other words:")} ${JSON.stringify(other.text)}  ${c.dim(personName(other.voter))}`,
      );
    }
    if (entry.tied) lines.push(`   ${c.yellow(`tied: ${entry.leaders.join(", ")}`)}`);
    else if (entry.leaders.length > 0)
      lines.push(`   ${c.dim(`leading: ${entry.leaders.join(", ")}`)}`);
  });
  return lines;
}

/** What a closed poll came to, question by question. */
export function renderOutcome(poll: PollRecord, outcome: Answers, c: Paint): string[] {
  return poll.questions.map((question, q) => {
    const answer = outcome.get(question.id);
    return `  ${q + 1}. ${question.text}  ${c.dim("→")} ${answer === undefined ? c.dim("undecided") : c.bold(describeAnswer(question, answer))}`;
  });
}

/** One poll as a listing row: ID, issue, status, voters, where you stand, title. */
export function pollRow(poll: PollRecord, state: VoterState | null): string[] {
  return [
    poll.id,
    `#${poll.issue.id}`,
    poll.status,
    String(poll.voters),
    state === null ? "-" : stateWord(state),
    poll.title,
  ];
}

/** The listing's columns, matching {@link pollRow}. */
export const POLL_COLUMNS = [
  { header: "id" },
  { header: "issue" },
  { header: "status" },
  { header: "voters" },
  { header: "you" },
  { header: "title", flexible: true, minWidth: 20 },
] as const;
