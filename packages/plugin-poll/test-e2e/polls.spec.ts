/**
 * Polls in the browser: opened from an issue's sidebar, shown in its
 * discussion, voted on by two people, revoked by an edit, closed on a tie
 * only a person can break, and found again through the inbox, the listing's
 * filter and its badge.
 *
 * In order, because they share one issue and its poll, the way two people
 * using the tracker would. The issue is filed here, so nothing the fixture
 * holds is touched.
 */

import type { Browser, Page } from "@playwright/test";
import {
  expect,
  only,
  refusal,
  signIn,
  test,
  toasts,
} from "../../web/test-e2e/helpers/fixtures.ts";
import type { Stack } from "../../web/test-e2e/helpers/stack.ts";

test.describe.configure({ mode: "serial" });

let issue = "";
let poll = "";

/** The second voter: signed in on a page of their own. */
async function asBea(browser: Browser, stack: Stack): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, stack, { name: "Bea Voter", email: "bea@example.com" });
  return page;
}

const card = (page: Page) => page.getByTestId(`poll-card-${poll}`);
const question = (page: Page, id: string) => card(page).getByTestId(`poll-question-${id}`);

test("opens a poll from the sidebar, in the discussion where it was asked", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/new`);
  await signedIn.getByTestId("new-title").fill("Attachments");
  await signedIn.getByTestId("new-body").fill("Issues need attachments.");
  await signedIn.getByTestId("submit-issue").click();
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();
  issue = (await signedIn.getByTestId("issue-id").innerText()).replace("#", "");

  await signedIn.getByTestId("comment-body").fill("Before the poll.");
  await signedIn.getByTestId("comment-submit").click();
  await expect(signedIn.getByTestId("comment-thread")).toContainText("Before the poll.");

  const panel = signedIn.getByTestId("poll-panel");
  await expect(panel).toContainText("None yet.");
  await panel.getByTestId("poll-new").click();
  const editor = signedIn.getByTestId("poll-editor");
  await editor.getByTestId("poll-editor-title").fill("Attachment storage");
  await editor.getByTestId("poll-editor-preamble").fill("Where do we keep **attachments**?");
  const first = editor.getByTestId("poll-editor-question-1");
  await first.getByTestId("poll-editor-question-1-text").fill("Which storage backend?");
  await first.getByTestId("poll-editor-question-1-option-1-label").fill("S3-compatible");
  await first.getByTestId("poll-editor-question-1-option-1-description").fill("Cheap and durable.");
  await first.getByTestId("poll-editor-question-1-option-2-label").fill("Local disk");
  await first.getByRole("switch", { name: "Accept answers in other words" }).click();
  await editor.getByTestId("poll-editor-add-question").click();
  const second = editor.getByTestId("poll-editor-question-2");
  await second.getByTestId("poll-editor-question-2-text").fill("Which limits do we enforce?");
  await second.getByRole("switch", { name: "Any number of answers" }).click();
  await second.getByTestId("poll-editor-question-2-option-1-label").fill("Max file size");
  await second.getByTestId("poll-editor-question-2-option-2-label").fill("Max files per issue");
  await signedIn.getByTestId("poll-editor-save").click();
  await expect(toasts(signedIn)).toContainText("Poll opened");

  const opened = signedIn.locator("[data-testid^=poll-card-]");
  await expect(opened).toBeVisible();
  poll = ((await opened.getAttribute("data-testid")) ?? "").replace("poll-card-", "");
  expect(poll).toMatch(/^[a-z][a-z0-9]{7}$/);
  await expect(card(signedIn).getByTestId("poll-title")).toHaveText("Attachment storage");
  await expect(card(signedIn).locator("strong").first()).toHaveText("attachments");

  // Asked after the comment, so it stands after it in the thread.
  const thread = signedIn.getByTestId("comment-thread");
  const order = await thread
    .locator(":scope > *")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.querySelector("[data-testid^=poll-card-]") ? "poll" : "comment")),
    );
  expect(order).toEqual(["comment", "poll"]);
  await expect(panel.getByTestId(`poll-panel-${poll}`)).toContainText("Not voted");
});

test("hides the results until you vote, shows them when asked, and counts your vote", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/${issue}`);
  await expect(card(signedIn).getByTestId("poll-results-hidden")).toBeVisible();
  await card(signedIn).getByTestId("poll-results-toggle").click();
  await expect(card(signedIn).getByTestId("poll-results")).toBeVisible();
  await card(signedIn).getByTestId("poll-results-toggle").click();
  await expect(card(signedIn).getByTestId("poll-results-hidden")).toBeVisible();

  await question(signedIn, "q1").getByRole("radio", { name: "S3-compatible" }).click();
  await question(signedIn, "q2").getByRole("checkbox", { name: "Max file size" }).click();
  await card(signedIn).getByTestId("poll-note").fill("We run S3 already.");
  await card(signedIn).getByTestId("poll-submit").click();
  await expect(toasts(signedIn)).toContainText("Vote cast");
  await expect(card(signedIn).getByTestId("poll-voted")).toBeVisible();
  await expect(card(signedIn).getByTestId("poll-count-q1-s3-compatible")).toHaveText("1");
  await expect(card(signedIn).getByTestId("poll-count-q2-max-file-size")).toHaveText("1");
  await expect(card(signedIn).getByTestId("poll-submit")).toBeDisabled();
});

