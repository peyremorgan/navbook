/**
 * `nav chat`: one question, or a conversation.
 *
 * Deliberately a line interface and nothing more — no full-screen mode, no
 * rendering, no history kept on disk (spec 04 §4.4 keeps the CLI's state in
 * the tree). The reply is streamed as it arrives; what the assistant does is
 * said on stderr in one dim line per tool, so stdout carries only its words and
 * can be piped. A write is shown in full and asked about before it runs.
 *
 * Everything that touches the terminal comes in through {@link Terminal}, so
 * the conversation's logic is tested without one.
 */

import type { ChatMessage } from "../shared/openai.ts";
import type { ApprovalRequest, Decision, Runner, RunnerEvent } from "../shared/runner.ts";
import type { ToolExecutor } from "../shared/tools.ts";

/** How output is written and styled. */
export interface Output {
  out(text: string): void;
  err(text: string): void;
  dim(text: string): string;
  red(text: string): string;
  bold(text: string): string;
}

/** A line editor: what the REPL needs of `node:readline`. */
export interface Terminal {
  /**
   * Ask for one line; null once the input has ended (Ctrl-D), or once
   * `signal` aborts — the question is then withdrawn, not left to catch the
   * next line typed.
   */
  ask(prompt: string, signal?: AbortSignal): Promise<string | null>;
  /** Called on Ctrl-C, with whether a line was being typed. */
  onInterrupt(handler: () => void): void;
  /** What is typed on the line being edited, so Ctrl-C can clear it first. */
  line(): string;
  clearLine(): void;
  close(): void;
}

export interface SessionDeps {
  runner: Runner;
  executor: ToolExecutor;
  output: Output;
  /** The conversation so far, starting with the system prompt. */
  messages: ChatMessage[];
  model: string;
}

/* ------------------------------------------------------------------ one-shot */

export interface OneShotOptions {
  /** The question, already joined with whatever was piped in. */
  text: string;
  /** Emit one JSON event per line instead of the reply. */
  json: boolean;
  /** Decide each write; the caller knows whether anybody can be asked. */
  approve: (request: ApprovalRequest) => Decision | Promise<Decision>;
  signal?: AbortSignal;
}

