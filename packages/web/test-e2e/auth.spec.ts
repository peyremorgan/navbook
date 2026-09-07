/**
 * Signing in, which is not optional: the API answers nothing without a token.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("sends an unauthenticated visitor to the provider and brings them back", async ({
  page,
  stack,
}) => {
  await page.goto(`${stack.appUrl}/issues`);

  // The route middleware found no usable token and left for the provider.
  await page.waitForURL(/\/authorize\?/);
  expect(page.url()).toContain("code_challenge_method=S256");
  expect(page.url()).toContain("response_type=code");

  await page.fill("#name", "A Person");
  await page.fill("#email", "person@example.invalid");
  await page.click("button[type=submit]");

  await page.waitForURL(new RegExp(`^${stack.appUrl}/issues`));
  await expect(page.getByTestId("issue-list")).toBeVisible();
});

test("comes back to the page that was asked for, not the front one", async ({ page, stack }) => {
  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await page.waitForSelector("#email");
  await page.click("button[type=submit]");

  await page.waitForURL(/\/issues\/aaaa0001/);
  await expect(page.getByTestId("issue-title")).toContainText("Sign-in is unreliable");
});

test("comes back to the open issues after walking in through the root", async ({ page, stack }) => {
  // The front door and the guard have to agree. `/` is a redirect record, so
  // an anonymous visitor there is bounced twice — once by the router and once
  // by the middleware — and what they must not end up with is the unfiltered
  // listing that `/` used to mean.
  await page.goto(stack.appUrl);
  await page.waitForSelector("#email");
  await page.click("button[type=submit]");

  await page.waitForURL(`${stack.appUrl}/issues?status=open`);
  await expect(page.getByTestId("issue-list")).toBeVisible();
  await expect(page.getByTestId("filter-status-open")).toHaveAttribute("aria-pressed", "true");
});

test("shows who the server thinks is acting", async ({ page, stack }) => {
  await page.goto(`${stack.appUrl}/issues`);
  await page.waitForSelector("#email");
  await page.fill("#name", "Someone Else");
  await page.fill("#email", "someone.else@example.invalid");
  await page.click("button[type=submit]");
  await page.waitForSelector("[data-testid=issue-list]");

  // Read back from `viewer`, so this is what the *server* took out of the
  // token, not what was typed into the form a moment ago.
  await expect(page.getByRole("banner")).toContainText("Someone Else");

  // The address is the part that matters, because it is what every issue and
  // comment will record as its author. It is one click away.
  await page.getByRole("banner").getByRole("button").last().click();
  await expect(page.getByText("someone.else@example.invalid")).toBeVisible();
});

test("keeps the session across a reload rather than signing in again", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
  expect(signedIn.url()).not.toContain("/authorize");
});

test("stays signed out after signing out", async ({ signedIn }) => {
  await signedIn.getByRole("banner").getByRole("button").last().click();
  await signedIn.getByRole("menuitem", { name: "Sign out" }).click();

  // Not back at the provider: every other route needs a token, so landing on
  // one would bounce straight there — and a provider holding a session cookie
  // would sign the person back in without asking.
  await expect(signedIn.getByTestId("signed-out")).toBeVisible();
  expect(signedIn.url()).not.toContain("/authorize");

  // And the token really is gone: a guarded route now needs the provider.
  await signedIn.getByTestId("sign-in-again").click();
  await signedIn.waitForURL(/\/authorize\?/);
});
