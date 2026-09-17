/**
 * The three things a person can say about the theme.
 *
 * `system` is a preference in its own right, not the absence of one: it is
 * what `@nuxtjs/color-mode` starts at, the only value under which the page
 * follows `prefers-color-scheme` — at load and when the scheme changes while
 * the page is open — and so the one a person who once chose light or dark has
 * to be able to choose again. A control offering only the other two pins the
 * page the first time it is pressed, with no way back short of devtools.
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export const THEME_LOOK: Record<ThemePreference, { label: string; icon: string }> = {
  system: { label: "System", icon: "i-lucide-monitor" },
  light: { label: "Light", icon: "i-lucide-sun" },
  dark: { label: "Dark", icon: "i-lucide-moon" },
};

/** One entry of the theme menu, in the shape `UDropdownMenu` takes. */
export interface ThemeMenuItem {
  label: string;
  icon: string;
  type: "checkbox";
  checked: boolean;
  onSelect: () => void;
}

/**
 * The menu, with the current preference ticked.
 *
 * `onSelect` rather than `onUpdateChecked`: choosing the entry that is already
 * ticked would otherwise report `false`, and there is no such thing as having
 * no preference. Every entry sets its own value, whatever it was before.
 */
export function themeMenuItems(
  current: string,
  choose: (preference: ThemePreference) => void,
): ThemeMenuItem[] {
  return THEME_PREFERENCES.map((preference) => ({
    ...THEME_LOOK[preference],
    type: "checkbox",
    checked: preference === current,
    onSelect: () => choose(preference),
  }));
}

/**
 * What the button is called, for somebody who cannot see its icon.
 *
 * It names the preference and, under `system`, what the system resolved to,
 * since that is the one case where the icon does not say what the page shows.
 */
export function themeButtonLabel(preference: string, value: string): string {
  if (!isThemePreference(preference)) return "Theme";
  const name = THEME_LOOK[preference].label.toLowerCase();
  return preference === "system" ? `Theme: ${name} (${value})` : `Theme: ${name}`;
}
