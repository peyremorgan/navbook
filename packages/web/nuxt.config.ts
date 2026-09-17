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
      // The shell's title, and the only one until the route resolves: with
      // `ssr: false` this same HTML is served for every address, so it has to
      // be the name that is true of all of them. Each page then names itself
      // with `useHead` (`app/utils/title.ts`), which is what makes a browser
      // history readable — without it every entry said `Navbook`.
      title: "Navbook",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
    },
  },
  nitro: { preset: "static" },
  // Type checking is a script (`pnpm typecheck`), not a dev-server task: it is
  // what CI runs, and running it twice only slows the reload down.
  typescript: { strict: true, typeCheck: false },
});
