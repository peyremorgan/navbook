/**
 * The package as the hosts see it: its manifest, and what its code imports.
 *
 * A plugin is installed with `--omit=peer`: at runtime it is handed the core
 * and host its front end is already running, and a value imported from any of
 * them would resolve to nothing. So everything under `src/` may import them for
 * types only — which a missed `type` keyword would quietly break, and only
 * once published.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { parsePluginPackage } from "@navbook/core";
import { PLUGIN } from "./helpers/nav.ts";

function sources(dir: string, extensions = [".ts"]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === "generated"
        ? []
        : sources(join(dir, entry.name), extensions)
      : extensions.some((extension) => entry.name.endsWith(extension))
        ? [join(dir, entry.name)]
        : [],
  );
}

describe("the package", () => {
  it("is a plugin the hosts accept, declaring only what it implements", () => {
    const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
    const parsed = parsePluginPackage(pkg);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
    assert.equal(parsed.ok && parsed.plugin.manifest.short, "chat");
    assert.ok(pkg.keywords.includes("navbook-plugin"));
    assert.deepEqual(Object.keys(pkg.exports), ["./cli", "./server", "./web", "./package.json"]);
    // Nothing contributed to a built-in verb, and no format: a listing never loads it.
    assert.equal(pkg.navbook.cli.contributions, undefined);
    assert.equal(pkg.navbook.core, undefined);
    assert.equal(pkg.navbook.format, undefined);
    assert.deepEqual(
      pkg.navbook.server.config.map((entry: { env: string; required?: boolean }) => [
        entry.env,
        entry.required ?? false,
      ]),
      [
        ["NAV_SERVER_CHAT_API_KEY", false],
        ["NAV_SERVER_CHAT_BASE_URL", false],
        ["NAV_SERVER_CHAT_MODEL", false],
      ],
    );
    assert.equal(pkg.dependencies, undefined, "no runtime dependencies at all");
    for (const shipped of ["dist", "doc", "schema.graphql", "web"])
      assert.ok(pkg.files.includes(shipped), shipped);
  });

  it("ships every file its web layer imports", () => {
    // The layer is compiled from the published package, source and all, by
    // whoever builds a client with it: an import reaching outside `web/` must
    // land on a file the package ships.
    const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
    let checked = 0;
    for (const file of sources(join(PLUGIN, "web"), [".ts", ".vue"])) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const target = relative(PLUGIN, resolve(dirname(file), match[1] ?? ""));
        if (target.startsWith("web")) continue;
        const shipped = pkg.files.some(
          (entry: string) => target === entry || target === entry.replace(/\.ts$/, ""),
        );
        assert.ok(shipped, `${relative(PLUGIN, file)} imports ${target}, which is not shipped`);
        checked += 1;
      }
    }
    assert.ok(checked >= 1, "the scan found the import it guards");
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
      }
    }
    // The scan found the imports it is guarding, so it is not passing vacuously.
    assert.ok(checked >= 8, `${checked} host imports checked`);
  });
});
