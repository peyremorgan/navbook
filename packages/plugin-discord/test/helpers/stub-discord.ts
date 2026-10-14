/**
 * A Discord that answers on 127.0.0.1, for tests.
 *
 * It speaks the part of Discord's REST API and gateway the bridge uses, over
 * real HTTP and a real websocket, so the bridge's own client is what is under
 * test — rate limits, retries, reconnects and all. One guild with a forum
 * channel and a text channel; threads and messages kept in memory, every
 * request recorded. A test makes interactions arrive (`interact`) and reads
 * what the bridge answered (`responses`).
 *
 * The websocket is RFC 6455, by hand: text frames, close, ping. Node has a
 * websocket client but no server, and the plugin depends on nothing.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type {
  Channel,
  Embed,
  ForumTag,
  Interaction,
  Message,
  MessageBody,
} from "../../src/server/discord/types.ts";

export const GUILD = "100000000000000001";
export const FORUM = "100000000000000002";
export const TEXT = "100000000000000003";
export const APP = "100000000000000009";
/** A forum in a guild the bridge does not serve. */
export const ELSEWHERE = "100000000000000005";
/** A voice channel: in the guild, but one no thread can be made in. */
export const VOICE = "100000000000000006";
export const BOT = "100000000000000010";

export interface StubMessage extends Message {
  embeds: Embed[];
  components: unknown[];
  allowed_mentions?: unknown;
  edits: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
  agent: string | null;
}

export interface StubResponse {
  interaction: string;
  type: number;
  data: unknown;
}

interface Fault {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  headers: Record<string, string>;
  times: number;
  /** How many matching requests to let through before failing. */
  skip: number;
  /** Do what was asked, then answer with the fault: an answer lost after the work was done. */
  apply: boolean;
}

export interface StubDiscord {
  url: string;
  requests: RecordedRequest[];
  channels: Map<string, Channel>;
  messages: Map<string, StubMessage[]>;
  commands: unknown[] | null;
  /** Every interaction callback and edit of an original response, in order. */
  responses: StubResponse[];
  identifies: number;
  resumes: number;
  /** Forget every fault not yet used up. */
  clearFaults(): void;
  /** Answer the next `times` requests matching with this status (and body and headers). */
  fail(
    method: string,
    path: RegExp,
    status: number,
    opts?: {
      body?: unknown;
      headers?: Record<string, string>;
      times?: number;
      skip?: number;
      apply?: boolean;
    },
  ): void;
  /** Threads under a channel, oldest first. */
  threadsOf(parent: string): Channel[];
  /** The starter message of a thread: the forum post's, or the text channel message it hangs from. */
  card(thread: string): StubMessage | undefined;
  /** Messages posted in a thread, after its starter. */
  posts(thread: string): StubMessage[];
  /** Deliver an interaction over the gateway, as Discord does when somebody uses a command. */
  interact(interaction: Partial<Interaction> & { type: number }): Interaction;
  /** Delete a thread and its messages, as a moderator in Discord would. */
  deleteThread(thread: string): void;
  /** Wait for the bridge's answers to an interaction: the callback, then any edits of it. */
  answers(interaction: string, count?: number): Promise<StubResponse[]>;
  /** Close every gateway connection with this code, as Discord does when it reconnects a bot. */
  drop(code: number): void;
  /** Set the heartbeat interval sent in HELLO, before a connection is made. */
  heartbeatMs: number;
  /** The `resume_gateway_url` READY gives; the stub's own gateway when null. */
  resumeUrl: string | null;
  /** Stop answering heartbeats, as a dead connection does. */
  silent: boolean;
  /** Make the open connections ignore everything, a close included, as a peer that is gone does. */
  deafen(): void;
  /** Whether a gateway connection has identified or resumed and is open now. */
  connected(): boolean;
  /** Wait until a gateway connection is up. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export async function startStubDiscord(
  opts: { forumTags?: ForumTag[]; manageChannels?: boolean } = {},
): Promise<StubDiscord> {
  let nextId = 200000000000000000n;
  const mint = (): string => String(nextId++);
  const requests: RecordedRequest[] = [];
  const channels = new Map<string, Channel>();
  const messages = new Map<string, StubMessage[]>();
  const responses: StubResponse[] = [];
  const faults: Fault[] = [];
  const sockets = new Set<GatewaySocket>();
  const waiters: (() => void)[] = [];
  let sequence = 0;

  channels.set(FORUM, {
    id: FORUM,
    type: 15,
    guild_id: GUILD,
    name: "tracker",
    available_tags: opts.forumTags ?? [],
  });
  channels.set(TEXT, { id: TEXT, type: 0, guild_id: GUILD, name: "issues" });
  channels.set(VOICE, { id: VOICE, type: 2, guild_id: GUILD, name: "standup" });
  channels.set(ELSEWHERE, {
    id: ELSEWHERE,
    type: 15,
    guild_id: "100000000000000099",
    name: "somebody else's",
    available_tags: [],
  });
  /** Messages by nonce, as Discord keeps them for a few minutes to refuse a second. */
  const nonces = new Map<string, StubMessage>();

