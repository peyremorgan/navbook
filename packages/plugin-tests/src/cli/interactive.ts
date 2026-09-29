/**
 * Walking a tester through a run's steps, one question at a time.
 *
 * Written against a three-method console rather than a terminal, so the whole
 * conversation can be driven from a test: the CLI wires it to `ui.ask`, which
 * reads the same stdin every built-in question does, and a pipe answers it.
 */

import type { PlanStep, StepStatus } from "../core/steps.ts";

/** What the walk needs from a terminal. */
export interface Console {
  write(text: string): void;
  /** One line of answer; null at the end of input. */
  ask(question: string): string | null;
  /** Text from `$EDITOR`. */
  edit(initial: string): string;
}

/** A step's result, as the tester gave it. */
export interface Answer {
  number: number;
  status: StepStatus;
  actual: string | null;
}

/** How the walk ended. */
export type WalkEnd =
  /** Every step was answered, and the tester said they are done. */
  | "finished"
  /** Every step was answered; the tester asked to leave the run open. */
  | "complete"
  /** The tester quit, or the answers ran out, before the last step. */
  | "stopped";

const CHOICES: Record<string, StepStatus | "quit"> = {
  p: "passed",
  passed: "passed",
  f: "failed",
  failed: "failed",
  b: "blocked",
  blocked: "blocked",
  s: "skipped",
  skipped: "skipped",
  q: "quit",
  quit: "quit",
};

/** Indent every line of a block of text. */
export function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${by}${line}`))
    .join("\n");
}

/**
 * Ask about each step in `pending`, recording each answer as it is given —
 * so a tester who closes the terminal halfway has lost nothing they answered.
 */
export function walkSteps(
  io: Console,
  steps: readonly PlanStep[],
  pending: readonly number[],
  record: (answer: Answer) => void,
): WalkEnd {
  const total = steps.length;
  for (const number of pending) {
    const step = steps[number - 1];
    if (step === undefined) continue;
    io.write(`\nStep ${number} of ${total}: ${step.title}\n`);
    io.write(`  Actions:\n${indent(step.actions || "(none)", "    ")}\n`);
    io.write(
      step.expected === null
        ? "  (a setup step: nothing to check)\n"
        : `  Expected:\n${indent(step.expected || "(nothing written)", "    ")}\n`,
    );

    let choice: StepStatus | "quit" | undefined;
    while (choice === undefined) {
      const answer = io.ask("[p]assed [f]ailed [b]locked [s]kipped [q]uit > ");
      if (answer === null) return "stopped";
      choice = CHOICES[answer.trim().toLowerCase()];
      if (choice === undefined) io.write("Answer p, f, b, s or q.\n");
    }
    if (choice === "quit") return "stopped";

    let actual: string | null = null;
    if (choice !== "passed") {
      const text = io.ask("What happened? (Enter to skip, 'e' for $EDITOR) > ");
      if (text === null) {
        record({ number, status: choice, actual: null });
        return "stopped";
      }
      actual = text.trim() === "e" ? io.edit("") : text;
    }
    record({ number, status: choice, actual: actual?.trim() || null });
  }

  const done = io.ask("Every step is recorded. Finish the run? [Y/n] ");
  return done !== null && /^(y(es)?)?$/i.test(done.trim()) ? "finished" : "complete";
}
