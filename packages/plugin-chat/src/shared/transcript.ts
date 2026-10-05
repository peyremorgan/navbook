/**
 * A conversation as a client sends it back: checked before it is believed.
 *
 * The server keeps no conversation between turns, so every turn arrives with
 * the transcript the last one ended with. That is input like any other. It
 * cannot grant anything — every write still runs as the signed-in person,
 * through the same mutations a client could call directly — but a malformed
 * one would make the model endpoint refuse the request, and an enormous one
 * would make every turn cost what it cost to send. So its shape and its size
 * are checked here, and a system message is never accepted from outside.
 */

import type { ChatMessage } from "./openai.ts";

export interface TranscriptLimits {
  maxMessages: number;
  maxCharacters: number;
}

export const TRANSCRIPT_LIMITS: TranscriptLimits = { maxMessages: 400, maxCharacters: 400_000 };

export type TranscriptReading =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; message: string };

export function parseTranscript(
  raw: unknown,
  limits: TranscriptLimits = TRANSCRIPT_LIMITS,
): TranscriptReading {
  if (!Array.isArray(raw))
    return { ok: false, message: "the transcript must be a list of messages" };
  if (raw.length > limits.maxMessages) {
    return {
      ok: false,
      message: `the conversation is too long (${raw.length} messages); start a new one`,
    };
  }
  let characters = 0;
  const messages: ChatMessage[] = [];
  let calls = new Set<string>();
  // Every call made so far: an id used twice would let an approval, or a tool
  // message, answer a call it was not about.
  const made = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const message = parseMessage(item);
    if (message === null)
      return { ok: false, message: `message ${index + 1} of the transcript is malformed` };
    if (message.role === "tool") {
      if (!calls.has(message.tool_call_id)) {
        return {
          ok: false,
          message: `message ${index + 1} answers a tool call the transcript never made`,
        };
      }
      calls.delete(message.tool_call_id);
    } else if (message.role === "assistant") {
      calls = new Set();
      for (const call of message.tool_calls ?? []) {
        if (made.has(call.id)) {
          return {
            ok: false,
            message: `message ${index + 1} makes a tool call under an id already used`,
          };
        }
        made.add(call.id);
        calls.add(call.id);
      }
    } else {
      // A person speaking again closes whatever was left unanswered, which a
      // provider would refuse: only the last assistant message may be pending.
      if (calls.size > 0) {
        return { ok: false, message: `message ${index + 1} follows tool calls nobody answered` };
      }
      calls = new Set();
    }
    characters += JSON.stringify(message).length;
    if (characters > limits.maxCharacters) {
      return { ok: false, message: "the conversation is too long; start a new one" };
    }
    messages.push(message);
  }
  return { ok: true, messages };
}

function parseMessage(item: unknown): ChatMessage | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  switch (record.role) {
    case "user":
      return typeof record.content === "string" ? { role: "user", content: record.content } : null;
    case "tool":
      return typeof record.tool_call_id === "string" && typeof record.content === "string"
        ? { role: "tool", tool_call_id: record.tool_call_id, content: record.content }
        : null;
    case "assistant": {
      if (record.content !== null && typeof record.content !== "string") return null;
      if (record.tool_calls === undefined) return { role: "assistant", content: record.content };
      if (!Array.isArray(record.tool_calls)) return null;
      const calls: NonNullable<Extract<ChatMessage, { role: "assistant" }>["tool_calls"]> = [];
      for (const call of record.tool_calls) {
        if (typeof call !== "object" || call === null) return null;
        const { id, function: fn } = call as Record<string, unknown>;
        if (typeof id !== "string" || typeof fn !== "object" || fn === null) return null;
        const { name, arguments: args } = fn as Record<string, unknown>;
        if (typeof name !== "string" || typeof args !== "string") return null;
        calls.push({ id, type: "function", function: { name, arguments: args } });
      }
      return { role: "assistant", content: record.content, tool_calls: calls };
    }
    default:
      return null;
  }
}
