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

  const ctx = { viewer: { email: "person@example.invalid" } } as unknown as GraphQLCtx;

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
