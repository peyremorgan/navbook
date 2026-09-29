/**
 * Runs in the browser: on a pull request's page and its listing, and the
 * runner that records them.
 *
 * In order, because they share the served pull request: its tested state is
 * read first, as the fixture left it, and only then is a run recorded on it.
 */

import { expect, signIn, test, toasts } from "../../web/test-e2e/helpers/fixtures.ts";

test("marks a tested pull request on the listing, and filters by it", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs`);
  await expect(signedIn.getByTestId("pr-tested-passed")).toBeVisible();
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/prs?tested=passed`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
  await signedIn.goto(`${stack.appUrl}/prs?tested=failed`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toHaveCount(0);
});

test("shows a pull request's runs, and refuses to record one on a branch not served", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  const panel = signedIn.getByTestId("test-runs-panel");
  await expect(panel.getByTestId("test-run-row-dddd0001")).toContainText("Passed");
  await expect(panel.getByTestId("test-runs-tested")).toHaveText("Passed");

  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002`);
  const elsewhere = signedIn.getByTestId("test-runs-panel");
  await expect(elsewhere.getByTestId("test-runs-tested")).toHaveText("Not tested");
  await expect(elsewhere.getByTestId("record-test-run")).toBeDisabled();
});

test("records a run on a pull request, step by step, and finishes it", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await signedIn.getByTestId("record-test-run").click();
  await signedIn.getByTestId("test-run-start-plan").click();
  await signedIn.getByRole("option", { name: "Sign in on a slow connection" }).click();
  await signedIn.getByTestId("test-run-start-environment").fill("Firefox, throttled");
  await signedIn.getByTestId("test-run-start-submit").click();
  await expect(signedIn).toHaveURL(/\/tests\/runs\/[a-z0-9]{8}$/);
  await expect(toasts(signedIn)).toContainText("Run started");
  await expect(signedIn.getByTestId("test-run-outcome")).toHaveText("In progress");
  await expect(signedIn.getByTestId("test-run-pr")).toContainText("#bbbb0001");

  await signedIn.getByTestId("runner-step-1-passed").click();
  await signedIn.getByTestId("runner-step-2-failed").click();
  await signedIn
    .getByTestId("runner-step-2-actual")
    .fill("A spinner for a minute, then a blank page.");
  await signedIn.getByTestId("runner-save").click();
  await expect(toasts(signedIn)).toContainText("Progress saved");
  await expect(signedIn.getByTestId("test-run-outcome")).toHaveText("Failed");
  await expect(signedIn.getByTestId("runner-save")).toBeDisabled();

  // Step 3 left: finishing asks first.
  await signedIn.getByTestId("runner-finish").click();
  await expect(signedIn.getByTestId("runner-finish-warning")).toContainText(
    "1 step is not recorded",
  );
  await signedIn.getByTestId("runner-finish-confirm").click();
  await expect(toasts(signedIn)).toContainText("Run finished");
  await expect(signedIn.getByTestId("test-run-finished")).not.toContainText("not yet");
  await expect(signedIn.getByTestId("runner-save")).toHaveCount(0);
  await expect(signedIn.getByTestId("runner-step-2")).toContainText(
    "A spinner for a minute, then a blank page.",
  );

  // And the pull request says so.
  await signedIn.getByTestId("test-run-pr").click();
  await expect(signedIn.getByTestId("test-runs-tested")).toHaveText("Failed");
});

test("keeps a runner's answers across a reload, until they are saved", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/tests/runs/dddd0002`);
  await expect(signedIn.getByTestId("runner-step-1-state")).toHaveText("Passed");
  await signedIn.getByTestId("runner-step-2-blocked").click();
  await signedIn.getByTestId("runner-step-2-actual").fill("The staging server is down.");

  signedIn.once("dialog", (dialog) => void dialog.accept());
  await signedIn.reload();
  await expect(signedIn.getByTestId("runner-step-2-state")).toHaveText("Blocked");
  await expect(signedIn.getByTestId("runner-step-2-actual")).toHaveValue(
    "The staging server is down.",
  );
  await expect(signedIn.getByTestId("runner-save")).toBeEnabled();

  await signedIn.getByTestId("runner-save").click();
  await expect(toasts(signedIn)).toContainText("Progress saved");
  await expect(signedIn.getByTestId("test-run-outcome")).toHaveText("Blocked");
  await signedIn.reload();
  await expect(signedIn.getByTestId("runner-save")).toBeDisabled();
});

test("attaches a screenshot to a step, and shows it", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/tests/runs/dddd0002`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await signedIn
    .getByTestId("runner-step-2-attach")
    .setInputFiles({ name: "down page.png", mimeType: "image/png", buffer: png });
  await expect(toasts(signedIn)).toContainText("Attached");
  const attachments = signedIn.getByTestId("test-run-attachments");
  await expect(attachments.getByTestId("test-attachment-image-down-page.png")).toBeVisible();
  await expect(signedIn.getByTestId("runner-step-2-actual")).toHaveValue(/down-page\.png/);
});

// Last: it finishes the fixture's open run.
test("says why a save was refused, when the run was finished in another tab", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/tests/runs/dddd0002`);
  await expect(signedIn.getByTestId("runner-save")).toBeVisible();

  const other = await signedIn.context().newPage();
  await signIn(other, stack);
  await other.goto(`${stack.appUrl}/tests/runs/dddd0002`);
  await other.getByTestId("runner-finish").click();
  await other.getByTestId("runner-finish-confirm").click();
  await expect(toasts(other)).toContainText("Run finished");
  await other.close();

  await signedIn.getByTestId("runner-step-3-passed").click();
  await signedIn.getByTestId("runner-save").click();
  await expect(signedIn.getByTestId("runner-refused")).toContainText(
    "test run dddd0002 is finished; nothing more can be recorded",
  );
  await expect(signedIn.getByTestId("runner-unserved")).toHaveCount(0);
});
