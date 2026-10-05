/**
 * Discord's HTTP API, over `fetch`.
 *
 * Discord limits requests per route and globally, and says so in headers
 * (https://docs.discord.com/developers/topics/rate-limits): a route whose
 * bucket is spent answers 429 with how long to wait. A client that ignored
 * that would be told to wait more, and one that kept going regardless — ten
 * thousand refused requests in ten minutes — is banned by IP for a while. So
 * requests to one route go one at a time, a spent bucket is waited out before
 * the next, a 429 is waited out and the request tried again, and a global
 * limit stops every route.
 *
 * Creating a message is not idempotent, and a 5xx may come after Discord made
 * it: so only reads and edits are tried again after one; a create's failure is
 * the caller's to report.
 */

import { DEFAULT_API_URL } from "./types.ts";

export interface RestOptions {
  token: string;
  /** Discord's API, e.g. a stub's in a test; {@link DEFAULT_API_URL} otherwise. */
  apiUrl?: string;
  /** How many requests may be in flight at once, across routes. */
  concurrency?: number;
  /** How many times a request refused with 429 is tried again before giving up. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Stops every wait and request in flight, when the bridge stops. */
  signal?: AbortSignal;
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** A request Discord refused or could not answer. */
export class DiscordError extends Error {
  readonly status: number;
  /** Discord's own error code (e.g. 10003, unknown channel), when it sent one. */
  readonly code: number | null;

  constructor(method: Method, route: string, status: number, code: number | null, detail: string) {
    super(`Discord answered ${status} to ${method} ${route}${detail === "" ? "" : `: ${detail}`}`);
    this.name = "DiscordError";
    this.status = status;
    this.code = code;
  }
}

const USER_AGENT = "DiscordBot (https://github.com/peyremorgan/navbook, 0.6.1)";

export class DiscordRest {
  private readonly token: string;
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly maxRetries: number;
  private readonly concurrency: number;
  private readonly signal: AbortSignal | undefined;
  /** Each route's queue: the promise its last request settles. */
  private readonly routes = new Map<string, Promise<unknown>>();
  /** Until when a route's bucket is spent, by route. */
  private readonly spent = new Map<string, number>();
  /** Until when every route must wait, after a global limit. */
  private globalUntil = 0;
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(opts: RestOptions) {
    this.token = opts.token;
    this.base = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetch = opts.fetch ?? fetch;
    this.maxRetries = opts.maxRetries ?? 5;
    this.concurrency = opts.concurrency ?? 4;
    this.signal = opts.signal;
  }

  get<T>(route: string): Promise<T> {
    return this.request<T>("GET", route);
  }

  post<T>(route: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", route, body);
  }

  patch<T>(route: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", route, body);
  }

  put<T>(route: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", route, body);
  }

  delete<T>(route: string): Promise<T> {
    return this.request<T>("DELETE", route);
  }

  /** One request, queued behind the others to its route. */
  request<T>(method: Method, route: string, body?: unknown): Promise<T> {
    const key = routeKey(method, route);
    const previous = this.routes.get(key) ?? Promise.resolve();
    const result = previous.then(
      () => this.send<T>(key, method, route, body),
      () => this.send<T>(key, method, route, body),
    );
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.routes.set(key, settled);
    // A route nobody is queued on any more is forgotten, or the map would hold
    // one entry per thread the bridge ever posted in.
    void settled.then(() => {
      if (this.routes.get(key) === settled) this.routes.delete(key);
    });
    return result;
  }

  private async send<T>(key: string, method: Method, route: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.waitUntil(Math.max(this.globalUntil, this.spent.get(key) ?? 0));
      const response = await this.slot(() => this.call(method, route, body));
      this.note(key, response);
      if (response.status === 429) {
        const { ms, global } = await retryAfter(response);
        const until = Date.now() + ms;
        if (global) this.globalUntil = until;
        else this.spent.set(key, until);
        if (attempt >= this.maxRetries) {
          throw new DiscordError(method, route, 429, null, "still limited after retrying");
        }
        continue;
      }
      if (response.status >= 500 && method !== "POST" && attempt === 0) {
        await this.waitUntil(Date.now() + 1_000);
        continue;
      }
      if (!response.ok) {
        const { code, message } = await errorOf(response);
        throw new DiscordError(method, route, response.status, code, message);
      }
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text === "" ? undefined : JSON.parse(text)) as T;
    }
  }

  private call(method: Method, route: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    // An interaction's reply is authorised by its token, in the route: the
    // bot's own token has no business there.
    if (!isInteractionRoute(route)) headers.Authorization = `Bot ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return this.fetch(`${this.base}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(this.signal === undefined ? {} : { signal: this.signal }),
    });
  }

  /** Remember a spent bucket from the headers every answer carries. */
  private note(key: string, response: Response): void {
    if (response.headers.get("x-ratelimit-remaining") !== "0") return;
    const after = Number(response.headers.get("x-ratelimit-reset-after"));
    if (Number.isFinite(after) && after > 0) this.spent.set(key, Date.now() + after * 1_000);
  }

  /** Run `body` once fewer than `concurrency` requests are in flight. */
  private async slot<T>(body: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.inFlight++;
    try {
      return await body();
    } finally {
      this.inFlight--;
      this.waiting.shift()?.();
    }
  }

  private waitUntil(until: number): Promise<void> {
    return sleep(until - Date.now(), this.signal);
  }
}

/**
 * The queue a request joins: its method and route, with every id but the
 * route's major one — the channel, guild or webhook it is about — made
 * generic, which is how Discord groups requests into buckets.
 */
export function routeKey(method: Method, route: string): string {
  // `/channels/123/messages/456`: segment 2 is the major id and stays; any id
  // after it is generic. An interaction's token, also in its route, is not an
  // id and stays too: one queue per interaction.
  const generic = (route.split("?")[0] ?? route)
    .split("/")
    .map((segment, index) => (index > 2 && /^\d{5,}$/.test(segment) ? ":id" : segment))
    .join("/");
  return `${method} ${generic}`;
}

function isInteractionRoute(route: string): boolean {
  return route.startsWith("/interactions/") || /^\/webhooks\/\d+\/[^/]+/.test(route);
}

/** How long a 429 says to wait, in milliseconds, and whether every route must. */
async function retryAfter(response: Response): Promise<{ ms: number; global: boolean }> {
  let seconds = Number(response.headers.get("retry-after"));
  let global = response.headers.get("x-ratelimit-global") === "true";
  try {
    const body = (await response.json()) as { retry_after?: number; global?: boolean };
    if (typeof body.retry_after === "number") seconds = body.retry_after;
    global ||= body.global === true;
  } catch {
    // A 429 from Cloudflare rather than Discord carries no JSON; the header says enough.
  }
  return {
    ms: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1_000) : 1_000,
    global,
  };
}

async function errorOf(response: Response): Promise<{ code: number | null; message: string }> {
  try {
    const body = (await response.json()) as { code?: number; message?: string };
    return {
      code: typeof body.code === "number" ? body.code : null,
      message: typeof body.message === "string" ? body.message : "",
    };
  } catch {
    return { code: null, message: "" };
  }
}

/**
 * Wait `ms`, or reject as soon as `signal` aborts — leaving no listener on it
 * either way, since one signal outlives every wait the bridge makes.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("stopped"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("stopped"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
