/**
 * Where the assistant shows up in the host's client: a button over every page.
 *
 * `enforce: "pre"`, like every layer's registrations, so the slot is filled
 * before the layout first renders.
 */

import { defineNuxtPlugin } from "#app";
import ChatLauncher from "../components/ChatLauncher.vue";

export default defineNuxtPlugin({
  name: "navbook-plugin-chat",
  enforce: "pre",
  setup() {
    useNavbookSlots().register({ overlays: [{ component: ChatLauncher }] });
  },
});
