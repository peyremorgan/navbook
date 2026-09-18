/**
 * Taking the work, and putting it back down.
 *
 * The button exists because the commonest assignee of anything is whoever is
 * reading it, and reaching that value through a directory of everybody is a
 * poor way to say "mine". So what is proved here is a round trip in two
 * clicks, on both pages that have the panel, for somebody the repository has
 * never heard of — which is also the case the spelling has to be composed for.
 *
 * The identity is fresh each run because the suite shares one repository and
 * every mutation commits: a name minted here is on no entity and in no
 * history, so an assignee bearing it afterwards can only be this button's
 * doing.
 *
 * Asserted on the name rather than the address because the two pages show the
 * same field differently — the issue page keeps the component's chips, which
 * carry the whole `Name <address>`, and the pull request page replaces them
 * with the avatars it already showed, which carry only the name.
 */

import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./helpers/fixtures.ts";

/** An identity no fixture and no history holds. */
function stranger(what: string): { name: string; email: string } {
  const stamp = Date.now();
  return { name: `Taking On ${what} ${stamp}`, email: `mine-${what}-${stamp}@example.invalid` };
}

/** Assign, read it back, unassign, read that back. */
async function roundTrip(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  const panel = page.getByTestId("sidebar-assignees");
  await expect(panel).not.toContainText(name);

  await page.getByTestId("self-assignees").click();
  await expect(panel).toContainText(name);

  // The same control, now offering the opposite: one button, not two.
  await page.getByTestId("self-assignees").click();
  await expect(panel).not.toContainText(name);
}

test("assigns an issue to the signed-in person, and takes it back off", async ({ page, stack }) => {
  const who = stranger("issue");
  await signIn(page, stack, who);
  await roundTrip(page, `${stack.appUrl}/issues/aaaa0001`, who.name);
});

test("does the same for a pull request", async ({ page, stack }) => {
  const who = stranger("pr");
  await signIn(page, stack, who);
  await roundTrip(page, `${stack.appUrl}/prs/bbbb0001`, who.name);
});

test("survives a reload, because it wrote to the file", async ({ page, stack }) => {
  const who = stranger("kept");
  await signIn(page, stack, who);
  const panel = page.getByTestId("sidebar-assignees");

  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await page.getByTestId("self-assignees").click();
  await expect(panel).toContainText(who.name);

  await page.reload();
  await expect(panel).toContainText(who.name);

  // Leave the fixture as it was found.
  await page.getByTestId("self-assignees").click();
  await expect(panel).not.toContainText(who.name);
});
