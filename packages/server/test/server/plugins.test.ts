/**
 * A plugin reaching the API — spec 06 §6.2, §6.3.
 *
 * Three things only the server offers: a schema it can extend, a service that
 * outlives the request that started it, and the event every mutation emits.
 * And one refusal the CLI does not make — a declared plugin that is not
 * installed stops the server, because its users are people with browsers who
 * would otherwise see an absence with nothing to explain it.
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { startHarness } from "../helpers/harness.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "fixtures", "plugin-probe");

/** A log the probe appends to, so a service's lifecycle can be observed. */
function logFile(name: string): { path: string; lines(): string[]; clear(): void } {
  const path = join(process.env.TMPDIR ?? "/tmp", `navbook-srvprobe-${name}-${process.pid}.log`);
  rmSync(path, { force: true });
  return {
    path,
    lines: () => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []),
    clear: () => rmSync(path, { force: true }),
  };
}

/** The environment that puts the probe on the path and configures it. */
function probeEnv(log: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NAVBOOK_PLUGIN_PATH: PROBE,
    SRVPROBE_LOG: log,
    NAV_SERVER_SRVPROBE_TOKEN: "s3cret",
    ...extra,
  };
}

describe("a plugin's schema", () => {
  it("is merged into the one the server serves", async () => {
    const log = logFile("schema");
    const harness = await startHarness({
      env: probeEnv(log.path, { NAV_SERVER_SRVPROBE_NOTE: "hello" }),
    });
    try {
      const result = await harness.gql<{ srvprobe: { note: string | null } }>(
        "{ srvprobe { note } }",
      );
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      assert.equal(result.data?.srvprobe.note, "hello");
    } finally {
      await harness.stop();
    }
  });

  it("leaves the built-in schema answering exactly as before", async () => {
    const log = logFile("builtin");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      const result = await harness.gql<{ viewer: { email: string } }>("{ viewer { email } }");
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      assert.ok(result.data?.viewer.email);
    } finally {
      await harness.stop();
    }
  });

  it("resolves through the same context the built-in resolvers use", async () => {
    const log = logFile("context");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      await harness.gql(
        `mutation { openIssue(input: { title: "Tagged", body: "Body." }) { issue { id } } }`,
      );
      // The plugin's own frontmatter key, read out of the tree the API wrote.
      const result = await harness.gql<{ srvprobe: { tags: string[] } }>("{ srvprobe { tags } }");
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      assert.deepEqual(result.data?.srvprobe.tags, []);
    } finally {
      await harness.stop();
    }
  });
});

describe("Entity.ext", () => {
  it("is an empty object when nothing is loaded", async () => {
    const harness = await startHarness();
    try {
      await harness.gql(
        `mutation { openIssue(input: { title: "Plain", body: "Body." }) { issue { id } } }`,
      );
      const result = await harness.gql<{ issues: { ext: Record<string, unknown> }[] }>(
        "{ issues { ext } }",
      );
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      // Empty rather than null: a client reads `ext.kb?.features` without
      // first checking that the field is there.
      assert.deepEqual(result.data?.issues[0]?.ext, {});
    } finally {
      await harness.stop();
    }
  });

  it("carries each loaded plugin's reading under its short name", async () => {
    const log = logFile("ext");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      await harness.gql(
        `mutation { openIssue(input: { title: "Tagged", body: "Body." }) { issue { id } } }`,
      );
      const result = await harness.gql<{
        issues: { ext: { srvprobe?: { tags: string[] } } }[];
      }>("{ issues { ext } }");
      assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
      // The probe registers no frontmatter on open, so the reading is empty —
      // what is asserted is that the key is present and shaped, which is what
      // a row badge checks before it draws anything.
      assert.deepEqual(result.data?.issues[0]?.ext.srvprobe, { tags: [] });
    } finally {
      await harness.stop();
    }
  });
});

