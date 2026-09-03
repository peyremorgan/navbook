/**
 * The runtime configuration, loaded before anything else.
 *
 * Nuxt awaits plugins in filename order, which is why these three are
 * numbered: the identity provider's address comes from the configuration, and
 * the Apollo client's link needs both. Getting that order from a naming
 * convention is fragile enough to be worth saying out loud, but the
 * alternative — a promise every consumer awaits — puts the same wait in every
 * component instead of once here.
 *
 * A configuration that cannot be read is fatal and says so. There is nothing
 * useful this app can do without an API address, and guessing one would only
 * move the failure somewhere harder to read.
 */

import { configUrl, loadConfig } from "~/utils/config";

export default defineNuxtPlugin(async (nuxtApp) => {
  try {
    // Against the app's base rather than the current route: a reload deep in
    // the app must ask for the same file the front page does.
    const url = configUrl(useRuntimeConfig().app.baseURL);
    nuxtApp.provide("navConfig", await loadConfig({ url }));
  } catch (error) {
    showError({
      statusCode: 500,
      statusMessage: "Navbook is not configured",
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
  }
});
