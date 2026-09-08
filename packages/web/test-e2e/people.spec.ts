/**
 * The menus that name a person, and where their options come from.
 *
 * What is proved here is that these are not the listing's values any more.
 * Each assertion names somebody a listing could not have offered: the machine
 * account, which authors nearly everything and is assigned nothing on an
 * issue; a pull request's assignee, which no issue listing mentions; and the
 * signed-in person, who on their first visit is written nowhere at all.
 *
 * The fixture's git identity is the machine account — it commits every seeded
 * entity — so the history half of the answer is empty here by construction,
 * and everybody below arrives through the tree or through the token. The
 * server's own suite is where the history half is proved.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, signIn, test } from "./helpers/fixtures.ts";

const MACHINE = "Navbook Dev Server <dev-server@example.invalid>";
const ASSIGNEE = "A Person <person@example.invalid>";

/**
 * The options one menu is showing, having opened it.
 *
 * Scoped to the list that menu controls rather than to every option on the
 * page: a menu leaves its options in the document after it is closed, and the
 * menus here are now offered the same list — so an unscoped search finds the
 * previous menu's copy of a person beside this one's, which is a true thing
 * reported as a failure.
 */
async function optionsOf(page: Page, testid: string): Promise<Locator> {
  const trigger = page.getByTestId(testid);
  await trigger.click();
  const listbox = await trigger.getAttribute("aria-controls");
  expect(listbox, `no list is controlled by ${testid}`).not.toBeNull();
  return page.locator(`#${listbox}`).getByRole("option");
}

test("offers everyone the repository knows of as an assignee", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("edit-assignees").click();
  const options = await optionsOf(signedIn, "input-assignees");

  // Every entity's author, and the assignee of a pull request. Neither is an
  // assignee of any issue, so the listing this menu used to read never had it.
  await expect(options.filter({ hasText: MACHINE })).toBeVisible();
  await expect(options.filter({ hasText: ASSIGNEE })).toBeVisible();
  await signedIn.keyboard.press("Escape");
});

test("offers a person nothing has been written about yet", async ({ page, stack }) => {
  // Fresh each run, because the suite shares one repository: this address is
  // in no file and no history, so only the token can be why it is offered.
  const who = `arrival-${Date.now()}@example.invalid`;
  await signIn(page, stack, { name: "A New Arrival", email: who });

  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await page.getByTestId("edit-assignees").click();
  const options = await optionsOf(page, "input-assignees");
  await expect(options.filter({ hasText: `A New Arrival <${who}>` })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("offers them for a review, and not only whoever was already asked", async ({
  signedIn,
  stack,
}) => {
  // This pull request asks `someone@example.invalid` and nobody else, which
  // was the whole of what this menu used to offer.
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await signedIn.getByTestId("edit-reviewers").click();
  const options = await optionsOf(signedIn, "input-reviewers");
  await expect(options.filter({ hasText: ASSIGNEE })).toBeVisible();
  await expect(options.filter({ hasText: MACHINE })).toBeVisible();
  await signedIn.keyboard.press("Escape");
});

test("offers them to filter a listing by, on both listings", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  const assignees = await optionsOf(signedIn, "filter-assignees");
  await expect(assignees.filter({ hasText: MACHINE })).toBeVisible();
  await signedIn.keyboard.press("Escape");

  // The author menu is offered the same list: `author:` and `assignee:` name
  // the same kind of thing, and a listing showed only the authors it held.
  const authors = await optionsOf(signedIn, "filter-authors");
  await expect(authors.filter({ hasText: ASSIGNEE })).toBeVisible();
  await signedIn.keyboard.press("Escape");

  await signedIn.goto(`${stack.appUrl}/prs`);
  const reviewers = await optionsOf(signedIn, "filter-reviewers");
  await expect(reviewers.filter({ hasText: ASSIGNEE })).toBeVisible();
  await signedIn.keyboard.press("Escape");
});

test("knows somebody the moment they are given something", async ({ page, stack }) => {
  const who = `given-${Date.now()}@example.invalid`;
  await signIn(page, stack, { name: "Given Work", email: who });

  // Assigned to somebody nothing names, from an address that is not theirs:
  // the viewer cannot be why they are offered afterwards.
  const stranger = `stranger-${Date.now()}@example.invalid`;
  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await page.getByTestId("edit-assignees").click();
  await page.getByTestId("input-assignees").click();
  await page.getByPlaceholder("Search…").fill(stranger);
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await page.getByTestId("save-assignees").click();
  await expect(page.getByTestId("sidebar-assignees")).toContainText(stranger);

  // A different page, and a different menu, without a reload: the write forgot
  // the answer that was fetched before they existed.
  await page.goto(`${stack.appUrl}/issues/new`);
  const options = await optionsOf(page, "new-assignees");
  await expect(options.filter({ hasText: stranger })).toBeVisible();
  await page.keyboard.press("Escape");
});
