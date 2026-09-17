/**
 * The theme, which nobody should have to set.
 *
 * The default is whatever the browser already says about `prefers-color-scheme`,
 * and the navbar menu is for disagreeing with it — and for agreeing with it
 * again. Those are different mechanisms — a media query read before first
 * paint, a preference read back out of storage, and a listener for the scheme
 * changing under an open page — so all three are exercised here, against a
 * browser told to prefer each scheme in turn.
 *
 * A real browser is the only place this can be proved: the resolution happens
 * in a blocking script in the document head, before Vue exists, and a mounted
 * component would never run it.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures.ts";

const toggle = (page: Page) => page.getByTestId("theme-toggle");

/** The class `@nuxtjs/color-mode` writes on `<html>`, and nothing adjacent. */
const asClass = (mode: string) => new RegExp(`(^|\\s)${mode}(\\s|$)`);

/**
 * That the page settled on `mode`, in all three of the places it shows.
 *
 * Three readings, because three things have to agree and they are set by
 * different mechanisms. The class on `<html>` drives Nuxt UI's tokens, and so
 * everything this application draws. `color-scheme` is what the browser
 * dresses its *own* furniture with — scrollbars, form chrome, autofill — and
 * comes from a CSS rule keyed off that class, so a page can be half dark
 * without it. The button's label is the part a person who cannot see the page
 * has to go on, and it names the preference: `system`, with what it resolved
 * to, is a different answer from choosing that scheme outright.
 *
 * The absent-class check is not redundant: leaving `light` behind while adding
 * `dark` would satisfy the first assertion and still leave Tailwind's `light`
 * variant matching everything underneath.
 */
async function expectTheme(
  page: Page,
  mode: "light" | "dark",
  preference: "system" | "light" | "dark",
): Promise<void> {
  const root = page.locator("html");
  await expect(root).toHaveClass(asClass(mode));
  await expect(root).not.toHaveClass(asClass(mode === "dark" ? "light" : "dark"));
  await expect(root).toHaveCSS("color-scheme", mode);
  await expect(toggle(page)).toHaveAttribute(
    "aria-label",
    preference === "system" ? `Theme: system (${mode})` : `Theme: ${preference}`,
  );
}

/** Open the menu and pick an entry, checking it is then the ticked one. */
async function choose(page: Page, entry: "System" | "Light" | "Dark"): Promise<void> {
  await toggle(page).click();
  await page.getByRole("menuitemcheckbox", { name: entry }).click();
  await toggle(page).click();
  await expect(page.getByRole("menuitemcheckbox", { name: entry })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
}

async function reload(page: Page, appUrl: string): Promise<void> {
  await page.goto(`${appUrl}/issues`);
  await expect(page.getByTestId("issue-list")).toBeVisible();
}

test.describe("a browser that prefers dark", () => {
  test.use({ colorScheme: "dark" });

  test("is taken at its word, with nothing stored", async ({ signedIn }) => {
    await expectTheme(signedIn, "dark", "system");
  });

  // The regression in #qb86kmp0. The browser prefers dark, so a page pinned to
  // light and a page following the system look different — which they do not
  // under a browser that prefers light, where this went unnoticed.
  test("is followed again once system is chosen after light, across a reload", async ({
    signedIn,
    stack,
  }) => {
    await choose(signedIn, "Light");
    await expectTheme(signedIn, "light", "light");

    await choose(signedIn, "System");
    await expectTheme(signedIn, "dark", "system");

    await reload(signedIn, stack.appUrl);
    await expectTheme(signedIn, "dark", "system");
  });
});

test.describe("a browser that prefers light", () => {
  test.use({ colorScheme: "light" });

  test("is taken at its word, with nothing stored", async ({ signedIn }) => {
    await expectTheme(signedIn, "light", "system");
  });

  test("is overruled by the menu, and stays overruled across a reload", async ({
    signedIn,
    stack,
  }) => {
    await choose(signedIn, "Dark");
    await expectTheme(signedIn, "dark", "dark");

    // The reload is the point: the browser still prefers light, so a page that
    // came back light would mean the choice had not been written down.
    await reload(signedIn, stack.appUrl);
    await expectTheme(signedIn, "dark", "dark");
  });
});

test.describe("a browser whose scheme changes under an open page", () => {
  test.use({ colorScheme: "light" });

  test("is followed while the preference is system", async ({ signedIn }) => {
    await expectTheme(signedIn, "light", "system");

    await signedIn.emulateMedia({ colorScheme: "dark" });
    await expectTheme(signedIn, "dark", "system");
  });

  test("is ignored while a scheme is chosen outright", async ({ signedIn }) => {
    await choose(signedIn, "Light");

    await signedIn.emulateMedia({ colorScheme: "dark" });
    await expectTheme(signedIn, "light", "light");
  });
});
