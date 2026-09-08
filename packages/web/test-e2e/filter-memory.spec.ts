/**
 * A listing, come back to.
 *
 * The filter is the address (`useEntityFilter`), which is why the navbar used
 * to lose it: a tab linking to a bare `/issues` asks for the default listing
 * and gets it. So each tab now carries the address its listing was last at.
 *
 * What has to be proved is a pair of opposites, and only a real browser can do
 * it — the memory is written on every route change and read back out of
 * `sessionStorage` across a reload. A tab must come back to what was left
 * there; and a bare address, typed or shared, must still mean the default
 * listing, because that is the whole reason the filter lives in the URL.
 *
 * The fixture decides the filters used here. `aaaa0006` is the only closed
 * issue and `cafe0005` the only one without the `bug` label, so a status or a
 * label is visible in the rows as well as in the address. Both pull requests
 * are open, so the pull request side filters on a word instead: only
 * `bbbb0001` is about a deadline.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("reopens each listing as it was left, and keeps the two apart", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();

  // Nothing has been remembered for the other tab yet, so it is still bare.
  await signedIn.getByTestId("nav-prs").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/prs`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();

  await signedIn.getByTestId("filter-text").fill("deadline");
  await signedIn.getByTestId("filter-text").press("Enter");
  await expect(signedIn).toHaveURL(`${stack.appUrl}/prs?q=deadline`);

  // Each tab has its own filter, and neither is the other's.
  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toHaveCount(0);

  await signedIn.getByTestId("nav-prs").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/prs?q=deadline`);
  await expect(signedIn.getByTestId("filter-text")).toHaveValue("deadline");
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
});

test("comes back to the listing from a page that is not one", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?label=bug`);
  await signedIn.getByTestId("issue-row-aaaa0001").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001/);

  // Only a listing has a filter, so only a listing is remembered: a detail
  // page must not be able to overwrite the list that was left behind.
  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?label=bug`);
  await expect(signedIn.getByTestId("issue-row-cafe0005")).toHaveCount(0);
});

test("takes the brand link home rather than back to a filter", async ({ signedIn, stack }) => {
  // The one link in the header that does not remember. The tab beside it comes
  // back to the issues as they were left, and two adjacent links that did the
  // same thing would be one link drawn twice.
  await signedIn.goto(`${stack.appUrl}/issues?label=bug`);
  await signedIn.getByTestId("nav-prs").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/prs`);

  await signedIn.getByTestId("nav-brand").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=open`);

  // Home is now what the tab remembers, because it is where the listing was
  // left — arriving by the wordmark is still arriving.
  await signedIn.getByTestId("nav-prs").click();
  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=open`);
});

test("remembers the filter and not the branch toggle", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs`);
  await signedIn.getByTestId("all-refs").click();
  await expect(signedIn).toHaveURL(/refs=all/);
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toBeVisible();

  // Both pull requests are open, so this filter changes the address without
  // changing the rows — which is what makes the toggle's absence visible
  // afterwards rather than confounded with it.
  await signedIn.getByTestId("filter-status-open").click();
  await expect(signedIn).toHaveURL(/status=open/);
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toBeVisible();

  await signedIn.getByTestId("nav-issues").click();
  await signedIn.getByTestId("nav-prs").click();

  // Scanning every fetched branch is a heavier way to look, not a filter, and
  // is asked for again rather than remembered.
  await expect(signedIn).toHaveURL(`${stack.appUrl}/prs?status=open`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toHaveCount(0);
});

test("leaves a bare address meaning the default listing", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).toHaveURL(/status=closed/);

  // Typed, bookmarked or sent by somebody else: it is the default listing, and
  // nothing may redirect it to what this browser was last looking at. A bare
  // `/issues` filters by nothing at all, so the closed issue is in it.
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();

  // And it is now what the tab remembers, because it is what was left there.
  await signedIn.getByTestId("nav-prs").click();
  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues`);
});

test("outlasts a reload, since it is where you were and not what you typed", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).toHaveURL(/status=closed/);

  await signedIn.getByTestId("nav-prs").click();
  await expect(signedIn.getByTestId("pr-list")).toBeVisible();

  // The reload is the point: everything in memory goes, so an issues tab that
  // still knows where it was is one that wrote it down.
  await signedIn.reload();
  await expect(signedIn.getByTestId("pr-list")).toBeVisible();

  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
});
