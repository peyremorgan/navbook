/**
 * Taking the work, and putting it back down.
 *
 * The button exists because the commonest assignee of anything is whoever is
 * reading it, and reaching that value through a directory of everybody is a
 * poor way to say "mine". So what is proved here is a round trip in two
 * clicks, on both pages that have the panel, for somebody the repository has
 * never heard of — which is also the case the spelling has to be composed for.
 * Each half is read back from a reloaded page, so what is proved is a write to
 * the file rather than the optimistic overlay agreeing with the click.
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

/**
 * Assign, read it back, unassign, read that back — each half through a reload.
 *
 * The reload is the whole point of the assertion and not ceremony around it.
 * The page overlays a pending edit, so the panel says what was clicked before
 * the server has answered: a test that stopped at the overlay would end there,
 * abort the request it never waited for, and pass whether or not anything was
 * ever written — leaving the fixture dirty for whatever runs next. Reading it
 * back from a fresh page is what distinguishes a save from a hope.
 */
async function roundTrip(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  const panel = page.getByTestId("sidebar-assignees");
  await expect(panel).not.toContainText(name);

  await page.getByTestId("self-assignees").click();
  await expect(panel).toContainText(name);
  await page.reload();
  await expect(panel).toContainText(name);

  // The same control, now offering the opposite: one button, not two.
  await page.getByTestId("self-assignees").click();
  await expect(panel).not.toContainText(name);
  await page.reload();
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
