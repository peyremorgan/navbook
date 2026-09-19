import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * The plugins whose web parts are merged into this build.
 *
 * A Nuxt layer is a build-time thing: its pages, components and composables
 * are compiled into the bundle, because a browser bundle is decided when it is
 * built. So unlike every other setting in a Navbook deployment — all of which
 * are read at boot from `config.json` — changing which plugins the client has
 * is a rebuild rather than a restart. That is stated plainly in the README and
 * in `.env.example`, because it is the one exception and a surprising one.
 *
 * Resolved to an absolute directory rather than passed as a package name: c12
 * resolves a bare name in `extends`, but not a subpath export, and `./web` is
 * a subpath. Resolving it here also fails loudly at build time if a plugin
 * named in the environment is not installed, which is where that should fail.
 */
function webLayers(): string[] {
  const named = (process.env.NAVBOOK_WEB_PLUGINS ?? "").split(/\s+/).filter(Boolean);
  return named.map((name) => {
    try {
      return dirname(fileURLToPath(import.meta.resolve(`${name}/web`)));
    } catch (error) {
      throw new Error(
        `NAVBOOK_WEB_PLUGINS names ${name}, whose './web' export could not be resolved. ` +
          `Is it installed as a dependency of @navbook/web? (${
            error instanceof Error ? error.message : String(error)
          })`,
      );
    }
  });
}

export default defineNuxtConfig({
  extends: webLayers(),
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