/** Answer once. Returns the error message when the turn failed, or null. */
export async function oneShot(deps: SessionDeps, opts: OneShotOptions): Promise<string | null> {
  deps.messages.push({ role: "user", content: opts.text });
  const view = opts.json ? jsonView(deps.output) : textView(deps.output);
  for await (const event of deps.runner.run(deps.messages, {
    execute: deps.executor,
    approve: opts.approve,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) {
    const failure = view(event);
    if (failure !== null) return failure;
  }
  return null;
}

/* ---------------------------------------------------------------------- REPL */

export interface ReplOptions {
  terminal: Terminal;
  /** Apply every write without asking, as `-y` says. */
  yes: boolean;
}

export const HELP = [
  "Ask anything about this tracker, or ask for something to be filed, reviewed or closed.",
  "Every change is shown to you before it is made.",
  "  /help    this",
  "  /reset   forget the conversation so far",
  "  /quit    leave (also /exit, or Ctrl-D)",
  "Ctrl-C stops a reply; on an empty line it leaves.",
];

/** Converse until the person leaves. */
export async function repl(deps: SessionDeps, opts: ReplOptions): Promise<void> {
  const { output, terminal } = { output: deps.output, terminal: opts.terminal };
  const system = deps.messages.slice(0, 1);
  let inflight: AbortController | null = null;
  let leaving = false;

  terminal.onInterrupt(() => {
    if (inflight !== null) {
      inflight.abort();
      return;
    }
    if (terminal.line() !== "") {
      terminal.clearLine();
      return;
    }
    leaving = true;
    terminal.close();
  });

  output.err(output.dim(`Talking to ${deps.model}. /help for help, /quit to leave.\n`));
  const view = textView(output);

  while (!leaving) {
    const line = await terminal.ask("> ");
    if (line === null) break;
    const text = line.trim();
    if (text === "") continue;
    if (text === "/quit" || text === "/exit") break;
    if (text === "/help") {
      output.err(`${HELP.join("\n")}\n`);
      continue;
    }
    if (text === "/reset") {
      deps.messages.splice(0, deps.messages.length, ...system);
      output.err(output.dim("Forgotten. Starting afresh.\n"));
      continue;
    }

    deps.messages.push({ role: "user", content: text });
    const controller = new AbortController();
    inflight = controller;
    try {
      for await (const event of deps.runner.run(deps.messages, {
        execute: deps.executor,
        signal: controller.signal,
        // Shown under -y too: -y skips the question, never the telling.
        // Ctrl-C at the question stops the turn, which declines the write.
        approve: async (request) => {
          output.out(preview(output, request));
          if (opts.yes) return "approved";
          const answer = await terminal.ask("Apply? [y/N] ", controller.signal);
          return answer !== null && /^y(es)?$/i.test(answer.trim()) ? "approved" : "denied";
        },
      })) {
        const failure = view(event);
        if (failure !== null) {
          output.err(
            controller.signal.aborted
              ? output.dim("(stopped)\n")
              : `${output.red("error:")} ${failure}\n`,
          );
        }
      }
    } finally {
      inflight = null;
    }
  }
  terminal.close();
}

/* --------------------------------------------------------------- rendering */

/** Turn events into terminal output; returns an error's message when one ends the turn. */
function textView(output: Output): (event: RunnerEvent) => string | null {
  let midLine = false;
  const endLine = (): void => {
    if (midLine) output.out("\n");
    midLine = false;
  };
  return (event) => {
    switch (event.type) {
      case "text-delta":
        output.out(printable(event.delta));
        if (event.delta !== "") midLine = !event.delta.endsWith("\n");
        return null;
      case "tool-call":
        return null;
      case "approval-request":
        // Only a caller that defers sees this, and the CLI never defers.
        return null;
      case "tool-result": {
        endLine();
        const mark = event.result.ok ? output.dim("←") : output.red("✗");
        output.err(`${mark} ${output.dim(`${event.name}: ${printable(event.result.summary)}`)}\n`);
        return null;
      }
      case "done":
        endLine();
        if (event.reason === "length")
          output.err(output.dim("(the reply was cut off at the model's length limit)\n"));
        return null;
      case "error":
        endLine();
        return event.error.message;
    }
  };
}

/** One JSON object per line, for scripts: nothing else is written to stdout. */
function jsonView(output: Output): (event: RunnerEvent) => string | null {
  const emit = (value: Record<string, unknown>): void => output.out(`${JSON.stringify(value)}\n`);
  return (event) => {
    switch (event.type) {
      case "text-delta":
        emit({ type: "text", delta: event.delta });
        return null;
      case "tool-call":
        emit({ type: "tool_call", id: event.call.id, name: event.name, arguments: event.args });
        return null;
      case "approval-request":
        return null;
      case "tool-result":
        emit({
          type: "tool_result",
          id: event.call.id,
          name: event.name,
          ok: event.result.ok,
          decision: event.decision,
          summary: event.result.summary,
          ...(event.result.commit ? { commit: event.result.commit } : {}),
          ...(event.result.record ? { record: event.result.record } : {}),
        });
        return null;
      case "done":
        emit({ type: "done", reason: event.reason, usage: event.usage });
        return null;
      case "error":
        return event.error.message;
    }
  };
}

/** What a write will do, in full, for the person deciding. */
export function preview(output: Output, request: ApprovalRequest): string {
  const lines = [`\n${output.bold(printable(request.summary))}`];
  for (const [key, value] of Object.entries(request.args)) {
    if (key === "body") continue;
    lines.push(
      `  ${output.dim(`${key}:`)} ${printable(Array.isArray(value) ? value.join(", ") : String(value))}`,
    );
  }
  const body = request.args.body;
  if (typeof body === "string" && body.trim() !== "") {
    lines.push(`  ${output.dim("body:")}`);
    for (const line of printable(body.trimEnd()).split("\n")) lines.push(`    ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Text from the model, safe to write to a terminal. What it writes may repeat
 * whatever it read, and an escape sequence in that could move the cursor or
 * clear the screen — over the very preview a person is deciding on. Control
 * characters other than a newline and a tab are shown as `�`.
 */
export function printable(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is replaced
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "\ufffd");
}
