/**
 * The unit suite.
 *
 * Tests live in `test/nuxt/` because that is the directory Nuxt's generated
 * `tsconfig.app.json` type-checks alongside `app/` — which is what lets a test
 * import `app/utils/*` and the generated GraphQL types with the same aliases
 * the components use, and what makes `nuxi typecheck` cover the suite.
 *
 * The environment is `happy-dom` by default and the Nuxt one only where a test
 * says so (`// @vitest-environment nuxt`): booting Nuxt costs seconds per file,
 * and most of what is worth testing here is a pure function.
 *
 * The end-to-end suite is Playwright and is deliberately not run by `pnpm test`
 * — it needs a real server, a real issuer and a built bundle. `pnpm test:e2e`.
 */

import { defineVitestConfig } from "@nuxt/test-utils/config";

export default defineVitestConfig({
  test: {
    environment: "happy-dom",
    include: ["test/nuxt/**/*.test.ts"],
    globals: false,
  },
});
