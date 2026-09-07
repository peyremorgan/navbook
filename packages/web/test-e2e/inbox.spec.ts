/**
 * The inbox, which is the one page that is about a person rather than about the
 * repository.
 *
 * So the fixture's two identities are both used. `A Person` — who the suite
 * signs in as — is assigned an issue and a pull request and is asked to review
 * a second pull request, which is on a branch the serving checkout does not
 * hold: that last one is the case that would be missing if the inbox asked the
 * working tree the way the listing does by default.
 *
 * `Navbook Dev Server` wrote everything in the fixture, so signing in as it is
 * how the authored half is reached — and, since it is also an assignee of the
 * pull request it wrote, how one entity arriving in two answers is proved to be
 * one row.
 *
 * None of it depends on what another spec left behind: nothing in the suite
 * ever writes an assignee, and the review request that is asserted is on the
 * branch nothing can write to.
 */

import { chooseOrCreate, expect, signIn, test } from "./helpers/fixtures.ts";

/** The rail's count for one entry, which is what clicking it would show. */
const count = (page: import("@playwright/test").Page, testid: string) =>
  page.getByTestId(`${testid}-count`);

test("holds what is assigned to this person and what waits on their review", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);
  await expect(signedIn.getByTestId("inbox-list")).toBeVisible();

  const assigned = signedIn.getByTestId("inbox-row-aaaa0001");
  await expect(assigned).toBeVisible();
  await expect(assigned.getByTestId("inbox-reason-assigned")).toBeVisible();

  const alsoAssigned = signedIn.getByTestId("inbox-row-bbbb0001");
  await expect(alsoAssigned).toBeVisible();
  await expect(alsoAssigned.getByTestId("inbox-reason-assigned")).toBeVisible();

  // Nothing of anybody else's: this issue is assigned to Someone Else, and
  // authored by them too.
  await expect(signedIn.getByTestId("inbox-row-cafe0005")).toHaveCount(0);
});

test("finds a review it owes on a branch the checkout does not hold", async ({
  signedIn,
  stack,
}) => {
  // The listing needs its every-branch toggle for this pull request. The inbox
  // does not have one, because a person's own work is exactly what a serving
  // checkout is least likely to be standing on.
  await signedIn.goto(`${stack.appUrl}/inbox`);
  const owed = signedIn.getByTestId("inbox-row-bbbb0002");
  await expect(owed).toBeVisible();
  await expect(owed.getByTestId("inbox-reason-awaiting")).toBeVisible();
  await expect(owed).toContainText("Draft");
});

test("holds an entity once, however many answers it came back in", async ({ page, stack }) => {
  // Who wrote the fixture, and who the served pull request is also assigned to.
  await signIn(page, stack, { name: "Navbook Dev Server", email: "dev-server@example.invalid" });
  await page.goto(`${stack.appUrl}/inbox`);

  const both = page.getByTestId("inbox-row-bbbb0001");
  await expect(both).toHaveCount(1);
  await expect(both.getByTestId("inbox-reason-assigned")).toBeVisible();
  await expect(both.getByTestId("inbox-reason-author")).toBeVisible();

  // Written, and not asked of this person, so it is here for the one reason.
  const written = page.getByTestId("inbox-row-bbbb0002");
  await expect(written.getByTestId("inbox-reason-author")).toBeVisible();
  await expect(written.getByTestId("inbox-reason-awaiting")).toHaveCount(0);

  // Issues this person merely filed are not somebody's inbox, and it filed
  // every issue in the fixture.
  await expect(page.getByTestId("inbox-row-aaaa0001")).toHaveCount(0);
});

