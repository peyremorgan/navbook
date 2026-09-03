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
 * Plain Vitest rather than `@nuxt/test-utils`: what is worth unit-testing here
 * is pure — the patch builder, the filter translation, the comment tree, the
 * sanitiser — and booting Nuxt to exercise a function costs seconds a file.
 * The components are proved end to end instead, in a real browser against a
 * real server, which is a stronger test than a mounted one with mocks.
 *
 * The environment is `node`, and `jsdom` in the one file that needs a DOM.
 * jsdom rather than the faster happy-dom because of what that file tests:
 * happy-dom's parser drops the first element of a fragment, so DOMPurify
 * returns `Title` for `<h1>Title</h1>` and the sanitiser's suite would pass or
 * fail for reasons that have nothing to do with the sanitiser. jsdom is what
 * DOMPurify is developed against, and it agrees with the browser.
 *
 * The end-to-end suite is Playwright and is deliberately not run by
 * `pnpm test` — it needs a real server, a real issuer and a built bundle.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // The aliases Nuxt gives app code, so a test imports what a component does.
    alias: {
      "~~": here("./"),
      "~": here("./app"),
      "@": here("./app"),
    },
  },
  test: {
    environment: "node",
    include: ["test/nuxt/**/*.test.ts", "test/node/**/*.test.ts"],
    globals: false,
  },
});
