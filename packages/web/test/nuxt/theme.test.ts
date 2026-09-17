/**
 * The theme menu's reading of a preference.
 *
 * The regression this guards is a control that could say light or dark but
 * not system (#qb86kmp0): once pressed, the page stopped following the
 * browser and nothing led back. So the first question is that `system` is
 * offered, and the second that choosing it — or re-choosing whatever is
 * already ticked — sets it rather than clearing it.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isThemePreference,
  THEME_PREFERENCES,
  type ThemePreference,
  themeButtonLabel,
  themeMenuItems,
} from "../../app/utils/theme";

/** The menu for `current`, and every preference its entries set when chosen. */
function menu(current: string) {
  const chosen: ThemePreference[] = [];
  const items = themeMenuItems(current, (preference) => chosen.push(preference));
  return { items, chosen };
}

describe("isThemePreference", () => {
  it("knows the three preferences and nothing else", () => {
    for (const preference of THEME_PREFERENCES) {
      assert.equal(isThemePreference(preference), true, preference);
    }
    for (const value of ["sepia", "", "System", null, undefined, 1]) {
      assert.equal(isThemePreference(value), false, String(value));
    }
  });
});

describe("themeMenuItems", () => {
  it("offers system beside light and dark, system first", () => {
    assert.deepEqual(
      menu("light").items.map((item) => item.label),
      ["System", "Light", "Dark"],
    );
  });

  it("ticks exactly the current preference", () => {
    for (const current of THEME_PREFERENCES) {
      const ticked = menu(current).items.filter((item) => item.checked);
      assert.equal(ticked.length, 1, current);
      assert.equal(ticked[0]?.label.toLowerCase(), current);
    }
  });

  it("goes back to system from a fixed choice", () => {
    const { items, chosen } = menu("dark");
    items[0]?.onSelect();
    assert.deepEqual(chosen, ["system"]);
  });

  it("sets the ticked entry again rather than clearing it", () => {
    const { items, chosen } = menu("light");
    for (const item of items) item.onSelect();
    assert.deepEqual(chosen, ["system", "light", "dark"]);
  });

  it("ticks nothing for a value it does not know, and still offers all three", () => {
    const { items } = menu("sepia");
    assert.equal(items.length, 3);
    assert.equal(
      items.some((item) => item.checked),
      false,
    );
  });
});

describe("themeButtonLabel", () => {
  it("names what the system resolved to while following it", () => {
    assert.equal(themeButtonLabel("system", "dark"), "Theme: system (dark)");
    assert.equal(themeButtonLabel("system", "light"), "Theme: system (light)");
  });

  it("names a fixed choice alone, since that is what the page shows", () => {
    assert.equal(themeButtonLabel("light", "light"), "Theme: light");
    assert.equal(themeButtonLabel("dark", "dark"), "Theme: dark");
  });

  it("falls back to the bare name for a value it does not know", () => {
    assert.equal(themeButtonLabel("sepia", "light"), "Theme");
  });
});
