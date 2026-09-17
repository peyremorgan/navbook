<!--
  The theme: system, light or dark — `app/utils/theme.ts`.

  A menu rather than a button that steps through the three. Stepping would
  spend two presses in a row changing nothing visible whenever the system
  already matches one of the fixed schemes, and would never say which of the
  three is in force. The menu ticks the preference, and the button's icon shows
  it: a monitor while the page follows the system.

  `@nuxtjs/color-mode` stores whatever is chosen, `system` included, in the
  browser it was chosen in and nowhere else.
-->
<script setup lang="ts">
import { isThemePreference, THEME_LOOK, themeButtonLabel, themeMenuItems } from "~/utils/theme";

const colorMode = useColorMode();

const items = computed(() =>
  themeMenuItems(colorMode.preference, (preference) => {
    colorMode.preference = preference;
  }),
);
const icon = computed(() =>
  isThemePreference(colorMode.preference)
    ? THEME_LOOK[colorMode.preference].icon
    : THEME_LOOK.system.icon,
);
const label = computed(() => themeButtonLabel(colorMode.preference, colorMode.value));
</script>

<template>
  <UDropdownMenu :items="items">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      :icon="icon"
      :aria-label="label"
      :title="label"
      data-testid="theme-toggle"
    />
  </UDropdownMenu>
</template>
