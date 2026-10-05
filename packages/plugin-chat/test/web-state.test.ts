/**
 * The panel's state: a turn's events folded into what a person reads.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEvent,
  type ChatEventWire,
  decide,
  emptyChat,
  interrupt,
  reset,
  startTurn,
  type ToolPart,
  takeDecisions,
  waiting,
} from "../web/app/utils/chat-state.ts";

const text = (delta: string): ChatEventWire => ({ type: "TEXT", delta });
const call = (callId: string, tool: string, args: unknown = {}): ChatEventWire => ({
  type: "TOOL_CALL",
  callId,
  tool,
  arguments: args,
});

function tools(state: ReturnType<typeof emptyChat>): ToolPart[] {
  return state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type !== "text"),
  );
}

describe("the panel's state", () => {
  it("streams a reply into one message, and keeps the transcript the turn ends with", () => {
    const state = emptyChat();
    startTurn(state, "hi");
    assert.equal(state.status, "submitted");
    applyEvent(state, text("Hel"));
    applyEvent(state, text("lo."));
    assert.equal(state.status, "streaming");
    applyEvent(state, {
      type: "DONE",
      reason: "STOP",
      transcript: '[{"role":"user","content":"hi"}]',
    });
    assert.equal(state.status, "ready");
    assert.equal(state.transcript, '[{"role":"user","content":"hi"}]');
    assert.deepEqual(
      state.messages.map((message) => [message.role, message.parts]),
      [
        ["user", [{ type: "text", text: "hi", state: "done" }]],
        ["assistant", [{ type: "text", text: "Hello.", state: "done" }]],
      ],
    );
  });

  it("puts a tool between the words before and after it", () => {
    const state = emptyChat();
    startTurn(state, "find");
    applyEvent(state, text("Looking. "));
    applyEvent(state, call("a", "list_issues"));
    applyEvent(state, {
      type: "TOOL_RESULT",
      callId: "a",
      tool: "list_issues",
      ok: true,
      summary: "2 issues",
    });
    applyEvent(state, text("Two."));
    const parts = state.messages[1]?.parts ?? [];
    assert.deepEqual(
      parts.map((part) => part.type),
      ["text", "tool-list_issues", "text"],
    );
    assert.equal((parts[1] as ToolPart).state, "done");
    assert.equal((parts[1] as ToolPart).summary, "2 issues");
  });

  it("waits on a write, resumes it on the same card, and reports the commit", () => {
    const state = emptyChat();
    startTurn(state, "file one");
    applyEvent(state, call("w", "open_issue", { title: "T", body: "B" }));
    applyEvent(state, {
      type: "APPROVAL_REQUEST",
      callId: "w",
      tool: "open_issue",
      summary: "Open an issue titled “T”",
      arguments: { title: "T", body: "B" },
    });
    applyEvent(state, { type: "DONE", reason: "APPROVAL", transcript: "[1]" });
    assert.deepEqual(
      waiting(state).map((part) => part.toolCallId),
      ["w"],
    );
    assert.equal(waiting(state)[0]?.summary, "Open an issue titled “T”");

    assert.equal(decide(state, "w", true), true);
    assert.deepEqual(takeDecisions(state), [{ callId: "w", approved: true }]);
    startTurn(state, null);
    applyEvent(state, call("w", "open_issue"));
    const wrote = applyEvent(state, {
      type: "TOOL_RESULT",
      callId: "w",
      tool: "open_issue",
      ok: true,
      summary: "opened #ab12cd34",
      commit: { committed: true, subject: "docs(issue): open #ab12cd34", pushed: true },
      record: { kind: "ISSUE", id: "ab12cd34" },
    });
    assert.equal(wrote?.record?.id, "ab12cd34");
    assert.equal(wrote?.record?.kind, "issue");
    assert.equal(tools(state).length, 1, "the same card, not a second one");
    assert.equal(state.messages.length, 2, "and the same reply");
  });

  it("waits for every write before it sends the decisions", () => {
    const state = emptyChat();
    for (const id of ["a", "b"]) {
      applyEvent(state, call(id, "close_issue"));
      applyEvent(state, { type: "APPROVAL_REQUEST", callId: id, tool: "close_issue", summary: id });
    }
    assert.equal(decide(state, "a", false), false);
    assert.equal(decide(state, "b", true), true);
    assert.equal(decide(state, "nope", true), false);
    assert.deepEqual(takeDecisions(state), [
      { callId: "a", approved: false },
      { callId: "b", approved: true },
    ]);
    assert.deepEqual(state.decisions, {});
  });

  it("shows a declined write as declined, and a failed one as failed", () => {
    const state = emptyChat();
    applyEvent(state, call("d", "close_issue"));
    applyEvent(state, { type: "TOOL_RESULT", callId: "d", ok: false, summary: "declined" });
    applyEvent(state, call("f", "show"));
    const wrote = applyEvent(state, {
      type: "TOOL_RESULT",
      callId: "f",
      ok: false,
      summary: "no issue matches",
    });
    assert.equal(wrote, null);
    assert.deepEqual(
      tools(state).map((part) => part.state),
      ["declined", "failed"],
    );
  });

  it("keeps the transcript an error carries, and says what went wrong", () => {
    const state = emptyChat();
    startTurn(state, "hi");
    applyEvent(state, call("a", "list_issues"));
    applyEvent(state, {
      type: "ERROR",
      code: "LLM_ERROR",
      message: "the model endpoint failed (500)",
      transcript: "[2]",
    });
    assert.equal(state.status, "error");
    assert.equal(state.error, "the model endpoint failed (500)");
    assert.equal(state.transcript, "[2]");
    assert.equal(tools(state)[0]?.state, "failed", "nothing is left spinning");
  });

  it("says when a turn ends early or the model was cut short", () => {
    const state = emptyChat();
    applyEvent(state, { type: "DONE", reason: "LENGTH", transcript: "[]" });
    assert.match(state.error ?? "", /length limit/);
    startTurn(state, "again");
    assert.equal(state.error, null);
    applyEvent(state, { type: "DONE", reason: "LIMIT", transcript: "[]" });
    assert.match(state.error ?? "", /as many tools/);
  });

  it("drops what a turn cut short asked for, since the server never recorded it", () => {
    const state = emptyChat();
    applyEvent(state, call("w", "open_issue"));
    applyEvent(state, { type: "APPROVAL_REQUEST", callId: "w", tool: "open_issue", summary: "s" });
    applyEvent(state, call("r", "list_issues"));
    interrupt(state, "The connection closed before the reply was finished.");
    assert.equal(state.status, "error");
    assert.deepEqual(
      tools(state).map((part) => part.state),
      ["declined", "failed"],
    );
    assert.deepEqual(state.decisions, {});
    interrupt(state, null);
    assert.equal(state.status, "ready");
  });

  it("keeps the transcript a write that ran carries, so a stop after it loses nothing", () => {
    const state = emptyChat();
    state.transcript = "[1]";
    startTurn(state, null);
    applyEvent(state, call("w", "comment"));
    applyEvent(state, {
      type: "TOOL_RESULT",
      callId: "w",
      tool: "comment",
      ok: true,
      summary: "commented on #ab12",
      commit: { committed: true, subject: "docs(issue): comment on #ab12", pushed: true },
      transcript: "[1,2]",
    });
    applyEvent(state, text("Done, and now a long"));
    interrupt(state, null);
    assert.equal(state.transcript, "[1,2]", "the next turn starts after the write");
    assert.equal(tools(state)[0]?.state, "done");
  });

  it("forgets everything on reset", () => {
    const state = emptyChat();
    startTurn(state, "hi");
    applyEvent(state, { type: "DONE", reason: "STOP", transcript: "[9]" });
    reset(state);
    assert.deepEqual(state, emptyChat());
  });
});