test("waits in a second person's inbox once they have a hand in the issue, until they vote", async ({
  browser,
  stack,
}) => {
  const bea = await asBea(browser, stack);
  await bea.goto(`${stack.appUrl}/issues/${issue}`);
  await bea.getByTestId("comment-body").fill("I have a view on this.");
  await bea.getByTestId("comment-submit").click();
  await expect(bea.getByTestId("comment-thread")).toContainText("I have a view on this.");

  await bea.goto(`${stack.appUrl}/inbox`);
  const row = bea.getByTestId(`inbox-row-${issue}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("inbox-reason-polls")).toBeVisible();
  await expect(bea.getByTestId("inbox-view-polls-count")).toHaveText("1");
  await bea.getByTestId("inbox-view-polls").click();
  await expect(bea).toHaveURL(/view=polls/);
  await expect(row).toBeVisible();

  await row.locator("a").first().click();
  await question(bea, "q1").getByRole("radio", { name: "Local disk" }).click();
  await card(bea).getByTestId("poll-submit").click();
  await expect(toasts(bea)).toContainText("Vote cast");
  await expect(card(bea).getByTestId("poll-count-q1-local-disk")).toHaveText("1");

  await bea.goto(`${stack.appUrl}/inbox?view=polls`);
  await expect(bea.getByTestId(`inbox-row-${issue}`)).toHaveCount(0);
  await bea.context().close();
});

test("revokes every vote when the questions change, and fills the form in again", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/${issue}`);
  await card(signedIn).getByTestId("poll-menu").click();
  await signedIn.getByRole("menuitem", { name: "Edit" }).click();
  const editor = signedIn.getByTestId("poll-editor");
  await editor.getByTestId("poll-editor-question-1-option-2-label").fill("Local disks");
  await signedIn.getByTestId("poll-editor-save").click();
  await expect(editor.getByTestId("poll-editor-revokes")).toContainText("revokes the 2 votes");
  await signedIn.getByTestId("poll-editor-save").click();
  await expect(toasts(signedIn)).toContainText("Poll saved");

  await expect(card(signedIn).getByTestId("poll-revoked")).toBeVisible();
  await expect(
    question(signedIn, "q1").getByRole("radio", { name: "S3-compatible" }),
  ).toBeChecked();
  await expect(
    question(signedIn, "q2").getByRole("checkbox", { name: "Max file size" }),
  ).toBeChecked();
  await expect(card(signedIn).getByTestId("poll-note")).toHaveValue("We run S3 already.");
  // Revoked is not voted: the results hide again.
  await expect(card(signedIn).getByTestId("poll-results-hidden")).toBeVisible();
  await card(signedIn).getByTestId("poll-submit").click();
  await expect(toasts(signedIn)).toContainText("Vote cast");
  await expect(card(signedIn).getByTestId("poll-revoked")).toHaveCount(0);
});

