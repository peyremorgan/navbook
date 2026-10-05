/**
 * The plugin runtime's services: started in order, stopped in reverse.
 *
 * What is pinned is the failure path. A server whose third service refuses to
 * start never opens its port, and the two that did start must not be left
 * holding sockets behind it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from "graphql";
import type { GraphQLCtx } from "../../src/context.ts";
import { Mutex } from "../../src/lock.ts";
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
  return runtimeTimed({}, ...services);
}

function runtimeTimed(
  opts: { stopTimeoutMs?: number },
  ...services: PluginService[]
): { runtime: PluginRuntime; reported: string[] } {
  const reported: string[] = [];
  const runtime = new PluginRuntime((line) => reported.push(line), opts);
  for (const each of services) runtime.addService(each);
  return { runtime, reported };
}

/** Enough turns of the event loop for anything that is going to run to have run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

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

  it("go on without a service that does not stop in time, and say so", async () => {
    const log: string[] = [];
    let late: () => void = () => undefined;
    const hung: PluginService = {
      name: "hung",
      start: async () => undefined,
      // Resolves only when the test says, long after the deadline; then fails.
      stop: () =>
        new Promise<void>((_resolve, reject) => {
          late = () => reject(new Error("too late to matter"));
        }),
    };
    const { runtime, reported } = runtimeTimed(
      { stopTimeoutMs: 20 },
      service("a", log),
      hung,
      service("b", log),
    );
    await runtime.start();
    const started = Date.now();
    await runtime.stop();
    assert.ok(Date.now() - started < 1_000, "waited past the deadline");
    assert.deepEqual(log, ["start a", "start b", "stop b", "stop a"]);
    assert.ok(
      reported.includes("plugin service 'hung' did not stop within 20 ms; going on without it"),
      reported.join("\n"),
    );
    // Its failure after the fact is nobody's unhandled rejection.
    late();
    await settle();
  });

  it("wait for a service that stops within the deadline, however slowly", async () => {
    const log: string[] = [];
    const slow: PluginService = {
      name: "slow",
      start: async () => undefined,
      stop: () => settle().then(() => void log.push("stop slow")),
    };
    const { runtime, reported } = runtimeTimed({ stopTimeoutMs: 1_000 }, slow, service("b", log));
    await runtime.start();
    await runtime.stop();
    assert.deepEqual(log, ["start b", "stop b", "stop slow"]);
    assert.ok(!reported.some((line) => /did not stop/.test(line)), reported.join("\n"));
  });

  it("report a stop that throws before it returns a promise", async () => {
    const log: string[] = [];
    const rude = {
      name: "rude",
      start: async () => undefined,
      stop: (): Promise<void> => {
        throw new Error("rude cannot stop");
      },
    };
    const { runtime, reported } = runtimeWith(service("a", log), rude);
    await runtime.start();
    await runtime.stop();
    assert.deepEqual(log, ["start a", "stop a"]);
    assert.ok(reported.includes("plugin service 'rude' did not stop cleanly: rude cannot stop"));
  });
});

describe("telling plugins the clone may have moved", () => {
  const pulled = { cause: "pull" as const, at: "2026-10-05T00:00:00Z" };

  it("tells every listener, each after the emitter has returned", async () => {
    const { runtime } = runtimeWith();
    const told: string[] = [];
    runtime.onSync((event) => void told.push(`a ${event.cause}`));
    runtime.onSync(async (event) => {
      await settle();
      told.push(`b ${event.at}`);
    });
    runtime.emitSync(pulled);
    assert.deepEqual(told, [], "a listener ran inside the emitter");
    await settle();
    await settle();
    assert.deepEqual(told, ["a pull", "b 2026-10-05T00:00:00Z"]);
  });

  it("reports a listener that throws or rejects, and tells the others all the same", async () => {
    const { runtime, reported } = runtimeWith();
    const told: string[] = [];
    runtime.onSync(() => {
      throw new Error("thrown");
    });
    runtime.onSync(async () => {
      throw new Error("rejected");
    });
    runtime.onSync(() => void told.push("third"));
    runtime.emitSync({ cause: "write", at: pulled.at });
    await settle();
    assert.deepEqual(told, ["third"]);
    assert.deepEqual(reported.sort(), [
      "plugin sync listener failed after a write: rejected",
      "plugin sync listener failed after a write: thrown",
    ]);
  });

  it("says nothing to nobody", async () => {
    const { runtime, reported } = runtimeWith();
    runtime.emitSync(pulled);
    await settle();
    assert.deepEqual(reported, []);
  });
});

describe("a context for a person, outside a request", () => {
  it("is not there while plugins are activating", () => {
    const { runtime } = runtimeWith();
    assert.throws(
      () => runtime.contextFor({ email: "person@example.invalid" }),
      /once every plugin has activated/,
    );
  });

  it("is built for the person asked about, afresh each time", () => {
    const { runtime } = runtimeWith();
    const asked: unknown[] = [];
    runtime.setContextFactory((viewer) => {
      asked.push(viewer);
      return { viewer } as unknown as GraphQLCtx;
    });
    const first = runtime.contextFor({ name: "A Person", email: "a@example.invalid" });
    const second = runtime.contextFor({ name: "A Person", email: "a@example.invalid" });
    assert.notEqual(first, second);
    assert.deepEqual(first.viewer, { name: "A Person", email: "a@example.invalid" });
    assert.equal(asked.length, 2);
  });

  it("passes the factory's refusal on", () => {
    const { runtime } = runtimeWith();
    runtime.setContextFactory(() => {
      throw new Error("not allowed here");
    });
    assert.throws(() => runtime.contextFor({ email: "a@example.invalid" }), /not allowed here/);
  });
});

describe("running an operation for a plugin", () => {
  /** A schema of one field, answering who the context says is asking. */
  function whoSchema(): { schema: GraphQLSchema; resolved: () => number } {
    let count = 0;
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: "Query",
        fields: {
          who: {
            type: GraphQLString,
            args: { greeting: { type: GraphQLString } },
            resolve: (_root, args: { greeting?: string }, ctx: GraphQLCtx) => {
              count += 1;
              return `${args.greeting ?? "hi"} ${ctx.viewer.email}`;
            },
          },
        },
      }),
    });
    return { schema, resolved: () => count };
  }

  const ctx = {
    viewer: { email: "person@example.invalid" },
    sync: { underLock: false },
  } as unknown as GraphQLCtx;

  it("has no schema until the server built one", async () => {
    const { runtime } = runtimeWith();
    assert.throws(() => runtime.schema(), /once every plugin has activated/);
    await assert.rejects(runtime.execute(ctx, "{ who }"), /once every plugin has activated/);
  });

  it("resolves with the context it is given, and the variables", async () => {
    const { runtime } = runtimeWith();
    const { schema } = whoSchema();
    runtime.setSchema(schema);
    assert.equal(runtime.schema(), schema);
    const plain = await runtime.execute(ctx, "{ who }");
    assert.equal(plain.errors, undefined);
    assert.equal(plain.data?.who, "hi person@example.invalid");
    const greeted = await runtime.execute(ctx, "query Q($g: String) { who(greeting: $g) }", {
      g: "hello",
    });
    assert.equal(greeted.data?.who, "hello person@example.invalid");
  });

  it("refuses to run under the lock its resolvers would take, and leaves the lock free", async () => {
    const { runtime } = runtimeWith();
    const { schema, resolved } = whoSchema();
    runtime.setSchema(schema);
    const lock = new Mutex();
    const locked = {
      ...ctx,
      sync: {
        get underLock() {
          return lock.held;
        },
      },
    } as unknown as GraphQLCtx;
    await assert.rejects(
      lock.run(() => runtime.execute(locked, "{ who }")),
      /under the repository lock.*never from inside sync\.read/,
    );
    assert.equal(resolved(), 0);
    // Outside it, the same context runs, and the lock still turns.
    assert.equal((await runtime.execute(locked, "{ who }")).data?.who, "hi person@example.invalid");
    assert.equal(await lock.run(() => "next"), "next");
  });

  it("answers a document that does not parse or validate with its errors, running nothing", async () => {
    const { runtime } = runtimeWith();
    const { schema, resolved } = whoSchema();
    runtime.setSchema(schema);
    const unparsable = await runtime.execute(ctx, "{ who");
    assert.equal(unparsable.data, undefined);
    assert.match(unparsable.errors?.[0]?.message ?? "", /Syntax Error/);
    const invalid = await runtime.execute(ctx, "{ nobody }");
    assert.match(invalid.errors?.[0]?.message ?? "", /Cannot query field "nobody"/);
    // Asked again, the same answer, from what it remembered.
    assert.deepEqual(await runtime.execute(ctx, "{ nobody }"), invalid);
    assert.equal(resolved(), 0);
  });
});
