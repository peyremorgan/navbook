/**
 * The bridge's own Discord client, against a Discord on 127.0.0.1.
 *
 * What is pinned is what a real Discord would punish: a request sent into a
 * spent bucket, a 429 not waited out, a create sent twice, a reconnect that
 * identifies again when it could have resumed, a fatal close retried forever.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { DiscordGateway } from "../src/server/discord/gateway.ts";
import { DiscordError, DiscordRest, routeKey, sleep } from "../src/server/discord/rest.ts";
import { INTENT_GUILDS } from "../src/server/discord/types.ts";
import { FORUM, type StubDiscord, startStubDiscord, TEXT } from "./helpers/stub-discord.ts";

let stub: StubDiscord;
before(async () => {
  stub = await startStubDiscord();
});
after(async () => {
  await stub.close();
});
afterEach(() => stub.clearFaults());

const rest = (more: Partial<ConstructorParameters<typeof DiscordRest>[0]> = {}): DiscordRest =>
  new DiscordRest({ token: "t0ken", apiUrl: stub.url, ...more });

describe("the REST client", () => {
  it("sends the bot's token, and JSON, and reads JSON back", async () => {
    const channel = await rest().get<{ id: string; type: number }>(`/channels/${FORUM}`);
    assert.equal(channel.type, 15);
    const last = stub.requests.at(-1);
    assert.equal(last?.auth, "Bot t0ken");
  });

  it("never sends the token where an interaction's own token authorises the request", async () => {
    await rest().post("/interactions/123456789012345678/tok/callback", { type: 5 });
    assert.equal(stub.requests.at(-1)?.auth, null);
    await rest().patch("/webhooks/123456789012345678/tok/messages/@original", { content: "x" });
    assert.equal(stub.requests.at(-1)?.auth, null);
  });

  it("names Discord's refusal, with its code", async () => {
    await assert.rejects(rest().get("/channels/999999999999999999"), (error: unknown) => {
      assert.ok(error instanceof DiscordError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 10003);
      assert.match(error.message, /404 to GET \/channels\/999999999999999999: Unknown Channel/);
      return true;
    });
  });

  it("waits out a 429 and sends the request again", async () => {
    stub.fail("GET", new RegExp(`^/channels/${TEXT}$`), 429, {
      body: { message: "You are being rate limited.", retry_after: 0.15, global: false },
    });
    const started = Date.now();
    const channel = await rest().get<{ id: string }>(`/channels/${TEXT}`);
    assert.equal(channel.id, TEXT);
    assert.ok(Date.now() - started >= 140, "did not wait as long as it was told");
  });

  it("holds every route after a global limit", async () => {
    const client = rest();
    stub.fail("GET", new RegExp(`^/channels/${TEXT}$`), 429, {
      body: { message: "global", retry_after: 0.2, global: true },
    });
    const started = Date.now();
    const limited = client.get(`/channels/${TEXT}`);
    await sleep(30);
    // Another route, sent while the first waits: it waits too.
    await client.get(`/channels/${FORUM}`);
    assert.ok(Date.now() - started >= 190, "a global limit did not hold the other route");
    await limited;
  });

  it("waits for a bucket the headers said was spent before sending into it", async () => {
    const client = rest();
    stub.fail("GET", new RegExp(`^/channels/${FORUM}$`), 200, {
      body: { id: FORUM, type: 15 },
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.2" },
    });
    await client.get(`/channels/${FORUM}`);
    const started = Date.now();
    await client.get(`/channels/${FORUM}`);
    assert.ok(Date.now() - started >= 190, "sent into a spent bucket");
  });

  it("gives up on a route that stays limited, rather than retrying for ever", async () => {
    stub.fail("GET", new RegExp(`^/channels/${TEXT}$`), 429, {
      body: { message: "slow down", retry_after: 0.01 },
      times: 10,
    });
    await assert.rejects(rest({ maxRetries: 2 }).get(`/channels/${TEXT}`), /429/);
  });

  it("tries a read again after a server error, and never a create", async () => {
    stub.fail("GET", new RegExp(`^/channels/${TEXT}$`), 502);
    assert.equal((await rest().get<{ id: string }>(`/channels/${TEXT}`)).id, TEXT);

    const before = stub.requests.length;
    stub.fail("POST", new RegExp(`^/channels/${TEXT}/messages$`), 502);
    await assert.rejects(rest().post(`/channels/${TEXT}/messages`, { content: "once" }), /502/);
    assert.equal(stub.requests.length - before, 1, "a create that may have landed was sent again");
  });

  it("keeps one route's requests in order", async () => {
    const client = rest();
    const sent = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((content) =>
        client.post<{ content: string }>(`/channels/${TEXT}/messages`, { content }),
      ),
    );
    assert.deepEqual(
      sent.map((message) => message.content),
      ["a", "b", "c", "d", "e", "f"],
    );
    const posted = (stub.messages.get(TEXT) ?? []).map((message) => message.content);
    assert.deepEqual(posted.slice(-6), ["a", "b", "c", "d", "e", "f"]);
  });

  it("stops waiting when told to stop", async () => {
    const stopper = new AbortController();
    stub.fail("GET", new RegExp(`^/channels/${TEXT}$`), 429, {
      body: { message: "slow", retry_after: 30 },
    });
    const waiting = rest({ signal: stopper.signal }).get(`/channels/${TEXT}`);
    await sleep(50);
    stopper.abort(new Error("stopping"));
    await assert.rejects(waiting, /stopping/);
  });

  it("groups routes as Discord buckets them: by method, route and major id", () => {
    assert.equal(
      routeKey("POST", "/channels/111111111111111111/messages"),
      "POST /channels/111111111111111111/messages",
    );
    assert.equal(
      routeKey("PATCH", "/channels/111111111111111111/messages/222222222222222222"),
      "PATCH /channels/111111111111111111/messages/:id",
    );
    assert.notEqual(
      routeKey("POST", "/channels/111111111111111111/messages"),
      routeKey("POST", "/channels/333333333333333333/messages"),
    );
    assert.notEqual(
      routeKey("POST", "/interactions/444444444444444444/one/callback"),
      routeKey("POST", "/interactions/555555555555555555/two/callback"),
    );
  });
});

describe("the gateway client", () => {
  function gateway(events: string[], reported: string[] = []): DiscordGateway {
    return new DiscordGateway({
      rest: rest(),
      token: "t0ken",
      intents: INTENT_GUILDS,
      report: (line) => reported.push(line),
      onDispatch: (event) => events.push(event),
      backoffMs: 20,
      maxBackoffMs: 50,
    });
  }

  it("identifies once, then resumes the same session after a drop", async () => {
    const events: string[] = [];
    const client = gateway(events);
    const identified = stub.identifies;
    const resumed = stub.resumes;
    client.start();
    try {
      await stub.ready();
      await waitFor(() => client.ready);
      assert.deepEqual(events, ["READY"]);
      assert.equal(stub.identifies - identified, 1);

      stub.drop(4000);
      await waitFor(() => events.includes("RESUMED"));
      assert.equal(stub.identifies - identified, 1, "identified again rather than resuming");
      assert.equal(stub.resumes - resumed, 1);

      const interaction = stub.interact({ type: 2, data: { name: "nav" } });
      await waitFor(() => events.includes("INTERACTION_CREATE"));
      assert.ok(interaction.id);
    } finally {
      await client.stop();
    }
    assert.equal(client.ready, false);
  });

  it("identifies afresh when the session can no longer be resumed", async () => {
    const events: string[] = [];
    const client = gateway(events);
    client.start();
    try {
      await waitFor(() => client.ready);
      const identified = stub.identifies;
      stub.drop(4009);
      await waitFor(() => stub.identifies === identified + 1 && client.ready);
      assert.deepEqual(events, ["READY", "READY"]);
    } finally {
      await client.stop();
    }
  });

  it("does not reconnect after a close that would fail the same way again", async () => {
    const reported: string[] = [];
    const client = gateway([], reported);
    client.start();
    try {
      await waitFor(() => client.ready);
      const identified = stub.identifies;
      stub.drop(4004);
      await waitFor(() =>
        reported.some((line) => /for good \(4004\): the token was refused/.test(line)),
      );
      await sleep(150);
      assert.equal(stub.identifies, identified);
      assert.equal(client.ready, false);
    } finally {
      await client.stop();
    }
  });

  it("reconnects a connection whose heartbeats go unanswered", async () => {
    stub.heartbeatMs = 60;
    const events: string[] = [];
    const client = gateway(events);
    client.start();
    try {
      await waitFor(() => client.ready);
      const resumed = stub.resumes;
      stub.silent = true;
      await waitFor(() => stub.resumes > resumed, 3_000);
      assert.ok(events.includes("RESUMED"));
    } finally {
      stub.silent = false;
      stub.heartbeatMs = 45_000;
      await client.stop();
    }
  });

  it("keeps trying while the gateway cannot be reached, and stops when told", async () => {
    const reported: string[] = [];
    const client = new DiscordGateway({
      rest: new DiscordRest({ token: "t0ken", apiUrl: "http://127.0.0.1:9/api/v10" }),
      token: "t0ken",
      intents: INTENT_GUILDS,
      report: (line) => reported.push(line),
      onDispatch: () => undefined,
      backoffMs: 10,
      maxBackoffMs: 20,
    });
    client.start();
    await waitFor(() => reported.length >= 2);
    assert.match(reported[0] ?? "", /could not reach Discord's gateway/);
    await client.stop();
  });
});

async function waitFor(condition: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("never happened");
    await sleep(10);
  }
}
