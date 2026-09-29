/**
 * An OpenAI-compatible chat-completions client, streaming, and nothing else.
 *
 * Chat completions with `tools` and `stream: true` is the one protocol every
 * server a person might point this at speaks — OpenAI, and Ollama, llama.cpp,
 * vLLM, LM Studio, OpenRouter, Groq, Mistral, DeepSeek, Gemini's compatible
 * endpoint — so it is the one implemented, with `fetch` and a server-sent
 * events parser, and no dependency at all.
 *
 * "Compatible" is generous. What this tolerates, each seen in the wild:
 *
 * - a tool-call delta without an `index`, from some gateways: it continues the
 *   call last seen;
 * - `function.name` repeated as an empty string on every continuation delta,
 *   which a naive accumulator turns into a call with no name;
 * - `function.arguments` as an object rather than a JSON string (llama.cpp);
 * - the usage report on a final chunk with no choices, when asked for with
 *   `stream_options.include_usage`;
 * - `tool_choice` refused outright (Ollama), which is why it is never sent.
 */

import { parseSse } from "./sse.ts";
import type { OpenAiTool, ToolCall } from "./tools.ts";

/** A message as the chat-completions API takes it. */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "other";

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "finish"; reason: FinishReason; toolCalls: ToolCall[]; usage: Usage | null };

export interface CompletionRequest {
  model: string;
  messages: readonly ChatMessage[];
  tools?: readonly OpenAiTool[];
  signal?: AbortSignal;
}

export interface ChatClient {
  stream(request: CompletionRequest): AsyncGenerator<StreamEvent>;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** How long to wait for the endpoint to start answering and keep answering. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type ChatApiErrorKind =
  | "auth"
  | "not-found"
  | "rate-limit"
  | "server"
  | "bad-request"
  | "unreachable"
  | "timeout"
  | "aborted"
  | "protocol";

/** A failure talking to the endpoint, in words for a person. */
export class ChatApiError extends Error {
  readonly kind: ChatApiErrorKind;
  readonly status: number | null;

  constructor(kind: ChatApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ChatApiError";
    this.kind = kind;
    this.status = status;
  }
}

export const DEFAULT_TIMEOUT_MS = 120_000;

export function makeClient(opts: ClientOptions): ChatClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async *stream(request) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const body = {
        model: request.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      };

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        throw fetchFailure(error, signal, request.signal, opts.baseUrl, timeoutMs);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw httpFailure(response.status, text, url, opts.apiKey);
      }
      if (response.body === null)
        throw new ChatApiError("protocol", `${url} answered with no body`);

      const state = newAccumulator();
      try {
        for await (const data of parseSse(response.body)) {
          if (data === "[DONE]") break;
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            throw new ChatApiError(
              "protocol",
              `${url} sent something that is not JSON: ${data.slice(0, 80)}`,
            );
          }
          const failure = streamedError(chunk);
          if (failure !== null)
            throw new ChatApiError("server", `the model endpoint failed: ${failure}`);
          const delta = accumulate(state, chunk);
          if (delta !== "") yield { type: "text", delta };
        }
      } catch (error) {
        if (error instanceof ChatApiError) throw error;
        throw fetchFailure(error, signal, request.signal, opts.baseUrl, timeoutMs);
      }
      yield {
        type: "finish",
        reason: state.finish,
        toolCalls: finishedCalls(state),
        usage: state.usage,
      };
    },
  };
}

/* ---------------------------------------------------------- the accumulator */

interface PartialCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Accumulator {
  calls: Map<number, PartialCall>;
  /** The index a delta without one continues. */
  last: number | null;
  finish: FinishReason;
  usage: Usage | null;
}

export function newAccumulator(): Accumulator {
  return { calls: new Map(), last: null, finish: "stop", usage: null };
}

