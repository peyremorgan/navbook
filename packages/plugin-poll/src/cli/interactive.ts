/**
 * `nav poll vote` at a terminal: each question in turn, then a note, then one
 * confirmation. Nothing is written until the voter says yes, so walking away
 * halfway leaves no half-ballot behind.
 *
 * The terminal is passed in, so the walk can be driven from a pipe exactly as
 * from a person.
 */

import type { Answer, Answers, PollQuestion } from "../core/files.ts";
import { describeAnswer, kindOf, type Paint } from "./render.ts";

export interface WalkIo {
  write(text: string): void;
  /** One line of answer; null at the end of input. */
  ask(question: string): string | null;
  /** `$EDITOR` on some text, returning what was saved. */
  edit(initial: string): string;
}

/** What the voter answered, or null when they walked away. */
export type WalkResult = { answers: Answers; note: string } | null;

/**
 * Read one line of answer to a question: option numbers or IDs, separated by
 * commas or spaces, and `o:` followed by a write-in, last. Returns the answer,
 * or what is wrong with the line.
 */
export function parseAnswerLine(question: PollQuestion, line: string): Answer | { error: string } {
  const at = line.search(/(^|[,\s])o:/i);
  const listed = at === -1 ? line : line.slice(0, at);
  const other = at === -1 ? null : line.slice(line.indexOf(":", at) + 1).trim();
  if (other !== null && !question.other)
    return { error: "this question takes no answer in other words" };
  if (other === "") return { error: "write your answer after 'o:'" };
  const picks: string[] = [];
  for (const word of listed.split(/[\s,]+/).filter(Boolean)) {
    // The options are listed by number here, so a number is a position.
    const option = optionByRef(question, word, "position");
    if (option === undefined) return { error: `'${word}' is not one of the options` };
    if (!picks.includes(option)) picks.push(option);
  }
  const count = picks.length + (other === null ? 0 : 1);
  if (count === 0) return { error: "pick an option" };
  if (!question.multi && count > 1)
    return { error: "this question takes one answer: one option, or one in other words" };
  return { picks, other };
}

/**
 * An option by its ID, or by its number from 1. Which comes first matters
 * only for an option whose ID is a number: a flag names options by ID, as
 * `--json` does, and the walk by the numbers it shows.
 */
export function optionByRef(
  question: PollQuestion,
  ref: string,
  first: "id" | "position" = "id",
): string | undefined {
  const byId = question.options.find((option) => option.id === ref.toLowerCase())?.id;
  const byPosition = /^\d+$/.test(ref) ? question.options[Number(ref) - 1]?.id : undefined;
  return first === "id" ? (byId ?? byPosition) : (byPosition ?? byId);
}

/**
 * Walk the questions, starting from `start` — the voter's last ballot, less
 * whatever no longer fits — and return the ballot they settled on.
 */
export function walkQuestions(
  io: WalkIo,
  questions: readonly PollQuestion[],
  start: { answers: Answers; note: string },
  c: Paint,
): WalkResult {
  const answers: Answers = new Map(start.answers);
  for (const [q, question] of questions.entries()) {
    io.write(
      `\n${c.bold(`${q + 1}/${questions.length}`)} ${question.text}  ${c.dim(`(${kindOf(question)})`)}\n`,
    );
    question.options.forEach((option, o) => {
      io.write(`  ${String(o + 1).padStart(2)}. ${option.label}\n`);
      if (option.description !== null) {
        for (const line of option.description.split("\n"))
          io.write(line === "" ? "\n" : `      ${c.dim(line)}\n`);
      }
    });
    if (question.other) io.write(`   ${c.dim("o:<text> answers in your own words")}\n`);
    const current = answers.get(question.id);
    const hint =
      current === undefined
        ? "Enter skips"
        : `Enter keeps ${describeAnswer(question, current)}, '-' skips`;
    for (;;) {
      const line = io.ask(`${question.multi ? "Answers" : "Answer"} (${hint}): `);
      if (line === null) return null;
      const text = line.trim();
      if (text === "") break;
      if (text === "-") {
        answers.delete(question.id);
        break;
      }
      const answer = parseAnswerLine(question, text);
      if ("error" in answer) {
        io.write(`nav: ${answer.error}\n`);
        continue;
      }
      answers.set(question.id, answer);
      break;
    }
  }

  let note = start.note;
  const noteHint =
    note === ""
      ? "optional; 'e' opens $EDITOR"
      : `Enter keeps ${JSON.stringify(firstLine(note))}, '-' removes it, 'e' opens $EDITOR`;
  const line = io.ask(`\nWhy? A note for the other voters (${noteHint}): `);
  if (line === null) return null;
  const text = line.trim();
  if (text === "-") note = "";
  else if (text === "e") note = io.edit(note);
  else if (text !== "") note = text;
  return { answers, note };
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 40 || text.includes("\n") ? `${line.slice(0, 40)}…` : line;
}
