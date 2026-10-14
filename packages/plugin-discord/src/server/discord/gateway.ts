/**
 * Discord's gateway: the websocket interactions and thread events arrive on.
 *
 * An outbound connection, so a server behind NAT with no public address can
 * still be a bot — the reason the bridge uses it rather than an interactions
 * endpoint Discord would have to reach. Discord's protocol
 * (https://docs.discord.com/developers/events/gateway), as much of it as one
 * bot in one guild needs: say hello, keep the heartbeat, identify once and
 * resume after that, and reconnect when the connection drops.
 *
 * Identifying is budgeted — a thousand a day, after which Discord resets the
 * token — so a dropped connection resumes the session it had whenever Discord
 * allows it, reconnects back off, and the closes that mean "this will never
 * work" (a bad token, an intent the application may not have) stop the loop
 * for good rather than spend the budget proving it.
 */

import type { DiscordRest } from "./rest.ts";
import { sleep } from "./rest.ts";
import {
  API_VERSION,
  type GatewayBot,
  GatewayOp,
  type GatewayPayload,
  type Ready,
} from "./types.ts";

export interface GatewayOptions {
  rest: DiscordRest;
  token: string;
  intents: number;
  report: (line: string) => void;
  /** Every event Discord dispatches, by name: `READY`, `INTERACTION_CREATE`, … */
  onDispatch: (event: string, data: unknown) => void;
  /** The first wait before reconnecting, doubled each time up to {@link maxBackoffMs}. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /**
   * How long a close the bridge sent may go unanswered before the connection
   * is given up on. A connection that died silently answers nothing, and the
   * socket would otherwise wait for TCP to notice — a quarter of an hour.
   */
  closeTimeoutMs?: number;
}

/** Close codes after which connecting again would fail the same way. */
const FATAL_CLOSES: Record<number, string> = {
  4004: "the token was refused",
  4010: "an invalid shard was sent",
  4011: "the bot is in too many guilds to connect unsharded",
  4012: "the gateway version is not one Discord serves",
  4013: "the intents are invalid",
  4014: "the application may not use the intents it asked for",
};

/** Close codes after which the session cannot be resumed and must be identified again. */
const NEW_SESSION_CLOSES = new Set([4007, 4009]);

/** The code the bridge closes with when it means to resume: anything but 1000 keeps the session. */
const RECONNECT_CLOSE = 4900;

export class DiscordGateway {
  private readonly opts: GatewayOptions;
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private sequence: number | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private acknowledged = true;
  private readonly stopper = new AbortController();
  private loop: Promise<void> | null = null;
  private connected = false;
  /** How each open connection's session is ended, by its socket. */
  private readonly enders = new Map<WebSocket, (close: { code: number; reason: string }) => void>();

  constructor(opts: GatewayOptions) {
    this.opts = opts;
  }

  /** True between a `READY` or `RESUMED` and the connection dropping. */
  get ready(): boolean {
    return this.connected;
  }

  /** Connect, and keep connecting, until {@link stop}. Returns at once. */
  start(): void {
    this.loop ??= this.run();
  }

  async stop(): Promise<void> {
    this.stopper.abort();
    this.stopHeartbeat();
    // 1000 ends the session: there is nothing to resume after a stop.
    if (this.socket !== null) this.hangUp(this.socket, 1000);
    await this.loop;
  }

  private async run(): Promise<void> {
    const initial = this.opts.backoffMs ?? 1_000;
    const max = this.opts.maxBackoffMs ?? 60_000;
    let backoff = initial;
    while (!this.stopper.signal.aborted) {
      let close: { code: number; reason: string } | null = null;
      const resuming = this.resumeUrl !== null;
      try {
        const url = this.resumeUrl ?? (await this.opts.rest.get<GatewayBot>("/gateway/bot")).url;
        close = await this.session(url, () => {
          backoff = initial;
        });
      } catch (error) {
        if (this.stopper.signal.aborted) return;
        this.opts.report(
          `could not reach Discord's gateway: ${error instanceof Error ? error.message : String(error)}`,
        );
        // The address to resume at is unreachable: start a new session at
        // the one Discord gives now, rather than knock at that one for ever.
        if (resuming) this.forgetSession();
      }
      if (this.stopper.signal.aborted) return;
      if (close !== null) {
        const fatal = FATAL_CLOSES[close.code];
        if (fatal !== undefined) {
          this.opts.report(
            `Discord closed the gateway for good (${close.code}): ${fatal}; the bridge will not reconnect`,
          );
          return;
        }
        if (NEW_SESSION_CLOSES.has(close.code)) this.forgetSession();
      }
      try {
        await sleep(backoff, this.stopper.signal);
      } catch {
        return;
      }
      backoff = Math.min(backoff * 2, max);
    }
  }