test("shows finished work only when asked, and says so in the URL", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);
  await expect(signedIn.getByTestId("inbox-row-aaaa0006")).toHaveCount(0);

  await signedIn.getByTestId("inbox-finished").click();
  await expect(signedIn).toHaveURL(/status=all/);
  // Assigned, and then closed.
  await expect(signedIn.getByTestId("inbox-row-aaaa0006")).toBeVisible();
  // The open ones are still there: this widens, it does not swap.
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toBeVisible();

  await signedIn.getByTestId("inbox-finished").click();
  await expect(signedIn).not.toHaveURL(/status=/);
  await expect(signedIn.getByTestId("inbox-row-aaaa0006")).toHaveCount(0);
});

test("arrives with finished work shown when the URL says so", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox?status=all`);
  await expect(signedIn.getByTestId("inbox-row-aaaa0006")).toBeVisible();
  await expect(signedIn.getByTestId("inbox-finished")).toHaveAttribute("aria-checked", "true");
});

test("counts each rail entry as what choosing it would show", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);
  await expect(signedIn.getByTestId("inbox-list")).toBeVisible();

  await expect(count(signedIn, "inbox-view-everything")).toHaveText("3");
  await expect(count(signedIn, "inbox-view-assigned")).toHaveText("2");
  await expect(count(signedIn, "inbox-view-authored")).toHaveText("0");
  await expect(count(signedIn, "inbox-view-reviews")).toHaveText("1");
  await expect(count(signedIn, "inbox-kind-issue")).toHaveText("1");
  await expect(count(signedIn, "inbox-kind-pr")).toHaveText("2");

  // Faceted: with only issues in play, the reasons count only issues.
  await signedIn.getByTestId("inbox-kind-issue").click();
  await expect(count(signedIn, "inbox-view-everything")).toHaveText("1");
  await expect(count(signedIn, "inbox-view-reviews")).toHaveText("0");
  // And the kind group still counts as though it were the one being chosen,
  // which is what makes "Anything" the way back.
  await expect(count(signedIn, "inbox-kind-any")).toHaveText("3");
});

test("puts the rail in the address bar, and reads it back", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);

  await signedIn.getByTestId("inbox-view-reviews").click();
  await expect(signedIn).toHaveURL(/view=reviews/);
  await expect(signedIn.getByTestId("inbox-row-bbbb0002")).toBeVisible();
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toHaveCount(0);
  await expect(signedIn.getByTestId("inbox-view-reviews")).toHaveAttribute("aria-pressed", "true");

  // Two groups narrow together, and both are in the URL.
  await signedIn.getByTestId("inbox-kind-issue").click();
  await expect(signedIn).toHaveURL(/view=reviews/);
  await expect(signedIn).toHaveURL(/kind=issue/);
  await expect(signedIn.getByText("Nothing matches this view")).toBeVisible();

  // The entry meaning "no narrowing" takes its parameter back out.
  await signedIn.getByTestId("inbox-view-everything").click();
  await expect(signedIn).not.toHaveURL(/view=/);
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toBeVisible();
});

test("narrows to one feature, and offers one nothing carries so it can be dropped", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/inbox?feature=authentication`);
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("inbox-row-bbbb0002")).toHaveCount(0);
  await expect(signedIn.getByTestId("inbox-feature-authentication")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A slug the inbox does not hold is still shown, or there would be no
  // control to take it off with.
  await signedIn.goto(`${stack.appUrl}/inbox?feature=nothing-carries-this`);
  await expect(signedIn.getByText("Nothing matches this view")).toBeVisible();
  await expect(count(signedIn, "inbox-feature-nothing-carries-this")).toHaveText("0");
  await signedIn.getByTestId("inbox-feature-any").click();
  await expect(signedIn).not.toHaveURL(/feature=/);
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toBeVisible();
});

