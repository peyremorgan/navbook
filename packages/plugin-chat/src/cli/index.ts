/**
 * The terminal half of `@navbook/plugin-chat`: `nav chat`.
 *
 * The one command that reaches the network, and only the model endpoint it is
 * configured for (spec 04 §4.4): what it sends is the system prompt, the
 * conversation, and what the tools read out of the tree while answering it.
 */

import { createInterface } from "node:readline";
import type { CliPluginHost } from "@navbook/cli/plugin";
import { resolveChatConfig } from "../shared/config.ts";
import { makeClient } from "../shared/openai.ts";
import { systemPrompt, vocabulary } from "../shared/prompt.ts";
import type { Decision } from "../shared/runner.ts";
import { makeRunner } from "../shared/runner.ts";
import { TOOLS } from "../shared/tools.ts";
import { makeCliExecutor } from "./executor.ts";
import { type Output, oneShot, preview, repl, type Terminal } from "./session.ts";

interface ChatOptions {
  message?: string;
  yes?: boolean;
  model?: string;
  json?: boolean;
}

export function activate(host: CliPluginHost): void {
  host.command("chat", (_args, opts) => chat(host, opts as ChatOptions));
}

async function chat(host: CliPluginHost, opts: ChatOptions): Promise<void> {
  const { core, ctx } = host;
  // Through `host`, whose type is declared, so `fail` narrows as `never` does.
  const ui = host.ui;

  const reading = resolveChatConfig({
    env: ctx.env,
    prefix: "NAV_CHAT_",
    settings: host.settings,
    ...(opts.model === undefined ? {} : { flags: { model: opts.model } }),
  });
  if (!reading.ok) host.ui.fail(reading.message, reading.details);
  const { config } = reading;

  let person: string;
  try {
    person = core.currentAuthor(ctx);
  } catch (error) {
    host.ui.fail(error instanceof Error ? error.message : String(error), [
      "the assistant writes as you, so git needs to know who that is: set user.email",
    ]);
  }
  const email = core.parsePerson(person)?.email ?? person;

  const interactive = opts.message === undefined && !opts.json && process.stdin.isTTY === true;
  if (opts.json && opts.message === undefined && process.stdin.isTTY === true) {
    ui.fail("--json answers one question: pass it with -m, or pipe it in");
  }

  const output = terminalOutput(ctx);
  const messages = [
    {
      role: "system" as const,
      content: systemPrompt({
        viewer: person,
        today: ctx.now().toISOString().slice(0, 10),
        surface: "the `nav chat` command line, in a checkout of the repository",
        branch: core.currentBranch(ctx.repoRoot),
        ...vocabulary(core, readable(host), ctx.ext),
      }),
    },
  ];
  const deps = {
    runner: makeRunner(
      makeClient({ baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) }),
      config.model,
      TOOLS,
    ),
    executor: makeCliExecutor(host, { person, email }),
    output,
    messages,
    model: config.model,
  };

  if (interactive) {
    await repl(deps, { terminal: readlineTerminal(), yes: opts.yes === true });
    return;
  }

  // Piped input is part of the question, never answers to one: a pipeline
  // cannot be asked whether to apply a change, so without -y none is applied.
  const piped = process.stdin.isTTY === true ? "" : await readAll(process.stdin, ctx);
  const text = [opts.message ?? "", piped]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  if (text === "") ui.fail("nothing to ask: pass the question with -m, or pipe it in");

  // Both ends, as the host's own questions need: with stdout redirected the
  // question would go to the file, and the run would wait on an answer to it.
  const canAsk = !opts.json && ui.isInteractive();
  let warned = false;
  const approve = (request: Parameters<typeof preview>[1]): Decision => {
    if (opts.yes) return "approved";
    if (!canAsk) {
      if (!warned) {
        output.err(output.dim("changes need -y when nobody can be asked; declined\n"));
        warned = true;
      }
      return "denied";
    }
    output.out(preview(output, request));
    return ui.askYesNo("Apply? [y/N] ") ? "approved" : "denied";
  };

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  try {
    const failure = await oneShot(deps, {
      text,
      json: opts.json === true,
      approve,
      signal: controller.signal,
    });
    if (failure !== null) ui.fail(controller.signal.aborted ? "stopped" : failure);
  } finally {
    process.off("SIGINT", stop);
  }
}

/** The tree, for the prompt's vocabulary; a tree that cannot be read has none. */
function readable(host: CliPluginHost): ReturnType<CliPluginHost["core"]["loadRepo"]> | null {
  try {
    return host.core.loadRepo(host.ctx, { comments: "none" });
  } catch {
    // Reported by the tool that reads it, if the conversation gets that far.
    return null;
  }
}

function terminalOutput(ctx: CliPluginHost["ctx"]): Output {
  return {
    out: (text) => void ctx.stdout.write(text),
    err: (text) => void ctx.stderr.write(text),
    dim: (text) => ctx.colors.dim(text),
    red: (text) => ctx.colors.red(text),
    bold: (text) => ctx.colors.bold(text),
  };
}

/** `node:readline` behind the {@link Terminal} the REPL is written against. */
function readlineTerminal(): Terminal {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
  });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  return {
    ask: (prompt, signal) =>
      closed || signal?.aborted
        ? Promise.resolve(null)
        : new Promise((resolve) => {
            // A question pending when the input ends (Ctrl-D) resolves as null
            // rather than hanging: `close` is the only answer it will get.
            // Aborted, readline withdraws the question itself.
            const settle = (answer: string | null): void => {
              rl.off("close", onClose);
              signal?.removeEventListener("abort", onAbort);
              resolve(answer);
            };
            const onClose = (): void => settle(null);
            const onAbort = (): void => {
              process.stdout.write("\n");
              settle(null);
            };
            rl.once("close", onClose);
            signal?.addEventListener("abort", onAbort, { once: true });
            rl.question(prompt, signal ? { signal } : {}, (answer) => settle(answer));
          }),
    // With a SIGINT listener, readline hands Ctrl-C to us instead of ending.
    onInterrupt: (handler) => void rl.on("SIGINT", handler),
    line: () => rl.line,
    clearLine: () => rl.write(null, { ctrl: true, name: "u" }),
    close: () => {
      if (!closed) {
        process.stdout.write("\n");
        rl.close();
      }
    },
  };
}

/**
 * Everything on stdin. A stdin that is not a terminal but never ends — a
 * terminal that only looks like a pipe, as mintty's does, or a caller that
 * leaves it open — would otherwise wait in silence, so after a moment with
 * nothing read, the person at the terminal is told what it is waiting for.
 */
async function readAll(stream: NodeJS.ReadableStream, ctx: CliPluginHost["ctx"]): Promise<string> {
  const chunks: Buffer[] = [];
  const hint = setTimeout(() => {
    if (chunks.length === 0 && ctx.stderr.isTTY === true)
      ctx.stderr.write(ctx.colors.dim("reading the question from stdin; end it with Ctrl-D\n"));
  }, 1000);
  try {
    for await (const chunk of stream)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  } finally {
    clearTimeout(hint);
  }
  return Buffer.concat(chunks).toString("utf8");
}
