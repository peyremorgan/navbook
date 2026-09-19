/**
 * Where the knowledge base shows up in the host's client.
 *
 * Its own pages need nothing registered — a layer's `app/pages` are routes as
 * soon as the layer is in the build. Everything here is the other half: the
 * places on somebody else's page where a feature belongs.
 *
 * Numbered `50` so it runs after the host's own numbered plugins (`01.config`
 * through `03.apollo`) and before the first render. Apollo reads its cache
 * configuration when it is created, so `cache` below has to be registered
 * before `03.apollo` runs — which is why the registration is a plugin at all
 * rather than something each component does for itself.
 */

import { defineNuxtPlugin } from "#app";
import KbFeatureChips from "../components/KbFeatureChips.vue";
import KbFeatureField from "../components/KbFeatureField.vue";
import KbFeaturePanel from "../components/KbFeaturePanel.vue";
import { readKbFeatures } from "../utils/features";

/**
 * Slugs are lowercase by grammar; folding only forgives a tree that is not,
 * and an address somebody typed by hand.
 */
function sameSlug(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export default defineNuxtPlugin({
  name: "navbook-plugin-kb",
  // Before the app mounts, and before Apollo is built: `enforce: "pre"` puts
  // this ahead of the host's unnumbered plugins, and the number ahead of
  // nothing — the host's cache plugin is `03`, so ordering is what the file
  // name says and this comment exists to stop it being renamed thoughtlessly.
  enforce: "pre",
  setup() {
    useNavbookSlots().register({
      navLinks: [
        {
          label: "Features",
          to: "/features",
          icon: "i-lucide-layers",
          testid: "nav-features",
          // After Issues and Pull requests, which the host numbers 0 to 100.
          order: 50,
        },
      ],

      panels: [
        { noun: "issue", component: KbFeaturePanel },
        { noun: "pr", component: KbFeaturePanel },
      ],

      entityFields: [
        {
          field: "features",
          label: "features",
          read: (ext) => readKbFeatures(ext),
        },
      ],

      formFields: [{ form: "issue-new", component: KbFeatureField }],

      filters: [
        {
          param: "feature",
          apiField: "features",
          label: "Feature",
          icon: "i-lucide-layers",
          nouns: ["issue", "pr"],
          // Read at the moment the menu is drawn, from the cache the registry
          // query filled; a menu that fetched on open would open empty.
          options: () => useKbFeatures().slugs.value,
        },
      ],

      rowBadges: [{ component: KbFeatureChips }],

      inboxGroups: [
        {
          key: "feature",
          label: "Feature",
          icon: "i-lucide-layers",
          values: (items) => {
            const seen = new Set<string>();
            for (const item of items) {
              for (const slug of readKbFeatures(item.entity.ext)) seen.add(slug);
            }
            return [...seen].sort((a, b) => a.localeCompare(b));
          },
          matches: (item, value) =>
            readKbFeatures(item.entity.ext).some((slug) => sameSlug(slug, value)),
        },
      ],

      cache: {
        // A feature is named by its slug, a document by its path within one.
        typePolicies: {
          Feature: { keyFields: ["slug"] },
          Spec: { keyFields: ["path"] },
        },
        queryFields: {
          features: { keyArgs: [] },
          feature: { keyArgs: ["slug"] },
        },
      },

      // A feature's counts change when an issue does, so the listing is
      // evicted with the host's rather than going stale until a reload.
      listings: ["features"],
    });
  },
});
