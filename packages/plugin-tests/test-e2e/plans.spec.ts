/**
 * Test plans in the browser: the listing, a plan's page, and the editor.
 *
 * Every plan this spec changes is one it made: the seeded plan is what the
 * runs spec records against, and its three steps must stay three.
 */

import { expect, signIn, test, toasts } from "../../web/test-e2e/helpers/fixtures.ts";

test("lists the seeded plan, with its latest run's outcome, and names the pages", async ({
  signedIn,
}) => {
  await signedIn.getByTestId("nav-tests").click();
  await expect(signedIn).toHaveURL(/\/tests$/);
  await expect(signedIn).toHaveTitle("Tests · Navbook");
  const row = signedIn.getByTestId("test-plan-row-slow-sign-in");
  await expect(row).toContainText("Sign in on a slow connection");
  await expect(row).toContainText("3 steps");
  await expect(row).toContainText("2 runs");
  await row.click();
  await expect(signedIn).toHaveURL(/\/tests\/slow-sign-in$/);
  await expect(signedIn).toHaveTitle("Sign in on a slow connection — Tests · Navbook");
});

test("shows a plan's steps and its runs", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/tests/slow-sign-in`);
  await expect(signedIn.getByTestId("test-plan-title")).toHaveText("Sign in on a slow connection");
  await expect(
    signedIn.getByText("Throttle the browser to slow 3G before starting."),
  ).toBeVisible();
  await expect(signedIn.getByTestId("test-plan-step-2")).toContainText(
    "however long the connection takes",
  );
  await expect(signedIn.getByTestId("test-plan-step-3")).toContainText(
    "A setup step: nothing to check.",
  );
  const runs = signedIn.getByTestId("test-plan-runs");
  await expect(runs.getByTestId("test-run-row-dddd0001")).toContainText("Passed");
  await expect(runs.getByTestId("test-run-row-dddd0001")).toContainText("#bbbb0001");
  await expect(runs.getByTestId("test-run-row-dddd0002")).toContainText("In progress");
});

test("creates a plan from fields, steps in the order they were arranged", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/tests`);
  await signedIn.getByTestId("new-test-plan").click();
  await expect(signedIn).toHaveURL(/\/tests\/new$/);
  await signedIn.getByTestId("plan-title").fill("Password reset");
  await signedIn.getByTestId("plan-description").fill("Needs a mailbox the tester can read.");
  await signedIn.getByTestId("plan-step-1-title").fill("Follow the link");
  await signedIn.getByTestId("plan-step-1-actions").fill("Open the link in the email.");
  await signedIn.getByTestId("plan-add-step").click();
  await signedIn.getByTestId("plan-step-2-title").fill("Ask for the email");
  await signedIn.getByTestId("plan-step-2-actions").fill("Press **Forgot password**.");
  await signedIn.getByTestId("plan-step-2-expected").fill("An email arrives.");
  // Written second, meant first.
  await signedIn.getByTestId("plan-step-2-up").click();

  // A step with no actions is caught before anything is sent.
  await signedIn.getByTestId("plan-add-step").click();
  await signedIn.getByTestId("plan-save").click();
  await expect(signedIn.getByTestId("plan-problem")).toHaveText(
    "Step 3 needs a title and its actions.",
  );
  await signedIn.getByTestId("plan-step-3-remove").click();

  await signedIn.getByTestId("plan-save").click();
  await expect(signedIn).toHaveURL(/\/tests\/password-reset$/);
  await expect(toasts(signedIn)).toContainText("Created");
  await expect(signedIn.getByTestId("test-plan-step-1")).toContainText("Ask for the email");
  await expect(signedIn.getByTestId("test-plan-step-2")).toContainText("Follow the link");
  await expect(signedIn.getByTestId("test-plan-step-2")).toContainText(
    "A setup step: nothing to check.",
  );
});

test("edits a plan, and keeps the draft when somebody else saved first", async ({
  signedIn,
  stack,
  browser,
}) => {
  await signedIn.goto(`${stack.appUrl}/tests/new`);
  await signedIn.getByTestId("plan-title").fill("Two editors");
  await signedIn.getByTestId("plan-step-1-title").fill("Only step");
  await signedIn.getByTestId("plan-step-1-actions").fill("Do it.");
  await signedIn.getByTestId("plan-save").click();
  await expect(signedIn).toHaveURL(/\/tests\/two-editors$/);

  await signedIn.getByTestId("edit-test-plan").click();
  await signedIn.getByTestId("plan-title").fill("Two editors, mine");

  // Somebody else saves a change in the meantime.
  const other = await browser.newPage();
  await signIn(other, stack, { name: "Other Editor", email: "other-editor@example.invalid" });
  await other.goto(`${stack.appUrl}/tests/two-editors`);
  await other.getByTestId("edit-test-plan").click();
  await other.getByTestId("plan-step-1-expected").fill("It is done.");
  await other.getByTestId("plan-save").click();
  await expect(other.getByTestId("test-plan-editor")).toHaveCount(0);
  await other.close();

  await signedIn.getByTestId("plan-save").click();
  await expect(signedIn.getByTestId("test-plan-stale")).toBeVisible();
  // The draft is still there, and the plan as it is now is shown beneath.
  await expect(signedIn.getByTestId("plan-title")).toHaveValue("Two editors, mine");
  await expect(signedIn.getByTestId("test-plan-step-1")).toContainText("It is done.");
  // Saving again, having seen it, writes over it.
  await signedIn.getByTestId("plan-save").click();
  await expect(signedIn.getByTestId("test-plan-editor")).toHaveCount(0);
  await expect(signedIn.getByTestId("test-plan-title")).toHaveText("Two editors, mine");
});