describe("a plugin's service", () => {
  it("starts before the port opens and stops on shutdown", async () => {
    const log = logFile("service");
    const harness = await startHarness({ env: probeEnv(log.path) });
    // Started before anything could be served: the log already says so.
    assert.ok(log.lines().includes("service:start"), log.lines().join(", "));
    assert.equal(log.lines().includes("service:stop"), false);
    await harness.stop();
    assert.ok(log.lines().includes("service:stop"), log.lines().join(", "));
  });

  it("is given the configuration its manifest declared", async () => {
    const log = logFile("config");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      assert.ok(log.lines().some((line) => line === "activate token=s3cret"));
    } finally {
      await harness.stop();
    }
  });
});

describe("the mutation event", () => {
  it("names every committed mutation, with who made it", async () => {
    const log = logFile("events");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      await harness.gql(
        `mutation { openIssue(input: { title: "One", body: "Body." }) { issue { id } } }`,
      );
      const events = log.lines().filter((line) => line.startsWith("mutation "));
      assert.equal(events.length, 1, log.lines().join("\n"));
      assert.match(events[0] as string, /docs\(issue\): open #\w{8}/);
      // The person, not the machine account — the gateway rule of §6.2.
      assert.match(events[0] as string, /by=\S+@\S+/);
    } finally {
      await harness.stop();
    }
  });

  it("is not emitted for a commit whose push failed, which its author was told", async () => {
    const log = logFile("unpushed");
    const harness = await startHarness({
      env: probeEnv(log.path),
      // An origin that turns every push away, for a reason no retry mends.
      prepare: (fixture) => {
        const hook = join(fixture.origin, "hooks", "pre-receive");
        writeFileSync(hook, "#!/bin/sh\necho 'no pushes today' >&2\nexit 1\n", "utf8");
        chmodSync(hook, 0o755);
      },
    });
    try {
      const result = await harness.gql(
        `mutation { openIssue(input: { title: "Stranded", body: "Body." }) { issue { id } } }`,
      );
      assert.ok((result.errors ?? []).length > 0, "the push failed, so the mutation must");
      // Committed in the clone all the same, and heard about by nobody.
      const subject = harness.fixture.server.git(["log", "-1", "--format=%s"]).stdout.trim();
      assert.match(subject, /docs\(issue\): open #\w{8}/);
      assert.deepEqual(
        log.lines().filter((line) => line.startsWith("mutation ")),
        [],
      );
    } finally {
      await harness.stop();
    }
  });

  it("is emitted once per mutation, and readable back through the schema", async () => {
    const log = logFile("seen");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      const opened = await harness.gql<{ openIssue: { issue: { id: string } } }>(
        `mutation { openIssue(input: { title: "One", body: "Body." }) { issue { id } } }`,
      );
      const id = opened.data?.openIssue.issue.id;
      assert.ok(id);
      await harness.gql(
        `mutation Close($ref: ID!) { closeIssue(input: { ref: $ref }) { issue { id } } }`,
        { ref: id },
      );
      const result = await harness.gql<{ srvprobe: { seen: string[] } }>("{ srvprobe { seen } }");
      const seen = result.data?.srvprobe.seen ?? [];
      assert.equal(seen.length, 2, seen.join(", "));
      assert.match(seen[0] as string, /open/);
      assert.match(seen[1] as string, /close/);
    } finally {
      await harness.stop();
    }
  });

  it("says nothing about a read", async () => {
    const log = logFile("reads");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      await harness.gql("{ issues { id } }");
      assert.deepEqual(
        log.lines().filter((line) => line.startsWith("mutation ")),
        [],
      );
    } finally {
      await harness.stop();
    }
  });
});

