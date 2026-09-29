/**
 * `nav chat`'s conversation, driven through a fake terminal.
 *
 * The REPL needs a real TTY to run as a process, so its logic is tested here
 * against the {@link Terminal} it is written to, with a model that answers
 * from a script — including one that never answers, to prove Ctrl-C stops it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Output, oneShot, preview, repl, type Terminal } from "../src/cli/session.ts";
import {
  ChatApiError,
  type ChatClient,
  type ChatMessage,
  type StreamEvent,
} from "../src/shared/openai.ts";
import { makeRunner } from "../src/shared/runner.ts";
import { TOOLS, type ToolExecutor } from "../src/shared/tools.ts";

type Step = { text?: string; call?: { name: string; arguments: unknown } } | "hang";

function client(...steps: Step[]): ChatClient {
  return {
    async *stream(request): AsyncGenerator<StreamEvent> {
      const step = steps.shift();
      if (step === undefined) throw new Error("the script ran out");
      if (step === "hang") {
        yield { type: "text", delta: "thinking" };
        await new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () =>
            reject(new ChatApiError("aborted", "stopped")),
          );
        });
      }
      if (step !== "hang" && step.text) yield { type: "text", delta: step.text };
      yield {
        type: "finish",
        reason: step !== "hang" && step.call ? "tool_calls" : "stop",
        toolCalls:
          step !== "hang" && step.call
            ? [
                {
                  id: `c${steps.length}`,
                  name: step.call.name,
                  arguments: JSON.stringify(step.call.arguments),
                },
              ]
            : [],
        usage: null,
      };
    },
  };
}

function captured(): Output & { stdout: string; stderr: string } {
  const out = {
    stdout: "",
    stderr: "",
    out(text: string) {
      out.stdout += text;
    },
    err(text: string) {
      out.stderr += text;
    },
    dim: (text: string) => text,
    red: (text: string) => text,
    bold: (text: string) => text,
  };
  return out;
}

/** A terminal that types the given lines, one per question, and records the prompts. */
function typing(
  ...lines: (string | null | ((terminal: FakeTerminal) => string | null))[]
): FakeTerminal {
  const terminal: FakeTerminal = {
    prompts: [],
    closed: false,
    typed: "",
    interrupt: () => undefined,
    async ask(prompt) {
      terminal.prompts.push(prompt);
      if (terminal.closed) return null;
      const next = lines.shift();
      if (next === undefined) return null;
      return typeof next === "function" ? next(terminal) : next;
    },
    onInterrupt(handler) {
      terminal.interrupt = handler;
    },
    line: () => terminal.typed,
    clearLine: () => {
      terminal.typed = "";
    },
    close: () => {
      terminal.closed = true;
    },
  };
  return terminal;
}

interface FakeTerminal extends Terminal {
  prompts: string[];
  closed: boolean;
  typed: string;
  interrupt: () => void;
}

function executor(): ToolExecutor & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    async execute(name) {
      ran.push(name);
      return { ok: true, content: {}, summary: `${name} done` };
    },
  };
}

function deps(model: ChatClient, run = executor()) {
  const output = captured();
  const messages: ChatMessage[] = [{ role: "system", content: "S" }];
  return {
    deps: { runner: makeRunner(model, "m", TOOLS), executor: run, output, messages, model: "m" },
    output,
    run,
    messages,
  };
}

