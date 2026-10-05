/**
 * Where the Discord bridge shows up in the host's client.
 *
 * The page under `app/pages/discord` needs nothing registered: it is reached
 * from the link `/nav link` prints in Discord. These are the places on
 * somebody else's page — a panel on an issue or a pull request, a badge on its
 * row. No overlay: the corner is the assistant's.
 */

import { defineNuxtPlugin } from "#app";
import DiscordThreadBadge from "../components/DiscordThreadBadge.vue";
import DiscordThreadPanel from "../components/DiscordThreadPanel.vue";

export default defineNuxtPlugin({
  name: "navbook-plugin-discord",
  enforce: "pre",
  setup() {
    useNavbookSlots().register({
      panels: [
        { noun: "issue", component: DiscordThreadPanel, order: 120 },
        { noun: "pr", component: DiscordThreadPanel, order: 120 },
      ],
      rowBadges: [{ component: DiscordThreadBadge }],
      // A link has no id of its own: it is kept inside the viewer it belongs to.
      cache: { typePolicies: { DiscordLink: { keyFields: false } } },
    });
  },
});
