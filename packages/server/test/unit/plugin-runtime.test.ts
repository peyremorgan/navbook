/**
 * The plugin runtime's services: started in order, stopped in reverse.
 *
 * What is pinned is the failure path. A server whose third service refuses to
 * start never opens its port, and the two that did start must not be left
 * holding sockets behind it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginService } from "../../src/plugins/host.ts";
import { PluginRuntime } from "../../src/plugins/runtime.ts";

/** A service that records what was done to it, and can be told to fail. */
function service(
  name: string,
  log: string[],
  fail: { start?: boolean; stop?: boolean } = {},
): PluginService {
  return {
    name,
    async start() {
      if (fail.start) throw new Error(`${name} cannot start`);
      log.push(`start ${name}`);
    },
    async stop() {
      log.push(`stop ${name}`);
      if (fail.stop) throw new Error(`${name} cannot stop`);
    },
  };
}

function runtimeWith(...services: PluginService[]): { runtime: PluginRuntime; reported: string[] } {
  const reported: string[] = [];
  const runtime = new PluginRuntime((line) => reported.push(line));
  for (const each of services) runtime.addService(each);
  return { runtime, reported };
}

describe("plugin services", () => {
  it("start in registration order and stop in reverse", async () => {
    const log: string[] = [];
    const { runtime } = runtimeWith(service("a", log), service("b", log));
    await runtime.start();
    await runtime.stop();
    assert.deepEqual(log, ["start a", "start b", "stop b", "stop a"]);
  });

  it("stop the ones already started when one cannot start, and rethrow", async () => {
    const log: string[] = [];
    const { runtime } = runtimeWith(
      service("a", log),
      service("b", log),
      service("c", log, { start: true }),
      service("d", log),
    );
    await assert.rejects(runtime.start(), /c cannot start/);
    // `d` was never reached, and `c` never started, so neither is stopped.
    assert.deepEqual(log, ["start a", "start b", "stop b", "stop a"]);
  });

  it("do not stop twice, nor stop what never started", async () => {
    const log: string[] = [];
    const { runtime } = runtimeWith(service("a", log), service("b", log, { start: true }));
    await assert.rejects(runtime.start());
    await runtime.stop();
    assert.deepEqual(log, ["start a", "stop a"]);

    const idle = runtimeWith(service("x", log));
    await idle.runtime.stop();
    assert.deepEqual(log, ["start a", "stop a"]);
  });

  it("report a service that does not stop cleanly, and stop the rest", async () => {
    const log: string[] = [];
    const { runtime, reported } = runtimeWith(service("a", log), service("b", log, { stop: true }));
    await runtime.start();
    await runtime.stop();
    assert.deepEqual(log, ["start a", "start b", "stop b", "stop a"]);
    assert.ok(reported.some((line) => /'b' did not stop cleanly: b cannot stop/.test(line)));
  });
});