  const stub: StubDiscord = {
    url: "",
    requests,
    channels,
    messages,
    commands: null,
    responses,
    identifies: 0,
    resumes: 0,
    heartbeatMs: 45_000,
    resumeUrl: null,
    silent: false,
    clearFaults() {
      faults.splice(0);
    },
    fail(method, path, status, more = {}) {
      faults.push({
        method,
        path,
        status,
        body: more.body ?? { message: "refused by the stub", code: 0 },
        headers: more.headers ?? {},
        times: more.times ?? 1,
        skip: more.skip ?? 0,
        apply: more.apply ?? false,
      });
    },
    threadsOf(parent) {
      return [...channels.values()].filter((channel) => channel.parent_id === parent);
    },
    card(thread) {
      const channel = channels.get(thread);
      if (channel === undefined) return undefined;
      const where = channel.parent_id === FORUM ? thread : (channel.parent_id ?? "");
      return messages.get(where)?.find((message) => message.id === thread);
    },
    posts(thread) {
      return (messages.get(thread) ?? []).filter((message) => message.id !== thread);
    },
    deleteThread(thread) {
      const channel = channels.get(thread);
      channels.delete(thread);
      messages.delete(thread);
      if (channel?.parent_id) {
        const list = messages.get(channel.parent_id) ?? [];
        messages.set(
          channel.parent_id,
          list.filter((message) => message.id !== thread),
        );
      }
    },
    interact(partial) {
      const interaction: Interaction = {
        id: mint(),
        application_id: APP,
        token: `token-${mint()}`,
        guild_id: GUILD,
        ...partial,
      } as Interaction;
      for (const socket of sockets) {
        if (socket.ready) socket.dispatch("INTERACTION_CREATE", interaction);
      }
      return interaction;
    },
    async answers(interaction, count = 1) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const found = responses.filter((response) => response.interaction === interaction);
        if (found.length >= count) return found;
        if (Date.now() > deadline) {
          throw new Error(`the bridge gave ${found.length} of ${count} answers to ${interaction}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    drop(code) {
      for (const socket of sockets) socket.close(code, "dropped by the stub");
    },
    deafen() {
      for (const socket of sockets) socket.deaf = true;
    },
    connected() {
      return [...sockets].some((socket) => socket.ready);
    },
    async ready() {
      const deadline = Date.now() + 10_000;
      while (!stub.connected()) {
        if (Date.now() > deadline) throw new Error("the bridge never connected to the gateway");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      // A client's kept-alive connections would otherwise hold the close open.
      server.closeAllConnections();
      await closed;
    },
  };

  const post = (channel: string, body: MessageBody, id = mint()): StubMessage => {
    const message: StubMessage = {
      id,
      channel_id: channel,
      content: body.content ?? "",
      embeds: body.embeds ?? [],
      components: body.components ?? [],
      ...(body.allowed_mentions === undefined ? {} : { allowed_mentions: body.allowed_mentions }),
      author: { id: BOT, username: "navbook", bot: true },
      edits: 0,
    };
    const list = messages.get(channel) ?? [];
    list.push(message);
    messages.set(channel, list);
    return message;
  };

  const routes: [string, RegExp, (match: RegExpExecArray, body: unknown) => [number, unknown]][] = [
    ["GET", /^\/gateway\/bot$/, () => [200, { url: stub.url.replace(/^http/, "ws") }]],
    [
      "GET",
      /^\/channels\/(\d+)$/,
      (m) => {
        const channel = channels.get(m[1] as string);
        return channel ? [200, channel] : [404, { message: "Unknown Channel", code: 10003 }];
      },
    ],
    [
      "PATCH",
      /^\/channels\/(\d+)$/,
      (m, body) => {
        const channel = channels.get(m[1] as string);
        if (!channel) return [404, { message: "Unknown Channel", code: 10003 }];
        const patch = body as Record<string, unknown>;
        if (patch.available_tags !== undefined) {
          if (opts.manageChannels === false) {
            return [403, { message: "Missing Permissions", code: 50013 }];
          }
          channel.available_tags = (patch.available_tags as ForumTag[]).map((tag) => ({
            ...tag,
            id: tag.id ?? mint(),
          }));
        }
        // As Discord does: an archived thread is changed only by the request
        // that opens it again.
        if (
          channel.thread_metadata?.archived &&
          patch.archived !== false &&
          (patch.name !== undefined || patch.applied_tags !== undefined)
        ) {
          return [400, { message: "Thread is archived", code: 50083 }];
        }
        if (typeof patch.name === "string") channel.name = patch.name;
        if (Array.isArray(patch.applied_tags)) channel.applied_tags = patch.applied_tags;
        if (channel.thread_metadata) {
          if (typeof patch.archived === "boolean") {
            channel.thread_metadata.archived = patch.archived;
          }
          if (typeof patch.locked === "boolean") channel.thread_metadata.locked = patch.locked;
        }
        return [200, channel];
      },
    ],
    [
      "POST",
      /^\/channels\/(\d+)\/threads$/,
      (m, body) => {
        const parent = channels.get(m[1] as string);
        if (parent?.type !== 15) {
          return [400, { message: "not a forum", code: 50024 }];
        }
        const request = body as { name: string; message: MessageBody; applied_tags?: string[] };
        const id = mint();
        const thread: Channel = {
          id,
          type: 11,
          guild_id: GUILD,
          parent_id: parent.id,
          name: request.name,
          applied_tags: request.applied_tags ?? [],
          thread_metadata: { archived: false, locked: false },
        };
        channels.set(id, thread);
        const message = post(id, request.message, id);
        return [201, { ...thread, message }];
      },
    ],
    [
      "POST",
      /^\/channels\/(\d+)\/messages\/(\d+)\/threads$/,
      (m, body) => {
        const parent = channels.get(m[1] as string);
        const starter = messages.get(m[1] as string)?.find((message) => message.id === m[2]);
        if (!parent || !starter) return [404, { message: "Unknown Message", code: 10008 }];
        if (channels.has(starter.id)) {
          return [
            400,
            { message: "A thread has already been created for this message", code: 160004 },
          ];
        }
        const thread: Channel = {
          id: starter.id,
          type: 11,
          guild_id: GUILD,
          parent_id: parent.id,
          name: (body as { name: string }).name,
          thread_metadata: { archived: false, locked: false },
        };
        channels.set(thread.id, thread);
        return [201, thread];
      },
    ],
    [
      "POST",
      /^\/channels\/(\d+)\/messages$/,
      (m, body) => {
        const channel = channels.get(m[1] as string);
        if (!channel) return [404, { message: "Unknown Channel", code: 10003 }];
        if (channel.thread_metadata?.archived) {
          if (channel.thread_metadata.locked) {
            return [400, { message: "Thread is locked", code: 50083 }];
          }
          // Posting in an archived thread brings it back, as Discord does.
          channel.thread_metadata.archived = false;
        }
        const request = body as MessageBody & { nonce?: string; enforce_nonce?: boolean };
        if (request.enforce_nonce && request.nonce !== undefined) {
          const made = nonces.get(`${channel.id}:${request.nonce}`);
          if (made !== undefined) return [200, made];
        }
        const made = post(channel.id, request);
        if (request.nonce !== undefined) nonces.set(`${channel.id}:${request.nonce}`, made);
        return [200, made];
      },
    ],
    [
      "DELETE",
      /^\/channels\/(\d+)\/messages\/(\d+)$/,
      (m) => {
        const list = messages.get(m[1] as string) ?? [];
        const index = list.findIndex((message) => message.id === m[2]);
        if (index === -1) return [404, { message: "Unknown Message", code: 10008 }];
        list.splice(index, 1);
        return [204, null];
      },
    ],
    [
      "PATCH",
      /^\/channels\/(\d+)\/messages\/(\d+)$/,
      (m, body) => {
        const channel = channels.get(m[1] as string);
        if (channel?.thread_metadata?.archived) {
          return [400, { message: "Thread is archived", code: 50083 }];
        }
        const message = messages.get(m[1] as string)?.find((each) => each.id === m[2]);
        if (!message) return [404, { message: "Unknown Message", code: 10008 }];
        const edit = body as MessageBody;
        if (edit.content !== undefined) message.content = edit.content;
        if (edit.embeds !== undefined) message.embeds = edit.embeds;
        if (edit.components !== undefined) message.components = edit.components;
        message.edits++;
        return [200, message];
      },
    ],
    [
      "GET",
      /^\/guilds\/(\d+)\/threads\/active$/,
      () => [
        200,
        {
          threads: [...channels.values()].filter(
            (channel) => channel.type === 11 && !channel.thread_metadata?.archived,
          ),
          members: [],
        },
      ],
    ],
    [
      "GET",
      /^\/channels\/(\d+)\/threads\/archived\/public/,
      (m) => [
        200,
        {
          threads: stub
            .threadsOf(m[1] as string)
            .filter((thread) => thread.thread_metadata?.archived),
          members: [],
          has_more: false,
        },
      ],
    ],
    [
      "PUT",
      /^\/applications\/(\d+)\/guilds\/(\d+)\/commands$/,
      (_m, body) => {
        stub.commands = body as unknown[];
        return [200, body];
      },
    ],
    [
      "POST",
      /^\/interactions\/(\d+)\/([^/]+)\/callback$/,
      (m, body) => {
        const callback = body as { type: number; data?: unknown };
        responses.push({ interaction: m[1] as string, type: callback.type, data: callback.data });
        return [204, null];
      },
    ],
    [
      "PATCH",
      /^\/webhooks\/(\d+)\/([^/]+)\/messages\/@original$/,
      (m, body) => {
        const interaction = interactionOfToken(m[2] as string);
        responses.push({ interaction, type: -1, data: body });
        return [200, { id: mint(), channel_id: "0", content: "" }];
      },
    ],
  ];

  /** Tokens are `token-<n>` and interaction ids `n - 1`: what `interact` minted together. */
  const interactionOfToken = (token: string): string => {
    const minted = /^token-(\d+)$/.exec(token);
    return minted ? String(BigInt(minted[1] as string) - 1n) : token;
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = (request.url ?? "").replace(/^\/api\/v10/, "");
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      try {
        body = text === "" ? null : JSON.parse(text);
      } catch {
        body = text;
      }
      const method = request.method ?? "GET";
      requests.push({
        method,
        path,
        body,
        auth: request.headers.authorization ?? null,
        agent: request.headers["user-agent"] ?? null,
      });

      let fault = faults.find((each) => each.method === method && each.path.test(path));
      if (fault !== undefined && fault.skip > 0) {
        fault.skip--;
        fault = undefined;
      }
      if (fault !== undefined) {
        fault.times--;
        if (fault.times <= 0) faults.splice(faults.indexOf(fault), 1);
        if (!fault.apply) {
          response.writeHead(fault.status, {
            "content-type": "application/json",
            ...fault.headers,
          });
          response.end(JSON.stringify(fault.body));
          return;
        }
      }
      for (const [verb, pattern, handle] of routes) {
        const match = pattern.exec(path.split("?")[0] ?? path);
        if (verb !== method || match === null) continue;
        const done = handle(match, body);
        const [status, answer] = fault === undefined ? done : [fault.status, fault.body];
        if (status === 204) {
          response.writeHead(204);
          response.end();
        } else {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(answer));
        }
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: `no stub route for ${method} ${path}`, code: 0 }));
    });
  });

  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const gateway = new GatewaySocket(
      socket,
      stub,
      () => ++sequence,
      () => {
        for (const waiter of waiters.splice(0)) waiter();
      },
    );
    sockets.add(gateway);
    socket.on("close", () => sockets.delete(gateway));
    gateway.send({ op: 10, d: { heartbeat_interval: stub.heartbeatMs } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  stub.url = `http://127.0.0.1:${port}/api/v10`;
  return stub;
}

/** One gateway connection: frames in, frames out, and Discord's side of the protocol. */
class GatewaySocket {
  ready = false;
  /** Gone without saying so: nothing it is sent is answered. */
  deaf = false;
  private buffer = Buffer.alloc(0);
  private readonly socket: Socket;
  private readonly stub: StubDiscord;
  private readonly next: () => number;
  private readonly changed: () => void;

  constructor(socket: Socket, stub: StubDiscord, next: () => number, changed: () => void) {
    this.socket = socket;
    this.stub = stub;
    this.next = next;
    this.changed = changed;
    socket.on("data", (chunk: Buffer) => this.read(chunk));
    socket.on("error", () => undefined);
  }

  send(payload: unknown): void {
    this.frame(1, Buffer.from(JSON.stringify(payload), "utf8"));
  }

  dispatch(event: string, data: unknown): void {
    this.send({ op: 0, t: event, s: this.next(), d: data });
  }

  close(code: number, reason: string): void {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.frame(8, payload);
    this.ready = false;
    this.socket.end();
  }

  destroy(): void {
    this.ready = false;
    this.socket.destroy();
  }

  private frame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const opcode = (this.buffer[0] as number) & 0x0f;
      const masked = ((this.buffer[1] as number) & 0x80) !== 0;
      let length = (this.buffer[1] as number) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      if (mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = (payload[i] as number) ^ (mask[i % 4] as number);
        }
      }
      this.buffer = this.buffer.subarray(offset + length);
      this.handle(opcode, payload);
    }
  }

  private handle(opcode: number, payload: Buffer): void {
    if (this.deaf) return;
    if (opcode === 8) {
      this.ready = false;
      this.frame(8, payload.subarray(0, 2));
      this.socket.end();
      return;
    }
    if (opcode === 9) {
      this.frame(10, payload);
      return;
    }
    if (opcode !== 1) return;
    const message = JSON.parse(payload.toString("utf8")) as { op: number; d: unknown };
    switch (message.op) {
      case 1:
        if (!this.stub.silent) this.send({ op: 11 });
        return;
      case 2:
        this.stub.identifies++;
        this.ready = true;
        this.dispatch("READY", {
          v: 10,
          session_id: `session-${this.stub.identifies}`,
          resume_gateway_url: this.stub.resumeUrl ?? this.stub.url.replace(/^http/, "ws"),
          user: { id: BOT, username: "navbook", bot: true },
          application: { id: APP },
          guilds: [{ id: GUILD, unavailable: true }],
        });
        this.changed();
        return;
      case 6:
        this.stub.resumes++;
        this.ready = true;
        this.dispatch("RESUMED", null);
        this.changed();
        return;
      default:
        return;
    }
  }
}
