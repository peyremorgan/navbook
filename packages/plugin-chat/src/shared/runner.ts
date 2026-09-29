/**
 * The assistant's loop: ask the model, run what it calls, ask again.
 *
 * One loop for every front end. What differs between them is who decides
 * whether a write goes ahead — a person at a `[y/N]` in a terminal, an
 * approval card in a browser that answers on the *next* request — and that is
 * the one question the loop asks its caller. It may answer `defer`: the turn
 * then ends with the write still pending, and a later run over the same
 * transcript resumes it once somebody has decided. So the transcript is the
 * whole state, and nothing has to be remembered between requests.
 *
 * Invariants the transcript keeps, because providers reject a history that
 * breaks them:
 *
 * - every assistant `tool_calls` entry is followed by one `tool` message per
 *   call before the next assistant message — declined, invalid and failed calls
 *   included;
 * - an interrupted turn leaves nothing half-written: a request that failed or
 *   was stopped adds no assistant message.
 */

import { ChatApiError, type ChatClient, type ChatMessage, type Usage } from "./openai.ts";
import {
  checkCall,
  describeCall,
  type ToolArgs,
  type ToolCall,
  type ToolExecutor,
  type ToolName,
  type ToolResult,
  type ToolSpec,
  toOpenAiTools,
} from "./tools.ts";

export type Decision = "approved" | "denied" | "defer";

/** What the loop asks before a write runs. */
export interface ApprovalRequest {
  call: ToolCall;
  name: ToolName;
  args: Record<string, unknown>;
  /** One sentence saying what it will do. */
  summary: string;
}

export type RunnerEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; call: ToolCall; name: string; args: Record<string, unknown> | null }
  | { type: "approval-request"; request: ApprovalRequest }
  | {
      type: "tool-result";
      call: ToolCall;
      name: string;
      result: ToolResult;
      decision: "read" | "approved" | "denied" | "invalid";
    }
  | { type: "done"; reason: "stop" | "approval" | "length" | "limit"; usage: Usage | null }
  | { type: "error"; error: ChatApiError };

export interface RunOptions {
  approve: (request: ApprovalRequest) => Decision | Promise<Decision>;
  execute: ToolExecutor;
  signal?: AbortSignal;
  /** How many times the model may call tools before it must answer in words. */
  maxToolRounds?: number;
}

export const MAX_TOOL_ROUNDS = 8;

/** What a declined write tells the model, so it neither retries nor pretends. */
export const DENIED =
  "The person declined this. It was not done. Do not retry it; say it was not done.";

export interface Runner {
  /**
   * Continue the conversation in `messages`, appending to it as it goes.
   *
   * `messages` ends either with the person's newest message, or with an
   * assistant message whose calls are still pending — which `approve` then
   * decides first.
   */
  run(messages: ChatMessage[], opts: RunOptions): AsyncGenerator<RunnerEvent, void>;
}

