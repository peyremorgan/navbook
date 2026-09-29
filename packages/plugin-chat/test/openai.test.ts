/**
 * The chat-completions client, against the ways servers really stream.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  accumulate,
  ChatApiError,
  finishedCalls,
  httpFailure,
  makeClient,
  newAccumulator,
  type StreamEvent,
} from "../src/shared/openai.ts";
import { parseSse, parseSseEvents } from "../src/shared/sse.ts";
import { type StubLlm, startStubLlm } from "./helpers/stub-llm.ts";

/** A body delivered in the chunks given, split wherever the test likes. */
function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("parseSse", () => {
  it("reads events split anywhere, across chunk boundaries", async () => {
    assert.deepEqual(await collect(parseSse(body("da", "ta: one\n", "\ndata: t", "wo\n\n"))), [
      "one",
      "two",
    ]);
  });

  it("treats CRLF and CR as line ends, a CRLF split across chunks included", async () => {
    assert.deepEqual(await collect(parseSse(body("data: a\r", "\n\r\ndata: b\r\rdata: c\n\n"))), [
      "a",
      "b",
      "c",
    ]);
  });

  it("joins multi-line data, skips comments, and keeps a final event with no blank line", async () => {
    assert.deepEqual(
      await collect(parseSse(body(": ping\n\ndata: x\ndata: y\n\nevent: next\ndata: last"))),
      ["x\ny", "last"],
    );
  });

  it("names events, and defaults the name to message", async () => {
    assert.deepEqual(
      await collect(parseSseEvents(body("event: next\ndata: {}\n\ndata: plain\n\n"))),
      [
        { event: "next", data: "{}" },
        { event: "message", data: "plain" },
      ],
    );
  });

  it("decodes a multi-byte character split between chunks", async () => {
    const bytes = new TextEncoder().encode("data: café\n\n");
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    assert.deepEqual(await collect(parseSse(split)), ["café"]);
  });
});

