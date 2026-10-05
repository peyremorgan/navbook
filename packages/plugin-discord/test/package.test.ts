/**
 * The package as the hosts see it: its manifest, and what its code imports.
 *
 * A plugin is installed with `--omit=peer`: at runtime it is handed the core
 * and host its front end is already running, and a value imported from any of
 * them would resolve to nothing. So everything under `src/` may import them for
 * types only — which a missed `type` keyword would quietly break, and only
 * once published. And it depends on nothing else: its Discord client is its
 * own, over `fetch` and Node's `WebSocket`.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parsePluginPackage } from "@navbook/core";
import { PLUGIN } from "./helpers/bridge.ts";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}

const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));

describe("the package", () => {
  it("is a plugin the hosts accept, declaring what it implements", () => {
    const parsed = parsePluginPackage(pkg);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
    assert.equal(parsed.ok && parsed.plugin.manifest.short, "discord");
    assert.ok(pkg.keywords.includes("navbook-plugin"));
    assert.deepEqual(Object.keys(pkg.exports), [
      "./core",
      "./cli",
      "./server",
      "./web",
      "./package.json",
    ]);
    for (const [subpath, file] of Object.entries(pkg.exports as Record<string, string>)) {
      assert.ok(existsSync(join(PLUGIN, file)), `${subpath} names ${file}, which is missing`);
    }
    // Nothing contributed to a built-in verb, and no data in the tree: a
    // listing never loads it.
    assert.equal(pkg.navbook.cli.contributions, undefined);
    assert.equal(pkg.navbook.format, undefined);
    assert.ok(existsSync(join(PLUGIN, pkg.navbook.spec)), "the published spec is missing");
    assert.deepEqual(pkg.navbook.core.commitScopes, ["discord"]);
  });

  it("asks for nothing it cannot run without", () => {
    assert.deepEqual(
      pkg.navbook.server.config.map((entry: { env: string; required?: boolean }) => [
        entry.env,
        entry.required ?? false,
      ]),
      [
        ["NAV_SERVER_DISCORD_TOKEN", false],
        ["NAV_SERVER_DISCORD_GUILD", false],
        ["NAV_SERVER_DISCORD_API_URL", false],
      ],
    );
    assert.equal(pkg.dependencies, undefined, "no runtime dependencies at all");
    for (const shipped of ["dist", "doc", "schema.graphql", "web"]) {
      assert.ok(pkg.files.includes(shipped), shipped);
    }
  });

  it("imports the hosts and graphql for types only", () => {
    let checked = 0;
    for (const file of sources(join(PLUGIN, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
        const [, typeOnly, specifier] = match;
        if (specifier?.startsWith("@navbook/") || specifier === "graphql") {
          assert.ok(typeOnly, `${file} imports ${specifier} as a value`);
          checked += 1;
        }
        assert.ok(
          specifier?.startsWith(".") ||
            specifier?.startsWith("node:") ||
            specifier?.startsWith("@navbook/") ||
            specifier === "graphql",
          `${file} imports ${specifier}, which the package does not depend on`,
        );
      }
    }
    // The scan found the imports it is guarding, so it is not passing vacuously.
    assert.ok(checked >= 8, `${checked} host imports checked`);
  });
});