  /** One connection, from opening to closing. Resolves with how it closed. */
  private session(url: string, established: () => void): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url.replace(/\/+$/, "")}/?v=${API_VERSION}&encoding=json`);
      this.socket = socket;
      let opened = false;
      const end = (close: { code: number; reason: string }): void => {
        if (!this.enders.has(socket)) return;
        this.enders.delete(socket);
        this.stopHeartbeat();
        this.connected = false;
        if (this.socket === socket) this.socket = null;
        resolve(close);
      };
      this.enders.set(socket, end);
      socket.addEventListener("open", () => {
        opened = true;
      });
      socket.addEventListener("message", (event) => {
        // A connection given up on says nothing more the bridge acts on.
        if (!this.enders.has(socket)) return;
        let payload: GatewayPayload;
        try {
          payload = JSON.parse(String(event.data)) as GatewayPayload;
        } catch {
          return;
        }
        this.receive(payload, socket, established);
      });
      socket.addEventListener("close", (event) => {
        end({ code: event.code, reason: event.reason });
      });
      socket.addEventListener("error", () => {
        // A socket that never opened will not close either: say why it failed.
        if (!opened && this.enders.delete(socket)) reject(new Error(`could not connect to ${url}`));
      });
    });
  }

  private receive(payload: GatewayPayload, socket: WebSocket, established: () => void): void {
    if (typeof payload.s === "number") this.sequence = payload.s;
    switch (payload.op) {
      case GatewayOp.Hello: {
        const interval = (payload.d as { heartbeat_interval?: number })?.heartbeat_interval;
        this.startHeartbeat(socket, typeof interval === "number" ? interval : 41_250);
        this.identify(socket);
        return;
      }
      case GatewayOp.HeartbeatAck:
        this.acknowledged = true;
        return;
      case GatewayOp.Heartbeat:
        this.send(socket, { op: GatewayOp.Heartbeat, d: this.sequence });
        return;
      case GatewayOp.Reconnect:
        this.hangUp(socket, RECONNECT_CLOSE);
        return;
      case GatewayOp.InvalidSession:
        // `d` says whether the session can still be resumed.
        if (payload.d !== true) this.forgetSession();
        this.hangUp(socket, RECONNECT_CLOSE);
        return;
      case GatewayOp.Dispatch: {
        const event = payload.t ?? "";
        if (event === "READY") {
          const ready = payload.d as Ready;
          this.sessionId = ready.session_id;
          this.resumeUrl = ready.resume_gateway_url;
        }
        if (event === "READY" || event === "RESUMED") {
          this.connected = true;
          established();
        }
        try {
          this.opts.onDispatch(event, payload.d);
        } catch (error) {
          this.opts.report(
            `handling ${event} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }
      default:
        return;
    }
  }

  private identify(socket: WebSocket): void {
    if (this.sessionId !== null && this.sequence !== null) {
      this.send(socket, {
        op: GatewayOp.Resume,
        d: { token: this.opts.token, session_id: this.sessionId, seq: this.sequence },
      });
      return;
    }
    this.send(socket, {
      op: GatewayOp.Identify,
      d: {
        token: this.opts.token,
        intents: this.opts.intents,
        properties: { os: process.platform, browser: "navbook", device: "navbook" },
      },
    });
  }

  /**
   * Beat every `interval`, the first after a random part of one as Discord
   * asks; a beat that finds the last unanswered means the connection is dead
   * without having said so, and it is closed to be resumed.
   */
  private startHeartbeat(socket: WebSocket, interval: number): void {
    this.stopHeartbeat();
    this.acknowledged = true;
    const beat = (): void => {
      if (!this.acknowledged) {
        this.hangUp(socket, RECONNECT_CLOSE);
        return;
      }
      this.acknowledged = false;
      this.send(socket, { op: GatewayOp.Heartbeat, d: this.sequence });
      this.heartbeat = setTimeout(beat, interval);
    };
    this.heartbeat = setTimeout(beat, Math.floor(interval * Math.random()));
  }

  /**
   * Close a connection, and give up on it if the close goes unanswered: its
   * session ends either way, so a reconnect — or a stop — is not held up by
   * a peer that is no longer there.
   */
  private hangUp(socket: WebSocket, code: number): void {
    try {
      socket.close(code);
    } catch {
      // Already closing: the timer below still ends it.
    }
    const end = this.enders.get(socket);
    if (end === undefined) return;
    const timer = setTimeout(
      () => end({ code, reason: "the close went unanswered" }),
      this.opts.closeTimeoutMs ?? 3_000,
    );
    timer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearTimeout(this.heartbeat);
    this.heartbeat = null;
  }

  private forgetSession(): void {
    this.sessionId = null;
    this.resumeUrl = null;
    this.sequence = null;
  }

  private send(socket: WebSocket, payload: GatewayPayload): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}
