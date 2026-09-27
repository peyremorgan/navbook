/**
 * Where the knowledge base shows up in the host's client.
 *
 * Its own pages need nothing registered — a layer's `app/pages` are routes as
 * soon as the layer is in the build. Everything here is the other half: the
 * places on somebody else's page where a feature belongs.
 *
 * It has to run before the host's Apollo client is built, because Apollo reads
 * its cache configuration once and a type policy registered afterwards would
 * apply only to what had not been read yet. `enforce: "pre"` is what puts it
 * there. That is also why these registrations are a Nuxt plugin at all rather
 * than something each component does for itself.
 */

import { defineNuxtPlugin } from "#app";
import KbFeatureChips from "../components/KbFeatureChips.vue";
import KbFeatureField from "../components/KbFeatureField.vue";
import KbFeaturePanel from "../components/KbFeaturePanel.vue";
import { featureSlugs } from "../utils/feature-registry";
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
  // See the note at the top of this file: the `cache` registration below is
  // only read if it is there before the client is built.
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
          // Called during the filter bar's render, outside any component's
          // setup — so it reads the shared registry rather than starting a
          // query (see `utils/feature-registry.ts`).
          options: () => featureSlugs(),
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