describe("what the server refuses to start without", () => {
  it("stops when the clone declares a plugin it does not have", async () => {
    // The refusal the CLI does not make. A person at a terminal can read one
    // line and carry on; a browser user would see an absence and no reason.
    await assert.rejects(
      () =>
        startHarness({
          prepare: (fixture) => {
            // Written on the clone the server will serve, and committed: the
            // server refuses a dirty tree, so an uncommitted marker would be
            // refused for the wrong reason.
            fixture.server.write(
              ".navbook/navbook.json",
              `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-absent": {} } }, null, 2)}\n`,
            );
            fixture.server.commitAll("declare a plugin nobody installed");
          },
        }),
      (error: Error) => {
        assert.match(error.message, /@navbook\/plugin-absent/);
        assert.match(error.message, /not installed beside nav-server/);
        return true;
      },
    );
  });

  it("never loads a declared name that is a path, even into the clone", async () => {
    // Anybody who can push to the served branch writes the declaration, so a
    // path there would be a way to make the server import their code. The
    // plugin is complete and compatible; only its name is not a plugin's.
    const marker = join(process.env.TMPDIR ?? "/tmp", `navbook-pathplugin-${process.pid}`);
    rmSync(marker, { force: true });
    for (const relative of [false, true]) {
      await assert.rejects(
        () =>
          startHarness({
            prepare: (fixture) => {
              const pkg = {
                name: "navbook-plugin-evil",
                version: "1.0.0",
                keywords: ["navbook-plugin"],
                type: "module",
                engines: { navbook: "^1.0.0" },
                exports: { "./server": "./server.js" },
                navbook: { short: "evil", server: {} },
              };
              fixture.server.write(".navbook/evil/package.json", JSON.stringify(pkg));
              fixture.server.write(
                ".navbook/evil/server.js",
                `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default { activate() {} };\n`,
              );
              const name = relative
                ? "../../../.navbook/evil"
                : join(fixture.server.dir, ".navbook/evil");
              fixture.server.write(
                ".navbook/navbook.json",
                `${JSON.stringify({ version: 1, plugins: { [name]: {} } }, null, 2)}\n`,
              );
              fixture.server.commitAll("declare a plugin by its path");
            },
          }),
        (error: Error) => {
          assert.match(error.message, /is not named as a plugin/);
          return true;
        },
      );
      assert.equal(existsSync(marker), false, "the clone's code ran");
    }
  });

  it("stops when a plugin's required configuration is absent", async () => {
    const log = logFile("noconfig");
    await assert.rejects(
      () =>
        startHarness({
          env: { NAVBOOK_PLUGIN_PATH: PROBE, SRVPROBE_LOG: log.path },
        }),
      (error: Error) => {
        assert.match(error.message, /NAV_SERVER_SRVPROBE_TOKEN/);
        return true;
      },
    );
  });

  it("stops what it started when the port is taken, and says why", async () => {
    // Somebody else's socket on the port the server is told to use.
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(0, resolve));
    const address = squatter.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const log = logFile("porttaken");
    try {
      await assert.rejects(
        // A background pull as well, so there is one running to stop.
        () => startHarness({ env: probeEnv(log.path), port, pullIntervalMs: 60_000 }),
        (error: Error) => {
          assert.match(error.message, new RegExp(`could not listen on port ${port}: .*EADDRINUSE`));
          // Said as a startup fault, not thrown from the event loop.
          assert.doesNotMatch(error.message, /Unhandled 'error' event|\n\s+at /);
          return true;
        },
      );
      // The service was up before the port was tried, and went down with it.
      assert.deepEqual(
        log.lines().filter((line) => line.startsWith("service:")),
        ["service:start", "service:stop"],
      );
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
      log.clear();
    }
  });

  it("starts with an optional key left unset", async () => {
    const log = logFile("optional");
    const harness = await startHarness({ env: probeEnv(log.path) });
    try {
      const result = await harness.gql<{ srvprobe: { note: string | null } }>(
        "{ srvprobe { note } }",
      );
      assert.equal(result.data?.srvprobe.note, null);
    } finally {
      await harness.stop();
    }
  });
});
