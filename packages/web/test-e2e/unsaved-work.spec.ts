/**
 * Leaving a page that holds something typed and not yet saved.
 *
 * Every way out is covered by one of two guards, and these prove both from
 * the outside: a navigation inside the app — a sidebar link, a reference in a
 * preview, Back — asks in the app's own dialog, and so do the app's own ways
 * out of the document (signing out, and the redirect to the identity provider
 * when the API refuses the token). One the browser starts — a reload, a
 * closed tab — gets the browser's `beforeunload` prompt. What is never
 * asked about is a page with nothing unsaved on it, and the app's own
 * navigation once a save has landed. A refusal asks once, and not again
 * until the person has moved.
 *
 * Nothing here saves an edit to the shared fixtures except the one filed
 * issue, which is new and named so that no other spec reads it.
 */

import type { Dialog, Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures.ts";

const SPEC = "/features/authentication/session-policy.md";

/** Collect every browser dialog, answering each one as told. */
function dialogs(page: Page, answer: "accept" | "dismiss"): Dialog[] {
  const seen: Dialog[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog);
    void (answer === "accept" ? dialog.accept() : dialog.dismiss());
  });
  return seen;
}

test("asks before a sidebar link throws away a document being written", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}${SPEC}`);
  await signedIn.getByTestId("edit-spec").click();
  await signedIn.getByTestId("input-spec-body").fill("Three paragraphs nobody has saved.");

  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await expect(signedIn).toHaveURL(new RegExp(`${SPEC.replaceAll(".", "\\.")}$`));

  // Staying keeps the editor and every word in it.
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  await expect(signedIn.getByTestId("input-spec-body")).toHaveValue(
    "Three paragraphs nobody has saved.",
  );

  // Asking again and choosing to go does go.
  await signedIn.getByTestId("nav-issues").click();
  await signedIn.getByTestId("leave-discard").click();
  await expect(signedIn).toHaveURL(/\/issues$/);
});

test("asks before a reference in the preview leaves the draft", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}${SPEC}`);
  await signedIn.getByTestId("edit-spec").click();
  await signedIn.getByTestId("input-spec-body").fill("See #aaaa0001 for the details.");
  await signedIn.getByTestId("spec-tab-preview").click();

  await signedIn.getByTestId("spec-preview").locator("a.nav-reference").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await signedIn.getByTestId("spec-tab-write").click();
  await expect(signedIn.getByTestId("input-spec-body")).toHaveValue(
    "See #aaaa0001 for the details.",
  );
});

test("does not ask when an editor is open with nothing changed", async ({ signedIn, stack }) => {
  const seen = dialogs(signedIn, "dismiss");
  await signedIn.goto(`${stack.appUrl}${SPEC}`);
  await signedIn.getByTestId("edit-spec").click();

  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(/\/issues$/);
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  expect(seen).toHaveLength(0);
});

test("asks before leaving a comment half written", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("comment-body").fill("I was about to say something useful.");

  await signedIn.getByTestId("nav-prs").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn.getByTestId("comment-body")).toHaveValue(
    "I was about to say something useful.",
  );
});

test("asks when Back would move to another issue on the same page", async ({ signedIn, stack }) => {
  // Two issues, one page component: moving between them is a route update,
  // not a leave, and the draft goes with the old instance all the same. The
  // subtask link makes the move inside the app, so Back is the router's.
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#aaaa0001");
  await signedIn
    .locator("li", { has: signedIn.getByText("#aaaa0002", { exact: true }) })
    .getByRole("link")
    .first()
    .click();
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#aaaa0002");

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("input-title").fill("A better title, not yet saved");

  await signedIn.goBack();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0002$/);
  await expect(signedIn.getByTestId("input-title")).toHaveValue("A better title, not yet saved");
});

test("switches a pull request's tabs freely, and asks only on leaving it", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await signedIn.getByTestId("review-body").fill("Half a review.");

  // The tabs stay mounted, so the review survives them and nothing is asked.
  await signedIn.getByTestId("pr-tab-commits").click();
  await expect(signedIn).toHaveURL(/tab=commits/);
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  await signedIn.getByTestId("pr-tab-conversation").click();
  await expect(signedIn.getByTestId("review-body")).toHaveValue("Half a review.");

  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn.getByTestId("review-body")).toHaveValue("Half a review.");
});