describe("the conversation", () => {
  it("answers, skips blank lines, shows help, and leaves on /quit", async () => {
    const { deps: d, output, messages } = deps(client({ text: "Hello there." }));
    const terminal = typing("", "hi", "/help", "/quit", "never asked");
    await repl(d, { terminal, yes: false });
    assert.equal(output.stdout, "Hello there.\n");
    assert.match(output.stderr, /Talking to m\. \/help for help/);
    assert.match(output.stderr, /\/reset {3}forget the conversation/);
    assert.deepEqual(terminal.prompts, ["> ", "> ", "> ", "> "]);
    assert.equal(terminal.closed, true);
    assert.deepEqual(
      messages.map((message) => message.role),
      ["system", "user", "assistant"],
    );
  });

  it("leaves when the input ends", async () => {
    const { deps: d } = deps(client());
    const terminal = typing(null);
    await repl(d, { terminal, yes: false });
    assert.equal(terminal.closed, true);
  });

  it("shows a write in full and runs it when the answer is y", async () => {
    const {
      deps: d,
      output,
      run,
    } = deps(
      client(
        {
          call: {
            name: "open_issue",
            arguments: { title: "Crash", body: "It crashes.\nOften.", labels: ["bug"] },
          },
        },
        { text: "Filed." },
      ),
    );
    const terminal = typing("file a crash", "y", "/exit");
    await repl(d, { terminal, yes: false });
    assert.deepEqual(run.ran, ["open_issue"]);
    assert.ok(terminal.prompts.includes("Apply? [y/N] "));
    assert.match(
      output.stdout,
      /Open an issue titled “Crash”\n {2}title: Crash\n {2}labels: bug\n {2}body:\n {4}It crashes\.\n {4}Often\.\n/,
    );
    assert.match(output.stderr, /← open_issue: open_issue done/);
  });

  it("declines anything but yes", async () => {
    for (const answer of ["n", "", "maybe", null]) {
      const {
        deps: d,
        run,
        output,
      } = deps(
        client({ call: { name: "close_issue", arguments: { ref: "ab12" } } }, { text: "Left it." }),
      );
      await repl(d, { terminal: typing("close it", answer, "/quit"), yes: false });
      assert.deepEqual(run.ran, [], JSON.stringify(answer));
      assert.match(output.stderr, /✗ close_issue: declined/);
    }
  });

  it("asks nothing under -y", async () => {
    const { deps: d, run } = deps(
      client({ call: { name: "reopen_issue", arguments: { ref: "ab12" } } }, { text: "ok" }),
    );
    const terminal = typing("reopen", "/quit");
    await repl(d, { terminal, yes: true });
    assert.deepEqual(run.ran, ["reopen_issue"]);
    assert.equal(terminal.prompts.includes("Apply? [y/N] "), false);
  });

  it("forgets the conversation on /reset, keeping the system prompt", async () => {
    const { deps: d, messages } = deps(client({ text: "one" }));
    await repl(d, { terminal: typing("first", "/reset", "/quit"), yes: false });
    assert.deepEqual(messages, [{ role: "system", content: "S" }]);
  });

  it("stops a reply on Ctrl-C and carries on, and leaves on Ctrl-C at an empty prompt", async () => {
    const { deps: d, output } = deps(client("hang", { text: "Second answer." }));
    const terminal = typing(
      (t) => {
        // Ctrl-C a moment into the reply.
        setTimeout(() => t.interrupt(), 20);
        return "slow question";
      },
      "fast question",
      (t) => {
        t.interrupt();
        return null;
      },
    );
    await repl(d, { terminal, yes: false });
    assert.match(output.stderr, /\(stopped\)/);
    assert.match(output.stdout, /Second answer\./);
    assert.equal(terminal.closed, true);
  });

  it("clears a half-typed line on Ctrl-C rather than leaving", () => {
    const terminal = typing();
    const { deps: d } = deps(client());
    void repl(d, { terminal, yes: false });
    terminal.typed = "half a thought";
    terminal.interrupt();
    assert.equal(terminal.typed, "");
    assert.equal(terminal.closed, false);
    terminal.interrupt();
    assert.equal(terminal.closed, true);
  });

  it("reports a failed turn and keeps the conversation going", async () => {
    const failing: ChatClient = {
      // biome-ignore lint/correctness/useYield: it fails before it has anything to say
      async *stream() {
        throw new ChatApiError("server", "the model endpoint failed (500)");
      },
    };
    const { deps: d, output } = deps(failing);
    await repl(d, { terminal: typing("hello", "/quit"), yes: false });
    assert.match(output.stderr, /error: the model endpoint failed \(500\)/);
  });
});

describe("one question", () => {
  it("returns the failure for the caller to exit on", async () => {
    const { deps: d } = deps(client());
    const failure = await oneShot(d, { text: "hi", json: false, approve: () => "approved" });
    assert.match(failure ?? "", /the script ran out/);
  });

  it("previews a write without its body when it has none", () => {
    const text = preview(captured(), {
      call: { id: "c", name: "close_issue", arguments: "{}" },
      name: "close_issue",
      args: { ref: "ab12", resolution: "fixed" },
      summary: "Close issue #ab12 as fixed",
    });
    assert.equal(text, "\nClose issue #ab12 as fixed\n  ref: ab12\n  resolution: fixed\n");
  });
});
