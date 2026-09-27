/**
 * Leaving a specification document, or a new one, unsaved.
 *
 * The guard itself is the host's (`packages/web/test-e2e/unsaved-work.spec.ts`
 * proves it on the host's own editors); what is proved here is that this
 * layer's drafts are held by it. A document is the longest thing anybody
 * types in Navbook, which is why the issue that asked for the guard led with
 * it.
 */

import type { Dialog, Page } from "@playwright/test";
import { expect, test } from "../../web/test-e2e/helpers/fixtures.ts";

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
  await expect(signedIn).toHaveURL(/\/features\/authentication\/session-policy\.md$/);

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

test("does not ask when a document is open with nothing changed", async ({ signedIn, stack }) => {
  const seen = dialogs(signedIn, "dismiss");
  await signedIn.goto(`${stack.appUrl}${SPEC}`);
  await signedIn.getByTestId("edit-spec").click();

  await signedIn.getByTestId("nav-issues").click();
  await expect(signedIn).toHaveURL(/\/issues$/);
  await expect(signedIn.getByTestId("leave-dialog")).toHaveCount(0);
  expect(seen).toHaveLength(0);
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
    // A dismissed beforeunload cancels the reload, which Playwright can only
    // report as a navigation that never finished.
  });
  expect(seen.map((dialog) => dialog.type())).toEqual(["beforeunload"]);
  await expect(signedIn.getByTestId("new-spec-body")).toHaveValue("A document nobody has saved.");
});
