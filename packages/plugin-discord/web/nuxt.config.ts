/**
 * The Discord bridge as a Nuxt layer — spec 06 §6.3.
 *
 * What `@navbook/plugin-discord/web` resolves to. Empty of settings for the
 * reason plugin-kb's is: the build is the host's. What this layer adds — the
 * page that links a Discord account, and a way to a record's thread from its
 * page and its row — it adds through its own pages and the host's slots.
 *
 * As in any layer, `~/…` is the host's, so this layer's own modules are
 * imported by relative path, generated GraphQL documents included.
 */

export default defineNuxtConfig({});
