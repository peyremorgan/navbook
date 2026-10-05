/**
 * A real `nav-server` running the bridge, a real origin, and a Discord on
 * 127.0.0.1: what the server tests start, and wait on.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Harness, type HarnessOptions, startHarness } from "@navbook/server/test-helpers";
import { FORUM, GUILD, type StubDiscord, startStubDiscord, TEXT } from "./stub-discord.ts";

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Settings that give every pull request a forum post and every new issue a thread in the text channel. */
export const SETTINGS = {
  guild: GUILD,
  url: "https://tracker.example",
  prs: { channel: FORUM },
  issues: [{ channel: TEXT, on: ["open"] }],
};

export interface Bridged {
  stub: StubDiscord;
  harness: Harness;
  /** Wait until the bridge's gateway is connected and its commands registered. */
  connected(): Promise<void>;
  stop(): Promise<void>;
}

export interface BridgedOptions {
  settings?: Record<string, unknown>;
  pullIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
  stub?: StubDiscord;
  harness?: Omit<HarnessOptions, "marker" | "env" | "pullIntervalMs">;
}

/** The marker declaring the plugin with `settings`. */
export function markerWith(settings: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-discord": settings } }, null, 2)}\n`;
}

/** Start both, and wait for the bridge's first look at the tracker. */
export async function startBridged(opts: BridgedOptions = {}): Promise<Bridged> {
  const stub = opts.stub ?? (await startStubDiscord());
  const harness = await startHarness({
    ...opts.harness,
    marker: markerWith(opts.settings ?? SETTINGS),
    pullIntervalMs: opts.pullIntervalMs ?? 200,
    env: {
      NAVBOOK_PLUGIN_PATH: PLUGIN,
      NAV_SERVER_DISCORD_TOKEN: "t0ken",
      NAV_SERVER_DISCORD_API_URL: stub.url,
      ...opts.env,
    },
  });
  try {
    await eventually(
      () => /following \d+ issues and pull requests, \d+ with a thread/.test(harness.stderr()),
      () => harness.stderr(),
    );
  } catch (error) {
    await harness.stop();
    if (opts.stub === undefined) await stub.close();
    throw error;
  }
  return {
    stub,
    harness,
    async connected() {
      await stub.ready();
      await eventually(
        () => stub.commands !== null,
        () => harness.stderr(),
      );
    },
    async stop() {
      await harness.stop();
      if (opts.stub === undefined) await stub.close();
    },
  };
}

/** Ask until `probe` holds, or fail after a few seconds saying what was seen. */
export async function eventually(
  probe: () => boolean,
  what: () => string = () => "",
  ms = 10_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`never happened:\n${what()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
