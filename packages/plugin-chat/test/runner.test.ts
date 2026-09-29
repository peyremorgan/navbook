/**
 * The loop: what it asks the model, what it runs, what it leaves in the
 * transcript — the last being what a provider rejects when it is wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ChatApiError,
  type ChatClient,
  type ChatMessage,
  type CompletionRequest,
  type StreamEvent,
} from "../src/shared/openai.ts";
import {
  DENIED,
  type Decision,
  makeRunner,
  pendingCalls,
  type RunnerEvent,
  settlePending,
} from "../src/shared/runner.ts";
import { TOOLS, type ToolExecutor, type ToolResult } from "../src/shared/tools.ts";

type Reply =
  | { text?: string; calls?: { id: string; name: string; arguments: unknown }[] }
  | ChatApiError;

/** A model that answers each request with the next reply, and records what it was asked. */
function scripted(...replies: Reply[]): { client: ChatClient; requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  const client: ChatClient = {
    async *stream(request): AsyncGenerator<StreamEvent> {
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const reply = replies.shift();
      if (reply === undefined) throw new Error("the script ran out");
      if (reply instanceof ChatApiError) throw reply;
      if (reply.text) {
        for (const piece of reply.text.split(/(?<= )/)) yield { type: "text", delta: piece };
      }
      yield {
        type: "finish",
        reason: reply.calls?.length ? "tool_calls" : "stop",
        toolCalls: (reply.calls ?? []).map((call) => ({
          id: call.id,
          name: call.name,
          arguments:
            typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
        })),
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  };
  return { client, requests };
}

/** An executor that records calls and answers each tool with a canned result. */
function recording(): ToolExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async execute(name, args) {
      calls.push(`${name} ${JSON.stringify(args)}`);
      if (name === "show") throw new Error("disk on fire");
      return { ok: true, content: { tool: name }, summary: `${name} ran` } satisfies ToolResult;
    },
  };
}

async function run(
  replies: Reply[],
  approve: Decision | ((name: string) => Decision),
  messages: ChatMessage[] = [
    { role: "system", content: "S" },
    { role: "user", content: "Q" },
  ],
  maxToolRounds?: number,
) {
  const { client, requests } = scripted(...replies);
  const executor = recording();
  const events: RunnerEvent[] = [];
  for await (const event of makeRunner(client, "m", TOOLS).run(messages, {
    execute: executor,
    approve: ({ name }) => (typeof approve === "function" ? approve(name) : approve),
    ...(maxToolRounds === undefined ? {} : { maxToolRounds }),
  })) {
    events.push(event);
  }
  return { events, messages, requests, executor };
}

const types = (events: RunnerEvent[]) => events.map((event) => event.type);

