/**
 * The web client's build.
 *
 * `ssr: false` is the whole shape of this package: `nuxi generate` emits a
 * static shell that any file server can hand out, and every byte of data comes
 * from the GraphQL API at runtime. There is no second Node process to deploy,
 * and — the constraint that matters — no Navbook logic in the browser
 * (spec 06 §6.3). The client sends fields; the server composes the files.
 *
 * The API's address is deliberately *not* baked in here. It is read from
 * `public/config.json` at boot (see `app/plugins/01.config.ts`), so one built
 * artefact serves every deployment.
 */

export default defineNuxtConfig({
  compatibilityDate: "2026-09-01",
  ssr: false,
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  telemetry: false,
  devtools: { enabled: false },
  app: {
    head: {
      title: "Navbook",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
    },
  },
  nitro: { preset: "static" },
  // Type checking is a script (`pnpm typecheck`), not a dev-server task: it is
  // what CI runs, and running it twice only slows the reload down.
  typescript: { strict: true, typeCheck: false },
});
