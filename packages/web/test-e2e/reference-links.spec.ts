/**
 * Following a `#id` written in prose.
 *
 * What is worth proving in a browser is the half the unit suite cannot reach.
 * The renderer's output is a string, so `markdown.test.ts` can assert the
 * anchor exists; whether clicking it moves within the app rather than
 * reloading it, and whether `/ref/:id` finds the right kind of entity, are
 * facts about a router, a GraphQL API and a repository together.
 *
 * The fixture's served pull request says "Closes the subtask under #aaaa0001"
 * in its body, which is the reference this clicks.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("follows a reference from a body to what it names", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn.getByTestId("pr-detail")).toBeVisible();

  const reference = signedIn.locator(".nav-markdown a.nav-reference", { hasText: "#aaaa0001" });
  await expect(reference).toBeVisible();
  await reference.click();

  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001$/);
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#aaaa0001");
});

test("stays in the app, and leaves the page it came from one step back", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn.getByTestId("pr-detail")).toBeVisible();

  // Nothing on the page is reloaded, so a value set on the page's globals
  // survives the navigation only if the router did it. A full page load — what
  // a plain anchor into a single-page app costs — would lose it.
  await signedIn.evaluate(() => {
    (globalThis as { navbookSameDocument?: boolean }).navbookSameDocument = true;
  });

  await signedIn.locator(".nav-markdown a.nav-reference", { hasText: "#aaaa0001" }).click();
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#aaaa0001");
  expect(
    await signedIn.evaluate(
      () => (globalThis as { navbookSameDocument?: boolean }).navbookSameDocument === true,
    ),
  ).toBe(true);

  // `/ref/:id` redirects with `replace`, so Back is the pull request rather
  // than the resolver bouncing forward again.
  await signedIn.goBack();
  await expect(signedIn).toHaveURL(/\/prs\/bbbb0001$/);
  await expect(signedIn.getByTestId("pr-detail")).toBeVisible();
});

test("resolves a reference that names a pull request", async ({ signedIn, stack }) => {
  // An id says nothing about its kind, so the route asks about issues first
  // and falls back — this is the fall.
  await signedIn.goto(`${stack.appUrl}/ref/bbbb0001`);
  await expect(signedIn).toHaveURL(/\/prs\/bbbb0001$/);
  await expect(signedIn.getByTestId("pr-title")).toContainText("Raise the sign-in deadline");
});

test("says so when a reference matches nothing here", async ({ signedIn, stack }) => {
  // Dangling is normal rather than a fault: the target may live on a branch
  // this server has not fetched (spec 02 §2.9).
  await signedIn.goto(`${stack.appUrl}/ref/dddd9999`);
  await expect(signedIn.getByTestId("reference-dangling")).toBeVisible();
  await expect(signedIn.getByTestId("reference-dangling")).toContainText("#dddd9999");
});
