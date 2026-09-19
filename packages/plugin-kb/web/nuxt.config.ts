/**
 * The knowledge base as a Nuxt layer — spec 06 §6.3.
 *
 * This file is what `@navbook/plugin-kb/web` resolves to, and its directory is
 * what the host puts in `extends`. Everything beside it is an ordinary Nuxt
 * app directory: `app/pages` become routes, `app/components` and
 * `app/composables` are auto-imported, and `app/plugins/50.kb.ts` runs at boot
 * to fill the host's slot registry.
 *
 * Empty of settings on purpose. A layer that configured the build would be
 * configuring somebody else's — modules, CSS, the compatibility date and
 * `ssr: false` are the host's decisions, and a plugin quietly changing one of
 * them is exactly the bloat the plugin system exists to prevent. What this
 * layer adds, it adds through pages and through slots.
 *
 * Two rules the files under `app/` follow, both from Nuxt's layer semantics:
 *
 * - `~/…` resolves against the *consuming* project, not this directory. That
 *   is what lets a page here import `~/utils/title`, the host's own helper.
 * - So this layer's own modules are imported by relative path, generated
 *   GraphQL documents included (`../../src/generated/gql`).
 */

export default defineNuxtConfig({});