/** Fold one streamed chunk in; returns the text it added. */
export function accumulate(state: Accumulator, chunk: unknown): string {
  if (typeof chunk !== "object" || chunk === null) return "";
  const record = chunk as Record<string, unknown>;
  const usage = record.usage as Usage | null | undefined;
  if (usage && typeof usage === "object") state.usage = usage;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  if (!choice) return "";
  const reason = choice.finish_reason;
  if (typeof reason === "string") state.finish = finishReason(reason);

  const delta = (choice.delta ?? choice.message) as Record<string, unknown> | undefined;
  if (!delta) return "";
  const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  for (const raw of calls) {
    if (typeof raw !== "object" || raw === null) continue;
    const call = raw as Record<string, unknown>;
    const index = typeof call.index === "number" ? call.index : (state.last ?? state.calls.size);
    let partial = state.calls.get(index);
    if (!partial) {
      partial = { id: "", name: "", arguments: "" };
      state.calls.set(index, partial);
    }
    state.last = index;
    if (typeof call.id === "string" && call.id !== "" && partial.id === "") partial.id = call.id;
    const fn = call.function as Record<string, unknown> | undefined;
    if (fn) {
      if (typeof fn.name === "string" && fn.name !== "") {
        // A name repeated whole on a later delta is the same name, not more of it.
        partial.name = partial.name === fn.name ? partial.name : partial.name + fn.name;
      }
      if (typeof fn.arguments === "string") partial.arguments += fn.arguments;
      else if (fn.arguments !== undefined && fn.arguments !== null) {
        partial.arguments += JSON.stringify(fn.arguments);
      }
    }
  }
  return typeof delta.content === "string" ? delta.content : "";
}

/** The calls the stream finished with, each given an id if the server gave none. */
export function finishedCalls(state: Accumulator): ToolCall[] {
  return [...state.calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      id: call.id === "" ? `call_${index}` : call.id,
      name: call.name,
      arguments: call.arguments,
    }))
    .filter((call) => call.name !== "");
}

function finishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
    case "tool_calls":
    case "length":
    case "content_filter":
      return reason;
    // The pre-tools spelling, still sent by some servers.
    case "function_call":
      return "tool_calls";
    default:
      return "other";
  }
}

/** An error some servers send inside the stream instead of an HTTP status. */
function streamedError(chunk: unknown): string | null {
  if (typeof chunk !== "object" || chunk === null) return null;
  const error = (chunk as Record<string, unknown>).error;
  if (error === undefined || error === null) return null;
  if (typeof error === "string") return error;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

/* ----------------------------------------------------------------- failures */

/** What an HTTP status means for somebody configuring this. */
export function httpFailure(
  status: number,
  body: string,
  url: string,
  apiKey?: string,
): ChatApiError {
  const said = detail(body, apiKey);
  const suffix = said === "" ? "" : `: ${said}`;
  if (status === 401 || status === 403) {
    return new ChatApiError(
      "auth",
      `the model endpoint refused the API key (${status})${suffix}`,
      status,
    );
  }
  if (status === 404) {
    return new ChatApiError(
      "not-found",
      `nothing answered at ${url} (404) — check the base URL and the model name${suffix}`,
      status,
    );
  }
  if (status === 429) {
    return new ChatApiError(
      "rate-limit",
      `the model endpoint is rate limiting (429); try again shortly${suffix}`,
      status,
    );
  }
  if (status >= 500)
    return new ChatApiError("server", `the model endpoint failed (${status})${suffix}`, status);
  return new ChatApiError(
    "bad-request",
    `the model endpoint refused the request (${status})${suffix}`,
    status,
  );
}

/** The error message an API put in its body, cut short and scrubbed of the key. */
function detail(body: string, apiKey?: string): string {
  let text = body.trim();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.error?.message === "string"
          ? parsed.error.message
          : typeof parsed.message === "string"
            ? parsed.message
            : null;
    if (message !== null) text = message;
  } catch {
    // Not JSON: say what it said, briefly.
  }
  if (apiKey) text = text.split(apiKey).join("…");
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function fetchFailure(
  error: unknown,
  signal: AbortSignal,
  userSignal: AbortSignal | undefined,
  baseUrl: string,
  timeoutMs: number,
): ChatApiError {
  if (userSignal?.aborted) return new ChatApiError("aborted", "stopped");
  if (signal.aborted) {
    return new ChatApiError(
      "timeout",
      `the model endpoint did not answer within ${Math.round(timeoutMs / 1000)} s`,
    );
  }
  // Undici wraps the socket's error as the cause, and when a host name
  // resolves to several addresses, wraps each attempt's in an AggregateError.
  const cause = (
    error as { cause?: { code?: string; message?: string; errors?: { code?: string }[] } }
  )?.cause;
  const code = cause?.code ?? cause?.errors?.find((attempt) => attempt.code)?.code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET"
  ) {
    return new ChatApiError(
      "unreachable",
      code === "ECONNREFUSED"
        ? `nothing is listening at ${baseUrl}; is the server running?`
        : `${baseUrl} could not be reached (${code})`,
    );
  }
  const message = cause?.message ?? (error instanceof Error ? error.message : String(error));
  return new ChatApiError("unreachable", `${baseUrl} could not be reached: ${message}`);
}