test("will not break a tie for the closer, records their decision, and reopens", async ({
  signedIn,
  browser,
  stack,
}) => {
  const bea = await asBea(browser, stack);
  await bea.goto(`${stack.appUrl}/issues/${issue}`);
  await expect(card(bea).getByTestId("poll-revoked")).toBeVisible();
  await question(bea, "q1").getByRole("radio", { name: "Local disks" }).click();
  await card(bea).getByTestId("poll-submit").click();
  await expect(toasts(bea)).toContainText("Vote cast");
  await bea.context().close();

  await signedIn.goto(`${stack.appUrl}/issues/${issue}`);
  await expect(card(signedIn).getByTestId("poll-tied-q1")).toBeVisible();
  await card(signedIn).getByTestId("poll-menu").click();
  await signedIn.getByRole("menuitem", { name: "Close the poll" }).click();
  const dialog = signedIn.getByTestId("poll-close-dialog");
  await expect(dialog.getByTestId("poll-decide-q1")).toContainText("Tied: decide it");
  await expect(signedIn.getByTestId("poll-close-confirm")).toBeDisabled();
  await dialog.getByTestId("poll-decide-q1").getByRole("radio", { name: "Local disks" }).click();
  await dialog.getByTestId("poll-close-note").fill("Disks, for now.");
  await signedIn.getByTestId("poll-close-confirm").click();
  await expect(toasts(signedIn)).toContainText("Poll closed");

  await expect(card(signedIn).getByTestId("poll-status")).toHaveText("Closed");
  await expect(card(signedIn).getByTestId("poll-decided-q1")).toContainText("Local disks");
  await expect(card(signedIn).getByTestId("poll-decided-q2")).toContainText("Max file size");
  await expect(card(signedIn).getByTestId("poll-decision")).toContainText("Disks, for now.");
  await expect(card(signedIn).getByTestId("poll-decision")).toContainText(
    /Closed by A Person, .+\. Decided:/,
  );
  await expect(card(signedIn).getByTestId("poll-ballot")).toHaveCount(0);
  await expect(card(signedIn).getByTestId("poll-results")).toBeVisible();

  await card(signedIn).getByTestId("poll-menu").click();
  await signedIn.getByRole("menuitem", { name: "Reopen" }).click();
  await expect(toasts(signedIn)).toContainText("Poll reopened");
  await expect(card(signedIn).getByTestId("poll-status")).toHaveText("Open");
  await expect(card(signedIn).getByTestId("poll-decision")).toHaveCount(0);
});

test("is found by the listing's filter, and marked on the issue's row", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues?poll=open`);
  const row = signedIn.getByTestId(`issue-row-${issue}`);
  await expect(row).toBeVisible();
  await expect(signedIn.getByTestId("issue-polls").first()).toContainText("Open poll");
  await signedIn.goto(`${stack.appUrl}/issues?poll=closed`);
  await expect(signedIn.getByTestId(`issue-row-${issue}`)).toHaveCount(0);
});

test("leaves the rest of the inbox standing when the API cannot answer for polls", async ({
  signedIn,
  stack,
}) => {
  // As a client built with this layer sees an API without the plugin: the
  // polls question refused, and every other one answered.
  const refuse = only("InboxSource", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: refusal("issues", 'Unknown argument "pollAwaiting"', {
        code: "GRAPHQL_VALIDATION_FAILED",
      }),
    }),
  );
  await signedIn.route(stack.apiUrl, refuse);
  await signedIn.goto(`${stack.appUrl}/inbox`);
  const assigned = signedIn.getByTestId("inbox-row-aaaa0001");
  await expect(assigned).toBeVisible();
  await expect(assigned.getByTestId("inbox-reason-assigned")).toBeVisible();
  await expect(signedIn.getByTestId("inbox-view-polls-count")).toHaveText("0");
  await signedIn.unroute(stack.apiUrl, refuse);
});
