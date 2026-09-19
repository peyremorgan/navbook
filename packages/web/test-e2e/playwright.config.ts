/**
 * The end-to-end suite.
 *
 * One worker, because the stack is one git repository behind one server that
 * serialises every operation against a single working tree: parallel workers
 * would contend for it and prove nothing extra. Chromium only, for the same
 * reason a second browser would — this suite is about whether the client, the
 * API and a repository agree, not about rendering differences.
 *
 * It is not part of `pnpm test`. It needs a built bundle, which is a step the
 * unit suite has no use for.
 *
 * Two kinds of suite run under it: this package's own, and one per plugin
 * layer the bundle was built with (see `pluginSuites`).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * The suites of the plugin layers this bundle was built with.
 *
 * A plugin's own end-to-end tests belong to the plugin: a build without the
 * knowledge base has no `/features` route, so a spec for it in this directory
 * would fail for the right reason in the wrong package. They are found the
 * same way `nuxt.config.ts` finds the layers themselves — from
 * `NAVBOOK_WEB_PLUGINS`, which is what decided the bundle — so the specs that
 * run are exactly the ones the bundle can satisfy.
 *
 * `test-e2e/` beside the package's `web/` export rather than inside it, since
 * the layer is published and its tests are not.
 */
function pluginSuites(): string[] {
  const named = (process.env.NAVBOOK_WEB_PLUGINS ?? "").split(/\s+/).filter(Boolean);
  return named
    .map((name) =>
      join(dirname(fileURLToPath(import.meta.resolve(`${name}/web`))), "..", "test-e2e"),
    )
    .filter((dir) => existsSync(dir));
}

export default defineConfig({
  projects: [
    { name: "web", testDir: "." },
    ...pluginSuites().map((dir, index) => ({ name: `plugin-${index}`, testDir: dir })),
  ],
  testMatch: "**/*.spec.ts",
  globalTeardown: "./helpers/teardown.ts",
  // One worker across every project, for the reason given above: they share
  // one repository behind one server, so a second project running beside the
  // first would contend for it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? [["list"]] : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    trace: "on-first-retry",
    // Every navigation is a fetch to an API on another origin; a machine under
    // load can take a moment over the first one.
    actionTimeout: 20_000,
  },
});
