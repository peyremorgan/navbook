/**
 * The conversation as the panel shows it, and the rules for folding a turn's
 * events into it.
 *
 * Pure, so it is tested without a browser. Two things are kept apart:
 *
 * - `transcript`, the conversation as the server understands it — opaque here,
 *   taken whole from each turn's last event and sent back with the next;
 * - `messages`, what a person reads: their words, the reply as it streams, and
 *   a row per tool the assistant used, with an approval card while a write
 *   waits for them.
 *
 * The message shape is the one Nuxt UI's chat components render, written out
 * here rather than imported from the AI SDK, which this client does not use.
 */

/** A `ChatEvent` as the subscription sends it. */
export interface ChatEventWire {
  type: "TEXT" | "TOOL_CALL" | "APPROVAL_REQUEST" | "TOOL_RESULT" | "DONE" | "ERROR";
  delta?: string | null;
  callId?: string | null;
  tool?: string | null;
  arguments?: unknown;
  summary?: string | null;
  ok?: boolean | null;
  commit?: { committed: boolean; subject: string; pushed: boolean } | null;
  record?: { kind: "ISSUE" | "PR"; id: string } | null;
  reason?: "STOP" | "APPROVAL" | "LENGTH" | "LIMIT" | null;
  /** The conversation as the server understands it: opaque, sent back as it came. */
  transcript?: string | null;
  message?: string | null;
  code?: string | null;
}

export interface TextPart {
  type: "text";
  text: string;
  state: "streaming" | "done";
}

export interface ToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  toolName: string;
  state: "running" | "awaiting" | "done" | "failed" | "declined";
  input: unknown;
  /** What the approval card says, or what the tool came to. */
  summary: string;
  commit?: { committed: boolean; subject: string; pushed: boolean };
  record?: { kind: "issue" | "pr"; id: string };
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  parts: (TextPart | ToolPart)[];
}

export type Status = "ready" | "submitted" | "streaming" | "error";

export interface ChatState {
  messages: UiMessage[];
  transcript: string;
  status: Status;
  error: string | null;
  /** The writes waiting for the person, by call id, with what was decided so far. */
  decisions: Record<string, boolean | null>;
}

export function emptyChat(): ChatState {
  return { messages: [], transcript: "[]", status: "ready", error: null, decisions: {} };
}

let counter = 0;
const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Start a turn: the person's words, if any, and an empty reply to fill. */
export function startTurn(state: ChatState, text: string | null): void {
  if (text !== null)
    state.messages.push({
      id: nextId("user"),
      role: "user",
      parts: [{ type: "text", text, state: "done" }],
    });
  state.status = "submitted";
  state.error = null;
}

/** Every write still waiting for a decision. */
export function waiting(state: ChatState): ToolPart[] {
  return toolParts(state).filter((part) => part.state === "awaiting");
}

/** Record one decision; true once every waiting write has one. */
export function decide(state: ChatState, callId: string, approved: boolean): boolean {
  if (!(callId in state.decisions)) return false;
  state.decisions[callId] = approved;
  return Object.values(state.decisions).every((decision) => decision !== null);
}

/** The decisions to send, and forget them: the next turn answers them all. */
export function takeDecisions(state: ChatState): { callId: string; approved: boolean }[] {
  const taken = Object.entries(state.decisions)
    .filter((entry): entry is [string, boolean] => entry[1] !== null)
    .map(([callId, approved]) => ({ callId, approved }));
  state.decisions = {};
  return taken;
}

/**
 * Fold one event in. Returns the write it reports, when it reports one that
 * committed — the caller refreshes what it shows and says so.
 */
export function applyEvent(state: ChatState, event: ChatEventWire): ToolPart | null {
  switch (event.type) {
    case "TEXT": {
      state.status = "streaming";
      const reply = currentReply(state);
      const last = reply.parts.at(-1);
      if (last?.type === "text" && last.state === "streaming") last.text += event.delta ?? "";
      else reply.parts.push({ type: "text", text: event.delta ?? "", state: "streaming" });
      return null;
    }
    case "TOOL_CALL": {
      state.status = "streaming";
      closeText(state);
      const existing = findTool(state, event.callId ?? "");
      if (existing) {
        existing.state = "running";
        return null;
      }
      currentReply(state).parts.push({
        type: `tool-${event.tool ?? "unknown"}`,
        toolCallId: event.callId ?? "",
        toolName: event.tool ?? "unknown",
        state: "running",
        input: event.arguments ?? null,
        summary: "",
      });
      return null;
    }
    case "APPROVAL_REQUEST": {
      const part = findTool(state, event.callId ?? "");
      if (part) {
        part.state = "awaiting";
        part.summary = event.summary ?? "";
        part.input = event.arguments ?? part.input;
      }
      if (event.callId) state.decisions[event.callId] = null;
      return null;
    }
    case "TOOL_RESULT": {
      const part = findTool(state, event.callId ?? "");
      if (!part) return null;
      const declined = event.ok === false && event.summary === "declined";
      part.state = declined ? "declined" : event.ok ? "done" : "failed";
      part.summary = event.summary ?? "";
      if (event.commit) part.commit = event.commit;
      if (event.record)
        part.record = { kind: event.record.kind === "PR" ? "pr" : "issue", id: event.record.id };
      return part.commit?.committed ? part : null;
    }
    case "DONE":
      closeText(state);
      if (typeof event.transcript === "string") state.transcript = event.transcript;
      state.status = "ready";
      if (event.reason === "LENGTH")
        state.error = "The reply was cut off at the model's length limit.";
      if (event.reason === "LIMIT")
        state.error = "The assistant used as many tools as one reply may, and was stopped.";
      return null;
    case "ERROR":
      closeText(state);
      if (typeof event.transcript === "string") state.transcript = event.transcript;
      stopRunning(state);
      state.status = "error";
      state.error = event.message ?? "The assistant failed.";
      return null;
  }
}

/** A turn that ended without its last event: stopped, or the connection dropped. */
export function interrupt(state: ChatState, why: string | null): void {
  closeText(state);
  stopRunning(state);
  // Whatever the interrupted turn asked for, it asked in a transcript the
  // server never finished: the next turn starts from the last one it did.
  for (const part of toolParts(state)) if (part.state === "awaiting") part.state = "declined";
  state.decisions = {};
  state.status = why === null ? "ready" : "error";
  state.error = why;
}

/** Forget everything, for a new conversation. */
export function reset(state: ChatState): void {
  Object.assign(state, emptyChat());
}

function currentReply(state: ChatState): UiMessage {
  const last = state.messages.at(-1);
  if (last?.role === "assistant") return last;
  const reply: UiMessage = { id: nextId("assistant"), role: "assistant", parts: [] };
  state.messages.push(reply);
  return reply;
}

function closeText(state: ChatState): void {
  for (const message of state.messages) {
    for (const part of message.parts) if (part.type === "text") part.state = "done";
  }
}

function stopRunning(state: ChatState): void {
  for (const part of toolParts(state)) {
    if (part.state === "running") {
      part.state = "failed";
      part.summary = part.summary || "interrupted";
    }
  }
}

function toolParts(state: ChatState): ToolPart[] {
  return state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type !== "text"),
  );
}

function findTool(state: ChatState, callId: string): ToolPart | undefined {
  return toolParts(state).find((part) => part.toolCallId === callId);
}