test("searches the same words the listings do", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox?q=unreliable`);
  await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("inbox-row-bbbb0002")).toHaveCount(0);

  await signedIn.getByTestId("inbox-search").fill("deadline");
  await signedIn.getByTestId("inbox-search").press("Enter");
  await expect(signedIn).toHaveURL(/[?&]q=deadline/);
  await expect(signedIn.getByTestId("inbox-row-bbbb0001")).toBeVisible();

  await signedIn.getByTestId("inbox-search").fill("nothingmatchesthis");
  await signedIn.getByTestId("inbox-search").press("Enter");
  await expect(signedIn.getByText("Nothing in your inbox")).toBeVisible();
});

test("names the address it looked for when there is nothing", async ({ page, stack }) => {
  // An inbox empty because the tree spells somebody's name a second way looks
  // exactly like one that is empty because there is nothing to do. This is the
  // only place the difference can be noticed.
  await signIn(page, stack, { name: "Nobody", email: "nobody@example.invalid" });
  await page.goto(`${stack.appUrl}/inbox`);
  await expect(page.getByText("Nothing in your inbox")).toBeVisible();
  await expect(page.getByText("nobody@example.invalid")).toBeVisible();
  await expect(page.getByTestId("inbox-list")).toHaveCount(0);
});

test("opens a row where it lives", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);
  await signedIn.getByTestId("inbox-row-bbbb0002").getByRole("link").first().click();
  await expect(signedIn).toHaveURL(/\/prs\/bbbb0002/);
  await expect(signedIn.getByTestId("pr-title")).toContainText("does not serve");
});

test("is reached from the account menu", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  // The menu carries the name the server answered with, so it is not there
  // until that answer is.
  await signedIn.getByTestId("account-menu").click();
  await signedIn.getByRole("menuitem", { name: "Inbox" }).click();
  await expect(signedIn).toHaveURL(/\/inbox/);
  await expect(signedIn.getByTestId("inbox-list")).toBeVisible();
});

test("holds work the moment it is given to somebody", async ({ page, stack }) => {
  // A fresh address each run, because the suite shares one repository: an
  // inbox asserted to hold one thing must not depend on nobody having put
  // something in it before.
  const who = `newcomer-${Date.now()}@example.invalid`;
  await signIn(page, stack, { name: "A Newcomer", email: who });

  // Filing an issue does not put it in anybody's inbox — asking for work is
  // not taking it on — so this starts empty even though they wrote it.
  await page.goto(`${stack.appUrl}/issues/new`);
  await page.getByTestId("new-title").fill("Something for whoever picks it up");
  await page.getByTestId("new-body").fill("Filed, and not taken.");
  await page.getByTestId("submit-issue").click();
  await expect(page.getByTestId("issue-detail")).toBeVisible();
  const id = (await page.getByTestId("issue-id").innerText()).replace("#", "");

  await page.goto(`${stack.appUrl}/inbox`);
  await expect(page.getByText("Nothing in your inbox")).toBeVisible();

  await page.goto(`${stack.appUrl}/issues/${id}`);
  await page.getByTestId("edit-assignees").click();
  await chooseOrCreate(page, "input-assignees", who);
  await page.getByTestId("save-assignees").click();
  await expect(page.getByTestId("sidebar-assignees")).toContainText(who);

  await page.goto(`${stack.appUrl}/inbox`);
  await expect(page.getByTestId(`inbox-row-${id}`)).toBeVisible();
  await expect(page.getByTestId("inbox-count")).toHaveText("Showing 1 of 1");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps every rail control reachable, as chips above the list", async ({
    signedIn,
    stack,
  }) => {
    await signedIn.goto(`${stack.appUrl}/inbox`);
    await expect(signedIn.getByTestId("inbox-view-reviews")).toBeVisible();
    await expect(signedIn.getByTestId("inbox-kind-pr")).toBeVisible();

    await signedIn.getByTestId("inbox-view-reviews").click();
    await expect(signedIn).toHaveURL(/view=reviews/);
    await expect(signedIn.getByTestId("inbox-row-bbbb0002")).toBeVisible();
    await expect(signedIn.getByTestId("inbox-row-aaaa0001")).toHaveCount(0);
  });
});