describe("accumulate", () => {
  const delta = (d: unknown, finish: string | null = null) => ({
    choices: [{ index: 0, delta: d, finish_reason: finish }],
  });

  it("assembles interleaved tool calls by index", () => {
    const state = newAccumulator();
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, id: "a", function: { name: "show", arguments: '{"ki' } }] }),
    );
    accumulate(
      state,
      delta({
        tool_calls: [{ index: 1, id: "b", function: { name: "list_issues", arguments: "{}" } }],
      }),
    );
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, function: { arguments: 'nd":"issue"}' } }] }, "tool_calls"),
    );
    assert.equal(state.finish, "tool_calls");
    assert.deepEqual(finishedCalls(state), [
      { id: "a", name: "show", arguments: '{"kind":"issue"}' },
      { id: "b", name: "list_issues", arguments: "{}" },
    ]);
  });

  it("continues the last call when a delta has no index, as some gateways send", () => {
    const state = newAccumulator();
    accumulate(
      state,
      delta({ tool_calls: [{ id: "a", function: { name: "show", arguments: '{"a"' } }] }),
    );
    accumulate(state, delta({ tool_calls: [{ function: { arguments: ":1}" } }] }));
    assert.deepEqual(finishedCalls(state), [{ id: "a", name: "show", arguments: '{"a":1}' }]);
  });

  it("keeps a name that continuation deltas repeat whole or send empty", () => {
    const state = newAccumulator();
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, id: "a", function: { name: "show", arguments: "" } }] }),
    );
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, function: { name: "", arguments: "{" } }] }),
    );
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, function: { name: "show", arguments: "}" } }] }),
    );
    assert.deepEqual(finishedCalls(state), [{ id: "a", name: "show", arguments: "{}" }]);
  });

  it("takes arguments sent as an object, as llama.cpp does", () => {
    const state = newAccumulator();
    accumulate(
      state,
      delta({
        tool_calls: [{ index: 0, id: "a", function: { name: "show", arguments: { ref: "ab12" } } }],
      }),
    );
    assert.deepEqual(finishedCalls(state), [
      { id: "a", name: "show", arguments: '{"ref":"ab12"}' },
    ]);
  });

  it("names a call the server gave no id, and drops one with no name at all", () => {
    const state = newAccumulator();
    accumulate(
      state,
      delta({ tool_calls: [{ index: 0, function: { name: "show", arguments: "{}" } }] }),
    );
    accumulate(state, delta({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] }));
    assert.deepEqual(finishedCalls(state), [{ id: "call_0", name: "show", arguments: "{}" }]);
  });

  it("reads usage from a chunk with no choices, and text from content", () => {
    const state = newAccumulator();
    assert.equal(accumulate(state, delta({ content: "hi" })), "hi");
    assert.equal(accumulate(state, delta({ content: null })), "");
    accumulate(state, {
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    assert.deepEqual(state.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    accumulate(state, delta({}, "function_call"));
    assert.equal(state.finish, "tool_calls");
    accumulate(state, delta({}, "something_else"));
    assert.equal(state.finish, "other");
  });
});

describe("httpFailure", () => {
  it("says what each status means for somebody configuring this, without the key", () => {
    const key = "sk-secret-123";
    const auth = httpFailure(
      401,
      JSON.stringify({ error: { message: `bad key ${key}` } }),
      "u",
      key,
    );
    assert.equal(auth.kind, "auth");
    assert.equal(auth.message.includes(key), false);
    assert.match(auth.message, /refused the API key \(401\): bad key …/);
    assert.equal(httpFailure(404, "", "http://x/v1/chat/completions").kind, "not-found");
    assert.match(
      httpFailure(404, "", "http://x/v1/chat/completions").message,
      /check the base URL and the model/,
    );
    assert.equal(httpFailure(429, "", "u").kind, "rate-limit");
    assert.equal(httpFailure(503, "", "u").kind, "server");
    assert.equal(
      httpFailure(400, '{"message":"no such model"}', "u").message.includes("no such model"),
      true,
    );
    assert.equal(httpFailure(500, "x".repeat(1000), "u").message.length < 400, true);
  });
});

describe("the client", () => {
  let stub: StubLlm;

  before(async () => {
    stub = await startStubLlm();
  });

  after(async () => {
    await stub.close();
  });

  it("streams text, then finishes with the tool calls, sending what the API expects", async () => {
    stub.enqueue({
      text: "Looking…",
      toolCalls: [{ id: "c1", name: "show", arguments: { kind: "issue", ref: "ab12" } }],
    });
    const client = makeClient({ baseUrl: `${stub.url}/`, apiKey: "k" });
    const events: StreamEvent[] = await collect(
      client.stream({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: {
              name: "show",
              description: "d",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
          },
        ],
      }),
    );
    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event as { delta: string }).delta);
    assert.equal(text.join(""), "Looking…");
    assert.ok(text.length > 1, "several deltas");
    assert.deepEqual(events.at(-1), {
      type: "finish",
      reason: "tool_calls",
      toolCalls: [{ id: "c1", name: "show", arguments: '{"kind":"issue","ref":"ab12"}' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const sent = stub.requests.at(-1);
    assert.equal(sent?.authorization, "Bearer k");
    assert.equal(sent?.body.stream, true);
    assert.equal(sent?.body.model, "m");
    assert.equal("tool_choice" in (sent?.body ?? {}), false, "never sends tool_choice");
    assert.deepEqual((sent?.body as { stream_options?: unknown } | undefined)?.stream_options, {
      include_usage: true,
    });
  });

  it("sends no authorization without a key, and no tools when offered none", async () => {
    stub.enqueue({ text: "ok" });
    await collect(makeClient({ baseUrl: stub.url }).stream({ model: "m", messages: [] }));
    assert.equal(stub.requests.at(-1)?.authorization, undefined);
    assert.equal("tools" in (stub.requests.at(-1)?.body ?? {}), false);
  });

  it("turns an HTTP refusal into a ChatApiError", async () => {
    stub.enqueue({ status: 401, body: { error: { message: "invalid key" } } });
    await assert.rejects(
      collect(makeClient({ baseUrl: stub.url }).stream({ model: "m", messages: [] })),
      (error) => {
        assert.ok(error instanceof ChatApiError);
        assert.equal(error.kind, "auth");
        assert.equal(error.status, 401);
        return true;
      },
    );
  });

  it("says nothing is listening when the connection is refused", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await assert.rejects(
      collect(
        makeClient({ baseUrl: `http://127.0.0.1:${port}/v1` }).stream({ model: "m", messages: [] }),
      ),
      (error) =>
        error instanceof ChatApiError &&
        error.kind === "unreachable" &&
        /nothing is listening/.test(error.message),
    );
  });

  it("stops when told to, and says it was stopped", async () => {
    stub.enqueue({ text: "partial reply", hang: true });
    const controller = new AbortController();
    const seen: string[] = [];
    await assert.rejects(
      (async () => {
        for await (const event of makeClient({ baseUrl: stub.url }).stream({
          model: "m",
          messages: [],
          signal: controller.signal,
        })) {
          if (event.type === "text") {
            seen.push(event.delta);
            controller.abort();
          }
        }
      })(),
      (error) => error instanceof ChatApiError && error.kind === "aborted",
    );
    assert.ok(seen.length >= 1);
  });

  it("gives up after its timeout, saying so", async () => {
    stub.enqueue({ text: "x", hang: true });
    await assert.rejects(
      collect(
        makeClient({ baseUrl: stub.url, timeoutMs: 200 }).stream({ model: "m", messages: [] }),
      ),
      (error) => error instanceof ChatApiError && error.kind === "timeout",
    );
  });

  it("reports an error the server streamed instead of a status", async () => {
    const fake = (async () =>
      new Response(body('data: {"error":{"message":"model overloaded"}}\n\n'), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as unknown as typeof fetch;
    await assert.rejects(
      collect(
        makeClient({ baseUrl: "http://x/v1", fetch: fake }).stream({ model: "m", messages: [] }),
      ),
      (error) => error instanceof ChatApiError && /model overloaded/.test(error.message),
    );
  });

  it("refuses a stream that is not JSON", async () => {
    const fake = (async () =>
      new Response(body("data: <html>\n\n"), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(
      collect(
        makeClient({ baseUrl: "http://x/v1", fetch: fake }).stream({ model: "m", messages: [] }),
      ),
      (error) => error instanceof ChatApiError && error.kind === "protocol",
    );
  });
});
