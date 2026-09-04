/**
 * The theme, which nobody should have to set.
 *
 * The default is whatever the browser already says about `prefers-color-scheme`,
 * and the navbar button is for disagreeing with it. Those are two different
 * mechanisms — a media query read before first paint, and a preference read
 * back out of storage — so both are exercised here, against a browser told to
 * prefer each scheme in turn.
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
 * has to go on, and it names where pressing it would *go*, not where it is.
 *
 * The absent-class check is not redundant: leaving `light` behind while adding
 * `dark` would satisfy the first assertion and still leave Tailwind's `light`
 * variant matching everything underneath.
 */
async function expectTheme(page: Page, mode: "light" | "dark"): Promise<void> {
  const root = page.locator("html");
  await expect(root).toHaveClass(asClass(mode));
  await expect(root).not.toHaveClass(asClass(mode === "dark" ? "light" : "dark"));
  await expect(root).toHaveCSS("color-scheme", mode);
  await expect(toggle(page)).toHaveAttribute(
    "aria-label",
    mode === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

test.describe("a browser that prefers dark", () => {
  test.use({ colorScheme: "dark" });

  test("is taken at its word, with nothing stored", async ({ signedIn }) => {
    await expectTheme(signedIn, "dark");
  });
});

test.describe("a browser that prefers light", () => {
  test.use({ colorScheme: "light" });

  test("is taken at its word, with nothing stored", async ({ signedIn }) => {
    await expectTheme(signedIn, "light");
  });

  test("is overruled by the button, and stays overruled across a reload", async ({
    signedIn,
    stack,
  }) => {
    await toggle(signedIn).click();
    await expectTheme(signedIn, "dark");

    // The reload is the point: the browser still prefers light, so a page that
    // came back light would mean the choice had not been written down.
    await signedIn.goto(`${stack.appUrl}/issues`);
    await expect(signedIn.getByTestId("issue-list")).toBeVisible();

    await expectTheme(signedIn, "dark");
  });

  test("goes back to light when the button is pressed again", async ({ signedIn }) => {
    await toggle(signedIn).click();
    await expectTheme(signedIn, "dark");

    await toggle(signedIn).click();
    await expectTheme(signedIn, "light");
  });
});
