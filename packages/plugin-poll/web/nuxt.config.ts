/**
 * Polls as a Nuxt layer — spec 06 §6.3.
 *
 * What `@navbook/plugin-poll/web` resolves to; its directory is what the host
 * puts in `extends`. `app/components` and `app/composables` are
 * auto-imported, and `app/plugins/50.poll.ts` fills the host's slot registry
 * at boot. It has no pages: a poll is shown where it was asked, in its
 * issue's discussion.
 *
 * Empty of settings, as the other layers are: a layer that configured the
 * build would be configuring somebody else's. Inside it, `~/…` resolves
 * against the host, so this layer's own modules are imported by relative
 * path, generated GraphQL documents included.
 */

export default defineNuxtConfig({});
