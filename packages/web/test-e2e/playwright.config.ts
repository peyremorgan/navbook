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
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  globalTeardown: "./helpers/teardown.ts",
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