test("asks before signing out, and staying keeps the session", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("comment-body").fill("Not sent before signing out.");

  await signedIn.getByRole("banner").getByRole("button").last().click();
  await signedIn.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();

  // Still signed in: the question came before the token was dropped.
  await expect(signedIn.getByTestId("comment-body")).toHaveValue("Not sent before signing out.");
  await signedIn.getByTestId("nav-prs").click();
  await signedIn.getByTestId("leave-discard").click();
  await expect(signedIn).toHaveURL(/\/prs$/);
  await expect(signedIn.getByTestId("signed-out")).toHaveCount(0);

  // Agreeing to leave signs out, and is asked once rather than twice.
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("comment-body").fill("Discarded on the way out.");
  await signedIn.getByRole("banner").getByRole("button").last().click();
  await signedIn.getByRole("menuitem", { name: "Sign out" }).click();
  await signedIn.getByTestId("leave-discard").click();
  await expect(signedIn.getByTestId("signed-out")).toBeVisible();
});

test("has the browser ask before a reload loses a new issue", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/new`);
  await signedIn.getByTestId("new-title").fill("Something worth filing");

  const seen = dialogs(signedIn, "dismiss");
  await signedIn.reload({ timeout: 3_000 }).catch(() => {
    // A dismissed beforeunload cancels the reload, which Playwright can only
    // report as a navigation that never finished.
  });
  expect(seen.map((dialog) => dialog.type())).toEqual(["beforeunload"]);
  await expect(signedIn.getByTestId("new-title")).toHaveValue("Something worth filing");
});

/** Answer one named operation with a GraphQL error, and let every other one through. */
async function refuse(page: Page, apiUrl: string, operation: string, code: string): Promise<void> {
  await page.route(apiUrl, async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes(`${operation}(`)) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: null,
        errors: [{ message: "refused by the test", path: [operation], extensions: { code } }],
      }),
    });
  });
}

test("asks before a refused session sends a draft to the provider, and only once", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("comment-body").fill("Written while the session died.");
  await refuse(signedIn, stack.apiUrl, "addComment", "UNAUTHENTICATED");
  const seen = dialogs(signedIn, "dismiss");

  // Asked in the app, before the token is dropped or the page left.
  await signedIn.getByTestId("comment-submit").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(
    signedIn.locator("[data-slot=description]", {
      hasText: "copy what you wrote, then sign in again",
    }),
  ).toBeVisible();
  await expect(signedIn.getByTestId("comment-body")).toHaveValue("Written while the session died.");

  // Declined once, not asked again on the next refusal: said, and kept.
  await signedIn.getByTestId("comment-submit").click();
  await signedIn.waitForTimeout(500);
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001$/);
  expect(seen).toHaveLength(0);
});

test("asks before a refused account leaves a draft, and only once", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("comment-body").fill("Written by somebody just refused.");
  await refuse(signedIn, stack.apiUrl, "addComment", "FORBIDDEN");

  await signedIn.getByTestId("comment-submit").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001$/);

  await signedIn.getByTestId("comment-submit").click();
  await signedIn.waitForTimeout(500);
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  await expect(signedIn.getByTestId("comment-body")).toHaveValue(
    "Written by somebody just refused.",
  );
});

test("asks before leaving a refused edit that is kept on the page", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await refuse(signedIn, stack.apiUrl, "updateIssue", "SYNC_PUSH_REJECTED");

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("input-title").fill("A title the remote refused");
  await signedIn.getByTestId("save-title").click();
  await expect(signedIn.getByTestId("save-failed-title")).toBeVisible();

  // The editor has closed; the refused edit is still the only copy.
  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn.getByTestId("leave-dialog")).toBeVisible();
  await signedIn.getByTestId("leave-stay").click();
  await expect(signedIn.getByTestId("save-failed-title")).toBeVisible();
});

test("has the browser ask before a reload loses a document being added", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/features/billing`);
  await signedIn.getByTestId("add-spec").click();
  await signedIn.getByTestId("new-spec-body").fill("A document nobody has saved.");

  const seen = dialogs(signedIn, "dismiss");
  await signedIn.reload({ timeout: 3_000 }).catch(() => {
    // Cancelled by the dismissed prompt, as above.
  });
  expect(seen.map((dialog) => dialog.type())).toEqual(["beforeunload"]);
  await expect(signedIn.getByTestId("new-spec-body")).toHaveValue("A document nobody has saved.");
});

test("files an issue and lands on it without being asked", async ({ signedIn, stack }) => {
  const seen = dialogs(signedIn, "dismiss");
  await signedIn.goto(`${stack.appUrl}/issues/new`);
  await signedIn.getByTestId("new-title").fill("Filed by the unsaved-work spec");
  await signedIn.getByTestId("new-body").fill("It exists so that leaving after a save is shown.");
  await signedIn.getByTestId("submit-issue").click();

  await expect(signedIn).toHaveURL(/\/issues\/[a-z0-9]{8}$/);
  await expect(signedIn.getByTestId("issue-title")).toHaveText("Filed by the unsaved-work spec");
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  expect(seen).toHaveLength(0);
});