export function makeRunner(client: ChatClient, model: string, tools: readonly ToolSpec[]): Runner {
  const offered = toOpenAiTools(tools);

  return {
    async *run(messages, opts) {
      const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS;
      let usage: Usage | null = null;

      const pending = pendingCalls(messages);
      if (pending.length > 0) {
        if (yield* settle(pending, messages, opts)) {
          yield { type: "done", reason: "approval", usage };
          return;
        }
      }

      for (let round = 0; ; round++) {
        // Past the limit the model is asked with no tools at all, so it has to
        // say something rather than go round again.
        const allowTools = round < maxRounds;
        let text = "";
        let calls: ToolCall[] = [];
        let reason: string = "stop";
        // Calls made after the tools were withdrawn: dropped, and said so.
        let dropped = false;
        try {
          for await (const event of client.stream({
            model,
            messages,
            ...(allowTools ? { tools: offered } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
          })) {
            if (event.type === "text") {
              text += event.delta;
              yield { type: "text-delta", delta: event.delta };
            } else {
              calls = allowTools ? event.toolCalls : [];
              dropped = !allowTools && event.toolCalls.length > 0;
              reason = event.reason;
              if (event.usage) usage = addUsage(usage, event.usage);
            }
          }
        } catch (error) {
          yield {
            type: "error",
            error:
              error instanceof ChatApiError
                ? error
                : new ChatApiError(
                    "protocol",
                    error instanceof Error ? error.message : String(error),
                  ),
          };
          return;
        }

        messages.push({
          role: "assistant",
          content: text === "" && calls.length > 0 ? null : text,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        });

        if (calls.length === 0) {
          yield {
            type: "done",
            reason: reason === "length" ? "length" : dropped ? "limit" : "stop",
            usage,
          };
          return;
        }
        if (yield* settle(calls, messages, opts)) {
          yield { type: "done", reason: "approval", usage };
          return;
        }
      }
    },
  };
}

/**
 * Decide the calls `messages` leaves waiting, without asking the model
 * anything: for a person who answers a pending write by saying something new.
 * Returns true when a call is still waiting after all.
 */
export function settlePending(
  messages: ChatMessage[],
  opts: RunOptions,
): AsyncGenerator<RunnerEvent, boolean> {
  return settle(pendingCalls(messages), messages, opts);
}

/**
 * Run or decline each call, appending a tool message for everything that was
 * decided. Returns true when at least one write was deferred: the turn stops
 * there, with those calls left unanswered in the transcript.
 */
async function* settle(
  calls: readonly ToolCall[],
  messages: ChatMessage[],
  opts: RunOptions,
): AsyncGenerator<RunnerEvent, boolean> {
  let deferred = false;
  for (const call of calls) {
    const checked = checkCall(call);
    yield {
      type: "tool-call",
      call,
      name: call.name,
      args: checked.ok ? checked.args : null,
    };
    if (!checked.ok) {
      const result: ToolResult = {
        ok: false,
        content: { error: checked.error },
        summary: checked.error,
      };
      answer(messages, call, result);
      yield { type: "tool-result", call, name: call.name, result, decision: "invalid" };
      continue;
    }

    const name = checked.tool.name;
    if (checked.tool.kind === "write") {
      const request: ApprovalRequest = {
        call,
        name,
        args: checked.args,
        summary: describeCall(name, checked.args),
      };
      const decision = await opts.approve(request);
      if (decision === "defer") {
        deferred = true;
        yield { type: "approval-request", request };
        continue;
      }
      if (decision === "denied") {
        const result: ToolResult = {
          ok: false,
          content: { declined: true, message: DENIED },
          summary: "declined",
        };
        answer(messages, call, result);
        yield { type: "tool-result", call, name, result, decision: "denied" };
        continue;
      }
    }

    const result = await runTool(opts.execute, name, checked.args, opts.signal);
    answer(messages, call, result);
    yield {
      type: "tool-result",
      call,
      name,
      result,
      decision: checked.tool.kind === "write" ? "approved" : "read",
    };
  }
  return deferred;
}

/** Run one tool; an executor that throws is a result the model can read, not a crash. */
async function runTool(
  execute: ToolExecutor,
  name: ToolName,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  try {
    return await execute.execute(name, args as ToolArgs[typeof name], signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: { error: message }, summary: `failed: ${message}` };
  }
}

/** The most a tool message may carry, so one listing cannot fill the context. */
export const TOOL_CONTENT_LIMIT = 32_000;

function answer(messages: ChatMessage[], call: ToolCall, result: ToolResult): void {
  let content = JSON.stringify(
    result.ok ? result.content : (result.content ?? { error: result.summary }),
  );
  if (content.length > TOOL_CONTENT_LIMIT) {
    content = JSON.stringify({
      truncated: true,
      note: "the result was too long; ask for fewer rows or a narrower query",
      start: content.slice(0, TOOL_CONTENT_LIMIT - 200),
    });
  }
  messages.push({ role: "tool", tool_call_id: call.id, content });
}

/**
 * The calls of the last assistant message nobody has answered yet: the writes
 * a previous turn deferred, in the order the model made them.
 */
export function pendingCalls(messages: readonly ChatMessage[]): ToolCall[] {
  let last = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "assistant") {
      last = index;
      break;
    }
    if (messages[index]?.role === "user") return [];
  }
  if (last === -1) return [];
  const assistant = messages[last] as Extract<ChatMessage, { role: "assistant" }>;
  const answered = new Set(
    messages
      .slice(last + 1)
      .filter(
        (message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool",
      )
      .map((message) => message.tool_call_id),
  );
  return (assistant.tool_calls ?? [])
    .filter((call) => !answered.has(call.id))
    .map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
}

function addUsage(total: Usage | null, more: Usage): Usage {
  if (total === null) return { ...more };
  return {
    prompt_tokens: total.prompt_tokens + (more.prompt_tokens ?? 0),
    completion_tokens: total.completion_tokens + (more.completion_tokens ?? 0),
    total_tokens: total.total_tokens + (more.total_tokens ?? 0),
  };
}
