/**
 * The unit suite.
 *
 * There are two directories, and which one a test belongs in is decided by
 * which type check should cover it. `test/nuxt/` is what Nuxt's generated
 * `tsconfig.app.json` checks alongside `app/`, so a test there imports
 * `app/utils/*` and the generated GraphQL types with the same aliases the
 * components use. `test/node/` is checked by `tsconfig.tools.json` under the
 * repository's ordinary compiler settings, and holds the tests for the
 * development scripts, which are plain Node and never reach the browser.
 *
 * The environment is `happy-dom` by default, `node` or `nuxt` where a file says
 * so (`// @vitest-environment node`): booting Nuxt costs seconds per file, and
 * most of what is worth testing here is a pure function.
 *
 * The end-to-end suite is Playwright and is deliberately not run by `pnpm test`
 * — it needs a real server, a real issuer and a built bundle. `pnpm test:e2e`.
 */

import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    environment: "happy-dom",
    include: ["test/nuxt/**/*.test.ts", "test/node/**/*.test.ts"],
    globals: false,
  },
});
