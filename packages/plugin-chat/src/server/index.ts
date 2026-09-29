/**
 * The server half of `@navbook/plugin-chat`: `Query.chat` and the `chat`
 * subscription the web client streams a turn over.
 *
 * A turn is stateless. The client sends the transcript the last turn ended
 * with, and the server prepends its own system prompt, runs the loop, and
 * streams what happens. A write the person has not approved ends the turn with
 * it waiting; the next turn carries the decision. The model is called outside
 * every lock — only the tools themselves take the clone, one at a time, as any
 * request would.
 */

import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import { type ChatConfig, endpointOf, resolveChatConfig } from "../shared/config.ts";
import { type ChatMessage, makeClient } from "../shared/openai.ts";
import { systemPrompt, vocabulary } from "../shared/prompt.ts";
import {
  type Decision,
  makeRunner,
  pendingCalls,
  type RunnerEvent,
  settlePending,
} from "../shared/runner.ts";
import { TOOLS } from "../shared/tools.ts";
import { parseTranscript } from "../shared/transcript.ts";
import { makeServerExecutor } from "./executor.ts";

interface ChatInput {
  transcript: string;
  message?: string | null;
  approvals?: readonly { callId: string; approved: boolean }[] | null;
  autoApprove?: boolean | null;
}

/** What the subscription yields: a `ChatEvent`, as the SDL spells it. */
type ChatEvent = Record<string, unknown> & { type: string };

export function activate(host: ServerPluginHost): void {
  const reading = resolveChatConfig({
    env: host.pluginConfig,
    prefix: "NAV_SERVER_CHAT_",
    settings: host.settings,
  });
  const config: ChatConfig | null = reading.ok ? reading.config : null;
  host.report(
    config
      ? `assistant: ${config.model} at ${endpointOf(config.baseUrl)}`
      : `assistant not offered: ${reading.ok ? "" : reading.message}`,
  );

  host.resolvers({
    Query: {
      chat: () =>
        config === null
          ? null
          : {
              model: config.model,
              endpoint: endpointOf(config.baseUrl),
              tools: TOOLS.map((tool) => ({ name: tool.name, kind: tool.kind.toUpperCase() })),
            },
    },
    Subscription: {
      chat: {
        subscribe: (_parent: unknown, args: { input: ChatInput }, ctx: GraphQLCtx) =>
          turn(host, config, args.input, ctx),
        resolve: (event: ChatEvent) => event,
      },
    },
  });
}

