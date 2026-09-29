/**
 * A model endpoint that says what it is told to, for tests.
 *
 * It speaks OpenAI's chat-completions stream on `POST /v1/chat/completions`:
 * each request takes the next scripted turn and streams it — text split into
 * several deltas, tool-call arguments split across chunks — so the client's
 * accumulation is exercised on every test rather than in one. Every request is
 * recorded, so a test can check what the assistant sent: the system prompt,
 * the tool results, the key.
 *
 * Shared by the CLI and server suites and the Playwright spec, which starts it
 * in the test process and hands its URL to the server under test.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown> | string;
}

export interface StubTurn {
  text?: string;
  toolCalls?: StubToolCall[];
  /** Answer with this HTTP status and body instead of a stream. */
  status?: number;
  body?: unknown;
  /** Hold the stream open after the first chunk until the client goes away. */
  hang?: boolean;
  finishReason?: string;
}

export interface RecordedRequest {
  authorization: string | undefined;
  body: {
    model: string;
    messages: {
      role: string;
      content: string | null;
      tool_call_id?: string;
      tool_calls?: unknown[];
    }[];
    tools?: { function: { name: string } }[];
    stream: boolean;
    tool_choice?: unknown;
  };
}

export interface StubLlm {
  /** The base URL to configure: `http://127.0.0.1:<port>/v1`. */
  url: string;
  requests: RecordedRequest[];
  /** Answer the next requests with these turns, in order. */
  enqueue(...turns: StubTurn[]): void;
  /** Decide each answer from the request instead; takes precedence over the queue. */
  script(answer: ((request: RecordedRequest) => StubTurn) | null): void;
  /** How many streams are open now: a client that went away should have closed its own. */
  streaming(): number;
  close(): Promise<void>;
}

export async function startStubLlm(): Promise<StubLlm> {
  const queue: StubTurn[] = [];
  const requests: RecordedRequest[] = [];
  let answer: ((request: RecordedRequest) => StubTurn) | null = null;
  const open = new Set<import("node:http").ServerResponse>();

  const server: Server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `no route ${req.method} ${req.url}` } }));
      return;
    }
    const recorded: RecordedRequest = {
      authorization: req.headers.authorization,
      body: JSON.parse(await readBody(req)),
    };
    requests.push(recorded);
    const turn = answer ? answer(recorded) : queue.shift();
    if (!turn) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "the stub has nothing scripted for this request" } }),
      );
      return;
    }
    if (turn.status !== undefined) {
      res.writeHead(turn.status, { "content-type": "application/json" });
      res.end(JSON.stringify(turn.body ?? { error: { message: `scripted ${turn.status}` } }));
      return;
    }
    open.add(res);
    res.on("close", () => open.delete(res));
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (chunk: unknown): void => void res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    const base = {
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      model: recorded.body.model,
    };
    res.write(": keep-alive\n\n");

    const text = turn.text ?? "";
    for (const piece of pieces(text)) {
      send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    }
    if (turn.hang) return;
    for (const [index, call] of (turn.toolCalls ?? []).entries()) {
      const args =
        typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments);
      const [head, tail] = [
        args.slice(0, Math.ceil(args.length / 2)),
        args.slice(Math.ceil(args.length / 2)),
      ];
      send({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index,
                  id: call.id ?? `call_${requests.length}_${index}`,
                  type: "function",
                  function: { name: call.name, arguments: head },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      send({
        ...base,
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index, function: { name: "", arguments: tail } }] },
            finish_reason: null,
          },
        ],
      });
    }
    const reason = turn.finishReason ?? ((turn.toolCalls ?? []).length > 0 ? "tool_calls" : "stop");
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: reason }] });
    send({
      ...base,
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    res.end("data: [DONE]\n\n");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    enqueue: (...turns) => void queue.push(...turns),
    script: (fn) => {
      answer = fn;
    },
    streaming: () => open.size,
    close: () =>
      new Promise((resolve) => {
        for (const res of open) res.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Text in three uneven pieces, so a reply always arrives in several deltas. */
function pieces(text: string): string[] {
  if (text.length < 3) return text === "" ? [] : [text];
  const a = Math.floor(text.length / 3);
  const b = Math.floor((2 * text.length) / 3);
  return [text.slice(0, a), text.slice(a, b), text.slice(b)];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
