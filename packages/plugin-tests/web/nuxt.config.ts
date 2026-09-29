/**
 * Test plans and runs as a Nuxt layer — spec 06 §6.3.
 *
 * What `@navbook/plugin-tests/web` resolves to; its directory is what the host
 * puts in `extends`. `app/pages` become routes, `app/components` and
 * `app/composables` are auto-imported, and `app/plugins/50.tests.ts` fills the
 * host's slot registry at boot.
 *
 * Empty of settings, as `@navbook/plugin-kb`'s is: a layer that configured the
 * build would be configuring somebody else's. Inside it, `~/…` resolves
 * against the host, so this layer's own modules are imported by relative
 * path, generated GraphQL documents included.
 */

export default defineNuxtConfig({});