describe("the runner", () => {
  it("answers in words when the model calls nothing", async () => {
    const { events, messages, requests } = await run([{ text: "All quiet." }], "approved");
    assert.deepEqual(types(events), ["text-delta", "text-delta", "done"]);
    assert.deepEqual(messages.at(-1), { role: "assistant", content: "All quiet." });
    assert.equal(requests[0]?.tools?.length, TOOLS.length);
    assert.equal(requests[0]?.model, "m");
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.reason, "stop");
  });

  it("runs a read at once, hands the model its result, and asks again", async () => {
    const { events, messages, requests, executor } = await run(
      [
        { calls: [{ id: "a", name: "list_issues", arguments: { query: ["label:bug"] } }] },
        { text: "Two bugs." },
      ],
      () => assert.fail("a read is never asked about"),
    );
    assert.deepEqual(executor.calls, ['list_issues {"query":["label:bug"]}']);
    assert.deepEqual(types(events), [
      "tool-call",
      "tool-result",
      "text-delta",
      "text-delta",
      "done",
    ]);
    assert.deepEqual(messages.slice(2), [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "list_issues", arguments: '{"query":["label:bug"]}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "a", content: '{"tool":"list_issues"}' },
      { role: "assistant", content: "Two bugs." },
    ]);
    // The second request carries the answer to the first.
    assert.equal(requests[1]?.messages.at(-1)?.role, "tool");
  });

  it("asks before a write, and runs it once approved", async () => {
    const asked: string[] = [];
    const { executor, events } = await run(
      [
        { calls: [{ id: "w", name: "open_issue", arguments: { title: "T", body: "B" } }] },
        { text: "Filed." },
      ],
      (name) => {
        asked.push(name);
        return "approved";
      },
    );
    assert.deepEqual(asked, ["open_issue"]);
    assert.equal(executor.calls.length, 1);
    const result = events.find((event) => event.type === "tool-result");
    assert.equal(result?.type === "tool-result" && result.decision, "approved");
  });

  it("does not run a declined write, and tells the model not to retry", async () => {
    const { executor, messages, events } = await run(
      [
        { calls: [{ id: "w", name: "close_issue", arguments: { ref: "ab12" } }] },
        { text: "Left it open." },
      ],
      "denied",
    );
    assert.deepEqual(executor.calls, []);
    const answer = messages.find((message) => message.role === "tool");
    assert.ok(answer?.role === "tool" && answer.content.includes(DENIED));
    const result = events.find((event) => event.type === "tool-result");
    assert.equal(result?.type === "tool-result" && result.decision, "denied");
    assert.equal(result?.type === "tool-result" && result.result.summary, "declined");
  });

  it("stops at a deferred write, leaving it pending, after running the reads beside it", async () => {
    const { events, messages, executor, requests } = await run(
      [
        {
          calls: [
            { id: "w", name: "open_issue", arguments: { title: "T", body: "B" } },
            { id: "r", name: "list_issues", arguments: {} },
          ],
        },
      ],
      (name) => (name === "open_issue" ? "defer" : "approved"),
    );
    assert.deepEqual(types(events), [
      "tool-call",
      "approval-request",
      "tool-call",
      "tool-result",
      "done",
    ]);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.reason, "approval");
    assert.deepEqual(executor.calls, ["list_issues {}"]);
    assert.deepEqual(
      pendingCalls(messages).map((call) => call.id),
      ["w"],
    );
    assert.equal(requests.length, 1, "the model is not asked again while a write waits");
    const request = events.find((event) => event.type === "approval-request");
    assert.equal(
      request?.type === "approval-request" && request.request.summary,
      "Open an issue titled “T”",
    );
  });

  it("resumes a pending write from the transcript alone, then asks the model", async () => {
    const first = await run(
      [{ calls: [{ id: "w", name: "open_issue", arguments: { title: "T", body: "B" } }] }],
      "defer",
    );
    const second = await run([{ text: "Filed it." }], "approved", first.messages);
    assert.equal(second.executor.calls.length, 1);
    assert.deepEqual(types(second.events), [
      "tool-call",
      "tool-result",
      "text-delta",
      "text-delta",
      "done",
    ]);
    assert.deepEqual(pendingCalls(second.messages), []);
  });

  it("settles what waits without asking the model, for a person who moved on", async () => {
    const first = await run(
      [{ calls: [{ id: "w", name: "open_issue", arguments: { title: "T", body: "B" } }] }],
      "defer",
    );
    const events: RunnerEvent[] = [];
    const executor = recording();
    for await (const event of settlePending(first.messages, {
      execute: executor,
      approve: () => "denied",
    })) {
      events.push(event);
    }
    assert.deepEqual(types(events), ["tool-call", "tool-result"]);
    assert.deepEqual(executor.calls, []);
    assert.deepEqual(pendingCalls(first.messages), []);
  });

  it("answers an invalid call with what to fix, and never runs it", async () => {
    const { executor, messages, events } = await run(
      [
        {
          calls: [
            { id: "x", name: "nope", arguments: {} },
            { id: "y", name: "show", arguments: '{"kind":' },
          ],
        },
        { text: "Sorry." },
      ],
      "approved",
    );
    assert.deepEqual(executor.calls, []);
    const answers = messages.filter((message) => message.role === "tool");
    assert.equal(answers.length, 2, "every call is answered");
    assert.match(answers[0]?.role === "tool" ? answers[0].content : "", /no tool named 'nope'/);
    assert.ok(events.some((event) => event.type === "tool-result" && event.decision === "invalid"));
  });

  it("turns a tool that throws into a result the model can read", async () => {
    const { messages } = await run(
      [
        { calls: [{ id: "s", name: "show", arguments: { kind: "issue", ref: "ab12" } }] },
        { text: "It failed." },
      ],
      "approved",
    );
    const answer = messages.find((message) => message.role === "tool");
    assert.match(answer?.role === "tool" ? answer.content : "", /disk on fire/);
  });

  it("stops offering tools once the limit is reached, so the model must answer", async () => {
    const again = { calls: [{ id: "l", name: "list_issues", arguments: {} }] };
    const { requests, events } = await run(
      [again, again, { text: "Enough." }],
      "approved",
      undefined,
      2,
    );
    assert.equal(requests.length, 3);
    assert.ok(requests[1]?.tools);
    assert.equal(requests[2]?.tools, undefined);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.reason, "stop");
  });

  it("drops calls the model makes anyway once tools are withdrawn", async () => {
    const again = { calls: [{ id: "l", name: "list_issues", arguments: {} }] };
    const { events, messages } = await run([again, again], "approved", undefined, 1);
    const done = events.at(-1);
    assert.equal(done?.type === "done" && done.reason, "limit");
    assert.equal(messages.at(-1)?.role, "assistant");
    assert.deepEqual(pendingCalls(messages), []);
  });

  it("reports a failed request and adds nothing half-written to the transcript", async () => {
    const { events, messages } = await run(
      [new ChatApiError("server", "the model endpoint failed (500)")],
      "approved",
    );
    assert.deepEqual(types(events), ["error"]);
    assert.equal(messages.at(-1)?.role, "user");
  });

  it("keeps a huge tool result from filling the context", async () => {
    const big: ToolExecutor = {
      async execute() {
        return { ok: true, content: { rows: "x".repeat(100_000) }, summary: "big" };
      },
    };
    const { client } = scripted(
      { calls: [{ id: "a", name: "list_issues", arguments: {} }] },
      { text: "ok" },
    );
    const messages: ChatMessage[] = [{ role: "user", content: "Q" }];
    for await (const _ of makeRunner(client, "m", TOOLS).run(messages, {
      execute: big,
      approve: () => "approved",
    })) {
      // drain
    }
    const answer = messages.find((message) => message.role === "tool");
    assert.ok(answer?.role === "tool" && answer.content.length <= 32_100);
    assert.match(answer?.role === "tool" ? answer.content : "", /"truncated":true/);
  });
});