async function* turn(
  host: ServerPluginHost,
  config: ChatConfig | null,
  input: ChatInput,
  ctx: GraphQLCtx,
): AsyncGenerator<ChatEvent> {
  if (config === null) {
    yield {
      type: "ERROR",
      code: "CHAT_UNCONFIGURED",
      message: "no assistant is configured on this server",
    };
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input.transcript);
  } catch {
    raw = undefined;
  }
  const parsed = parseTranscript(raw);
  if (!parsed.ok) {
    yield { type: "ERROR", code: "INVALID_INPUT", message: parsed.message };
    return;
  }
  const transcript = parsed.messages;
  const pending = pendingCalls(transcript);
  const approvals = new Map((input.approvals ?? []).map((entry) => [entry.callId, entry.approved]));
  for (const callId of approvals.keys()) {
    if (!pending.some((call) => call.id === callId)) {
      yield {
        type: "ERROR",
        code: "INVALID_INPUT",
        message: `nothing is waiting for a decision on ${callId}`,
      };
      return;
    }
  }
  const message = input.message?.trim() ?? "";
  if (message === "" && pending.length === 0) {
    yield {
      type: "ERROR",
      code: "INVALID_INPUT",
      message: "say something, or decide what is waiting",
    };
    return;
  }

  // Stopped when the browser goes away, so an abandoned turn stops paying for
  // the model; a tool already running finishes, since a write is never halved.
  const controller = new AbortController();
  const request = (ctx as GraphQLCtx & { request?: Request }).request;
  request?.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const auto = input.autoApprove === true;
  const decide = (callId: string, undecided: Decision): Decision => {
    if (auto) return "approved";
    const approved = approvals.get(callId);
    return approved === undefined ? undecided : approved ? "approved" : "denied";
  };

  const messages: ChatMessage[] = [
    { role: "system", content: await sessionPrompt(host, ctx) },
    ...transcript,
  ];
  const opts = {
    execute: makeServerExecutor(host, ctx),
    signal: controller.signal,
    approve: ({ call }: { call: { id: string } }) => decide(call.id, "defer"),
  };
  const history = (): string => JSON.stringify(messages.slice(1));

  try {
    if (message !== "") {
      // Something new said over a write still waiting is not a yes: whatever
      // was not approved is declined, so the conversation can move on.
      if (pending.length > 0) {
        for await (const event of settlePending(messages, {
          ...opts,
          approve: ({ call }) => decide(call.id, "denied"),
        })) {
          yield* chatEvent(event);
        }
      }
      messages.push({ role: "user", content: message });
    }
    const runner = makeRunner(
      makeClient({ baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) }),
      config.model,
      TOOLS,
    );
    for await (const event of runner.run(messages, opts)) {
      if (event.type === "error") {
        if (event.error.kind !== "aborted") {
          host.report(
            `assistant: the model endpoint failed for ${ctx.viewer.email}: ${event.error.message}`,
          );
        }
        yield {
          type: "ERROR",
          code: event.error.kind === "aborted" ? "ABORTED" : "LLM_ERROR",
          message: event.error.message,
          transcript: history(),
        };
        return;
      }
      if (event.type === "done") {
        yield { type: "DONE", reason: event.reason.toUpperCase(), transcript: history() };
        return;
      }
      yield* chatEvent(event);
    }
  } catch (error) {
    // Nothing reaches Yoga as a thrown error: it would end the stream with a
    // masked message, and the client would lose the transcript as it stood.
    const text = error instanceof Error ? error.message : String(error);
    host.report(`assistant: a turn failed for ${ctx.viewer.email}: ${text}`);
    yield { type: "ERROR", code: "INTERNAL", message: text, transcript: history() };
  } finally {
    controller.abort();
  }
}

/** A runner event as the subscription spells it; `done` and `error` are the turn's own. */
function* chatEvent(event: RunnerEvent): Generator<ChatEvent> {
  switch (event.type) {
    case "text-delta":
      yield { type: "TEXT", delta: event.delta };
      return;
    case "tool-call":
      yield { type: "TOOL_CALL", callId: event.call.id, tool: event.name, arguments: event.args };
      return;
    case "approval-request":
      yield {
        type: "APPROVAL_REQUEST",
        callId: event.request.call.id,
        tool: event.request.name,
        arguments: event.request.args,
        summary: event.request.summary,
      };
      return;
    case "tool-result":
      yield {
        type: "TOOL_RESULT",
        callId: event.call.id,
        tool: event.name,
        ok: event.result.ok,
        summary: event.result.summary,
        ...(event.result.commit ? { commit: event.result.commit } : {}),
        ...(event.result.record
          ? {
              record: {
                kind: event.result.record.kind === "pr" ? "PR" : "ISSUE",
                id: event.result.record.id,
              },
            }
          : {}),
      };
      return;
    default:
      return;
  }
}

/** The system prompt for this person, today, over this tree. */
async function sessionPrompt(host: ServerPluginHost, ctx: GraphQLCtx): Promise<string> {
  const { core } = host;
  let repo = null;
  try {
    repo = await ctx.sync.read(() => ctx.loadRepo("none"));
  } catch {
    // A tree that cannot be read is reported by the tool that reads it.
  }
  return systemPrompt({
    viewer: core.currentAuthor(ctx.ws),
    today: ctx.ws.now().toISOString().slice(0, 10),
    surface:
      "the web tracker; the server writes pull requests on their own branches, so `open_pr` needs a `source` branch already pushed",
    ...vocabulary(core, repo, ctx.ws.ext),
  });
}
