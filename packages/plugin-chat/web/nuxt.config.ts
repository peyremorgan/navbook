/**
 * The assistant as a Nuxt layer — spec 06 §6.3.
 *
 * What `@navbook/plugin-chat/web` resolves to. Empty of settings for the reason
 * plugin-kb's is: the build is the host's. What this layer adds — a button on
 * every page and the panel it opens — it adds through the host's `overlays`
 * slot, from `app/plugins/50.chat.ts`.
 *
 * As in any layer, `~/…` is the host's, so this layer's own modules are
 * imported by relative path, generated GraphQL documents included.
 */

export default defineNuxtConfig({});
