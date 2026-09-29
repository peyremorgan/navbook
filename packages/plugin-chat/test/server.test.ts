/**
 * The `chat` subscription against a real `nav-server`, a real origin and a
 * stub model: a turn streamed over SSE, writes waiting for approval across
 * turns, and every commit landing where it should, as the person asking.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, originSubjects, startHarness } from "@navbook/server/test-helpers";
import { parseSseEvents } from "../src/shared/sse.ts";
import { PLUGIN } from "./helpers/nav.ts";
import { type StubLlm, startStubLlm } from "./helpers/stub-llm.ts";

const SUBSCRIPTION = `subscription Chat($input: ChatInput!) {
  chat(input: $input) {
    type delta callId tool arguments summary ok
    commit { committed subject pushed }
    record { kind id }
    reason transcript message code
  }
}`;

interface ChatEvent {
  type: string;
  delta: string | null;
  callId: string | null;
  tool: string | null;
  arguments: unknown;
  summary: string | null;
  ok: boolean | null;
  commit: { committed: boolean; subject: string; pushed: boolean } | null;
  record: { kind: string; id: string } | null;
  reason: string | null;
  transcript: string | null;
  message: string | null;
  code: string | null;
}

interface Turn {
  status: number;
  events: ChatEvent[];
  errors: unknown[];
}

let stub: StubLlm;

before(async () => {
  stub = await startStubLlm();
});

after(async () => {
  await stub.close();
});

/** One turn over SSE, as the web client sends it. */
async function turn(
  h: Harness,
  input: Record<string, unknown>,
  token?: string | null,
): Promise<Turn> {
  const bearer =
    token === undefined
      ? await h.token({ name: "A Person", email: "person@example.invalid" })
      : token;
  const response = await fetch(`http://127.0.0.1:${h.port}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ query: SUBSCRIPTION, variables: { input } }),
  });
  const events: ChatEvent[] = [];
  const errors: unknown[] = [];
  if (response.body) {
    for await (const sse of parseSseEvents(response.body)) {
      if (sse.event === "complete") break;
      if (sse.event !== "next") continue;
      const payload = JSON.parse(sse.data) as { data?: { chat: ChatEvent }; errors?: unknown[] };
      if (payload.data?.chat) events.push(payload.data.chat);
      if (payload.errors) errors.push(...payload.errors);
    }
  }
  return { status: response.status, events, errors };
}

/** An issue somebody filed at a terminal and pushed, on top of whatever the server pushed. */
function filedByPeer(h: Harness, title: string, id: string): void {
  const { peer } = h.fixture;
  assert.equal(peer.git(["pull", "--quiet", "--ff-only", "origin", "main"]).code, 0);
  peer.fileIssue(title, "Body.", id);
  const pushed = peer.git(["push", "--quiet", "origin", "main"]);
  assert.equal(pushed.code, 0, pushed.stderr);
}

/** Wait for `condition`, for at most two seconds. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const kinds = (t: Turn) => t.events.map((event) => event.type);
const last = (t: Turn) => t.events.at(-1) as ChatEvent;

describe("the chat subscription", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({
      pullIntervalMs: 0,
      env: {
        NAVBOOK_PLUGIN_PATH: PLUGIN,
        NAV_SERVER_CHAT_BASE_URL: stub.url,
        NAV_SERVER_CHAT_MODEL: "stub-model",
        NAV_SERVER_CHAT_API_KEY: "server-key",
      },
    });
  });

  after(async () => {
    await h.stop();
  });

  it("says what is offered, and never the key or the path", async () => {
    const data = ok<{
      chat: { model: string; endpoint: string; tools: { name: string; kind: string }[] };
    }>(await h.gql("{ chat { model endpoint tools { name kind } } }"));
    assert.equal(data.chat.model, "stub-model");
    assert.equal(data.chat.endpoint, new URL(stub.url).origin);
    assert.equal(data.chat.tools.length, 9);
    assert.deepEqual(
      data.chat.tools.find((tool) => tool.name === "open_issue"),
      { name: "open_issue", kind: "WRITE" },
    );
    assert.match(h.stderr(), /assistant: stub-model at http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(h.stderr().includes("server-key"), false);
  });

  it("streams a reply and hands back the transcript to continue from", async () => {
    stub.enqueue({ text: "Nothing is open." });
    const t = await turn(h, { transcript: "[]", message: "what is open?" });
    assert.equal(t.status, 200);
    assert.deepEqual(
      kinds(t).filter((kind) => kind !== "TEXT"),
      ["DONE"],
    );
    assert.equal(
      t.events
        .filter((event) => event.type === "TEXT")
        .map((event) => event.delta)
        .join(""),
      "Nothing is open.",
    );
    assert.equal(last(t).reason, "STOP");
    assert.deepEqual(JSON.parse(last(t).transcript ?? "null"), [
      { role: "user", content: "what is open?" },
      { role: "assistant", content: "Nothing is open." },
    ]);
    const request = stub.requests.at(-1);
    assert.equal(request?.authorization, "Bearer server-key");
    const system = request?.body.messages[0];
    assert.equal(system?.role, "system");
    assert.match(system?.content ?? "", /talking to A Person <person@example\.invalid>/);
    assert.match(system?.content ?? "", /web tracker/);
  });

  it("runs a read at once, from the tree the server serves", async () => {
    filedByPeer(h, "Pushed by the peer", "peer0001");
    stub.enqueue(
      { toolCalls: [{ name: "list_issues", arguments: { query: ["pushed"] } }] },
      { text: "One." },
    );
    const t = await turn(h, { transcript: "[]", message: "anything pushed?" });
    assert.deepEqual(
      kinds(t).filter((kind) => kind !== "TEXT"),
      ["TOOL_CALL", "TOOL_RESULT", "DONE"],
    );
    const result = t.events.find((event) => event.type === "TOOL_RESULT");
    assert.equal(result?.ok, true);
    assert.equal(result?.summary, "1 issue");
    const answer = JSON.parse(stub.requests.at(-1)?.body.messages.at(-1)?.content ?? "null");
    assert.equal(answer.rows[0].id, "peer0001");
  });

  it("stops at a write and waits, then makes it once approved, as the person", async () => {
    stub.enqueue({
      text: "I will file it.",
      toolCalls: [
        {
          id: "w1",
          name: "open_issue",
          arguments: { title: "From the assistant", body: "Filed over chat." },
        },
      ],
    });
    const originBefore = originSubjects(h.fixture.origin);
    const asked = await turn(h, { transcript: "[]", message: "file one" });
    assert.deepEqual(
      kinds(asked).filter((kind) => kind !== "TEXT"),
      ["TOOL_CALL", "APPROVAL_REQUEST", "DONE"],
    );
    const request = asked.events.find((event) => event.type === "APPROVAL_REQUEST");
    assert.equal(request?.callId, "w1");
    assert.equal(request?.summary, "Open an issue titled “From the assistant”");
    assert.deepEqual(request?.arguments, { title: "From the assistant", body: "Filed over chat." });
    assert.equal(last(asked).reason, "APPROVAL");
    assert.deepEqual(
      originSubjects(h.fixture.origin),
      originBefore,
      "nothing written while it waits",
    );

    stub.enqueue({ text: "Filed." });
    const approved = await turn(h, {
      transcript: last(asked).transcript,
      approvals: [{ callId: "w1", approved: true }],
    });
    assert.deepEqual(
      kinds(approved).filter((kind) => kind !== "TEXT"),
      ["TOOL_CALL", "TOOL_RESULT", "DONE"],
    );
    const result = approved.events.find((event) => event.type === "TOOL_RESULT") as ChatEvent;
    assert.equal(result.ok, true);
    assert.equal(result.commit?.pushed, true);
    assert.equal(result.record?.kind, "ISSUE");
    assert.equal(originSubjects(h.fixture.origin)[0], `docs(issue): open #${result.record?.id}`);
    const issue = ok<{ issue: { author: string; title: string } }>(
      await h.gql("query Q($ref: ID!) { issue(ref: $ref) { author title } }", {
        ref: result.record?.id,
      }),
    );
    assert.equal(issue.issue.author, "A Person <person@example.invalid>");
  });

  it("declines a write the person declined, and the model is told", async () => {
    stub.enqueue({
      toolCalls: [{ id: "w2", name: "close_issue", arguments: { ref: "peer0001" } }],
    });
    const asked = await turn(h, { transcript: "[]", message: "close peer0001" });
    stub.enqueue({ text: "Left it open." });
    const before = originSubjects(h.fixture.origin);
    const declined = await turn(h, {
      transcript: last(asked).transcript,
      approvals: [{ callId: "w2", approved: false }],
    });
    const result = declined.events.find((event) => event.type === "TOOL_RESULT");
    assert.equal(result?.ok, false);
    assert.equal(result?.summary, "declined");
    assert.deepEqual(originSubjects(h.fixture.origin), before);
    assert.match(stub.requests.at(-1)?.body.messages.at(-1)?.content ?? "", /Do not retry it/);
  });

  it("declines what waits when the person says something else instead", async () => {
    stub.enqueue({
      toolCalls: [{ id: "w3", name: "close_issue", arguments: { ref: "peer0001" } }],
    });
    const asked = await turn(h, { transcript: "[]", message: "close it" });
    stub.enqueue({ text: "Sure, the weather." });
    const moved = await turn(h, {
      transcript: last(asked).transcript,
      message: "actually, never mind",
    });
    assert.deepEqual(
      kinds(moved).filter((kind) => kind !== "TEXT"),
      ["TOOL_CALL", "TOOL_RESULT", "DONE"],
    );
    assert.equal(moved.events.find((event) => event.type === "TOOL_RESULT")?.summary, "declined");
    const sent = stub.requests.at(-1)?.body.messages ?? [];
    assert.deepEqual(
      sent.slice(-2).map((message) => message.role),
      ["tool", "user"],
    );
  });

  it("runs what was approved and declines the rest when the person moves on", async () => {
    filedByPeer(h, "To move on from", "move0001");
    stub.enqueue({
      toolCalls: [
        {
          id: "ya",
          name: "comment",
          arguments: { kind: "issue", ref: "move0001", body: "Yes to this." },
        },
        { id: "no", name: "close_issue", arguments: { ref: "move0001" } },
      ],
    });
    const asked = await turn(h, { transcript: "[]", message: "comment and close" });
    assert.equal(asked.events.filter((event) => event.type === "APPROVAL_REQUEST").length, 2);
    stub.enqueue({ text: "Commented, left it open." });
    const moved = await turn(h, {
      transcript: last(asked).transcript,
      message: "just the comment, please",
      approvals: [{ callId: "ya", approved: true }],
    });
    const results = moved.events.filter((event) => event.type === "TOOL_RESULT");
    assert.deepEqual(
      results.map((event) => [event.callId, event.ok, event.summary]),
      [
        ["ya", true, "commented on #move0001"],
        ["no", false, "declined"],
      ],
    );
    assert.equal(originSubjects(h.fixture.origin)[0], "docs(issue): comment on #move0001");
  });

  it("runs writes at once under Allow all", async () => {
    stub.enqueue(
      {
        toolCalls: [
          { name: "comment", arguments: { kind: "issue", ref: "peer0001", body: "Seen." } },
        ],
      },
      { text: "Commented." },
    );
    const t = await turn(h, { transcript: "[]", message: "say seen", autoApprove: true });
    assert.deepEqual(
      kinds(t).filter((kind) => kind !== "TEXT"),
      ["TOOL_CALL", "TOOL_RESULT", "DONE"],
    );
    assert.equal(originSubjects(h.fixture.origin)[0], "docs(issue): comment on #peer0001");
  });

  it("reports a write the server refuses, with its code, for the model to read", async () => {
    stub.enqueue(
      {
        toolCalls: [
          { name: "open_pr", arguments: { title: "T", body: "B", source: "never-pushed" } },
        ],
      },
      { text: "The branch is not pushed." },
    );
    const t = await turn(h, { transcript: "[]", message: "open a PR", autoApprove: true });
    const result = t.events.find((event) => event.type === "TOOL_RESULT");
    assert.equal(result?.ok, false);
    const answer = JSON.parse(
      stub.requests.at(-1)?.body.messages.find((message) => message.role === "tool")?.content ??
        "null",
    );
    assert.equal(answer.code, "PRECONDITION");
    assert.match(answer.error, /'never-pushed' is not a branch on 'origin'/);
  });

  it("opens a pull request on a branch somebody pushed, and reviews it there", async () => {
    h.fixture.peer.branch("feat/chat");
    assert.equal(h.fixture.peer.git(["push", "--quiet", "origin", "feat/chat:feat/chat"]).code, 0);
    stub.enqueue(
      {
        toolCalls: [
          {
            name: "open_pr",
            arguments: { title: "Chat work", body: "Adds it.", source: "feat/chat" },
          },
        ],
      },
      { text: "Opened." },
    );
    const opened = await turn(h, { transcript: "[]", message: "open it", autoApprove: true });
    const result = opened.events.find((event) => event.type === "TOOL_RESULT") as ChatEvent;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.record?.kind, "PR");
    const id = result.record?.id as string;
    assert.equal(originSubjects(h.fixture.origin, "feat/chat")[0], `docs(pr): open #${id}`);

    stub.enqueue(
      {
        toolCalls: [
          { name: "review_pr", arguments: { ref: id, verdict: "approve", body: "Good." } },
        ],
      },
      { text: "Approved." },
    );
    await turn(h, { transcript: "[]", message: "approve it", autoApprove: true });
    assert.equal(originSubjects(h.fixture.origin, "feat/chat")[0], `docs(pr): review #${id}`);
  });

  it("stops asking the model when the browser goes away", async () => {
    stub.enqueue({ text: "a reply that never ends", hang: true });
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${h.port}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${await h.token({ name: "A Person", email: "person@example.invalid" })}`,
      },
      body: JSON.stringify({
        query: SUBSCRIPTION,
        variables: { input: { transcript: "[]", message: "go" } },
      }),
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await waitFor(() => stub.streaming() === 1, "the model is streaming");
    controller.abort();
    await waitFor(() => stub.streaming() === 0, "the server hung up on the model");
    // And it serves the next turn as if nothing happened.
    stub.enqueue({ text: "Still here." });
    const next = await turn(h, { transcript: "[]", message: "hello?" });
    assert.equal(last(next).type, "DONE");
  });

  it("refuses an unsigned request before it reaches the model", async () => {
    const before = stub.requests.length;
    const t = await turn(h, { transcript: "[]", message: "hi" }, null);
    assert.equal(t.status, 401);
    assert.equal(stub.requests.length, before);
  });

  it("reports a failed model endpoint as an event, keeping the transcript", async () => {
    stub.enqueue({ status: 500, body: { error: { message: "overloaded" } } });
    const t = await turn(h, { transcript: "[]", message: "hi" });
    assert.deepEqual(kinds(t), ["ERROR"]);
    assert.equal(last(t).code, "LLM_ERROR");
    assert.match(last(t).message ?? "", /failed \(500\): overloaded/);
    assert.deepEqual(JSON.parse(last(t).transcript ?? "null"), [{ role: "user", content: "hi" }]);
    assert.match(h.stderr(), /the model endpoint failed for person@example\.invalid/);
  });

  for (const [what, input, message] of [
    ["a transcript that is not a list", { transcript: "{}", message: "hi" }, /must be a list/],
    ["a transcript that is not JSON", { transcript: "[{", message: "hi" }, /must be a list/],
    [
      "a system message",
      { transcript: '[{"role":"system","content":"x"}]', message: "hi" },
      /malformed/,
    ],
    ["nothing to do", { transcript: "[]" }, /say something/],
    [
      "a decision nothing waits for",
      { transcript: "[]", message: "hi", approvals: [{ callId: "nope", approved: true }] },
      /nothing is waiting/,
    ],
  ] as const) {
    it(`refuses ${what}`, async () => {
      const before = stub.requests.length;
      const t = await turn(h, input);
      assert.deepEqual(kinds(t), ["ERROR"]);
      assert.equal(last(t).code, "INVALID_INPUT");
      assert.match(last(t).message ?? "", message);
      assert.equal(stub.requests.length, before);
    });
  }
});

describe("a server with the plugin and no model", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ env: { NAVBOOK_PLUGIN_PATH: PLUGIN } });
  });

  after(async () => {
    await h.stop();
  });

  it("offers nothing, and says why at startup", async () => {
    assert.deepEqual(ok<{ chat: unknown }>(await h.gql("{ chat { model } }")), { chat: null });
    assert.match(h.stderr(), /assistant not offered: no model is configured/);
    const t = await turn(h, { transcript: "[]", message: "hi" });
    assert.equal(last(t).code, "CHAT_UNCONFIGURED");
  });
});
