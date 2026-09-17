/**
 * What the browser calls each page.
 *
 * The title is the only thing about a page that the page itself never shows,
 * which is how every one of them came to be called `Navbook` and nobody's
 * test noticed. It is also the only part of a page that outlives the visit —
 * it is what a history entry, a bookmark and a tab are named after — so it is
 * asserted here, where a real browser is the one thing that can report it.
 *
 * The detail pages are matched loosely on purpose. What has to hold is the
 * shape — the reference people search their history for, then the subject,
 * then the application — and not the fixture's wording, which the other specs
 * already edit.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("names each listing, so a history entry says which one it is", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn).toHaveTitle("Issues · Navbook");

  await signedIn.goto(`${stack.appUrl}/prs`);
  await expect(signedIn).toHaveTitle("Pull requests · Navbook");

  await signedIn.goto(`${stack.appUrl}/features`);
  await expect(signedIn).toHaveTitle("Features · Navbook");

  await signedIn.goto(`${stack.appUrl}/inbox`);
  await expect(signedIn).toHaveTitle("Inbox · Navbook");

  await signedIn.goto(`${stack.appUrl}/issues/new`);
  await expect(signedIn).toHaveTitle("New issue · Navbook");
});

test("names an issue and a pull request after the thing under it", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();
  await expect(signedIn).toHaveTitle(/^#aaaa0001 .+ · Navbook$/);

  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn).toHaveTitle(/^#bbbb0001 .+ · Navbook$/);
});

test("names a feature, and a document within it", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/features/authentication`);
  await expect(signedIn).toHaveTitle("Authentication · Navbook");

  await signedIn.goto(`${stack.appUrl}/features/authentication/login-flow.md`);
  await expect(signedIn).toHaveTitle("Login flow — Authentication · Navbook");
});

test("gives two different pages two different titles", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  const listing = await signedIn.title();

  await signedIn.getByTestId("issue-row-aaaa0001").click();
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();
  // Navigating within the app has to retitle it: the static shell is served
  // once and every route after the first is the router's, not the server's.
  await expect(signedIn).not.toHaveTitle(listing);
});
