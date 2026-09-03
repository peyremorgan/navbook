/**
 * The listing and its filter, which is the URL.
 *
 * What is asserted is that the query string and what the server returns agree —
 * including the asymmetry that catches everybody: a filter naming no status
 * means open, not any.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("lists the open issues, newest first", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  const rows = signedIn.locator("[data-testid^=issue-row-]");
  await expect(rows.first()).toBeVisible();

  // The fixture's closed issue must not be here: no status named means open.
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
});

test("shows closed issues only when the URL asks for them", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open&status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toHaveCount(0);
});

test("filters by label, from the URL and from the chips", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?label=bug`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-cafe0005")).toHaveCount(0);

  // Two labels AND together, as they do on the server.
  await signedIn.goto(`${stack.appUrl}/issues?label=bug&label=auth`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0002")).toHaveCount(0);
});

test("searches title, body and comments", async ({ signedIn, stack }) => {
  // "throttled" appears in one issue's body and in another's comment.
  await signedIn.goto(`${stack.appUrl}/issues?q=throttled`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/issues?q=nothingmatchesthis`);
  await expect(signedIn.getByText("No issues match this filter")).toBeVisible();
});

test("puts what is typed into the search box into the address bar", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("filter-text").fill("deadline");
  await signedIn.getByTestId("filter-text").press("Enter");

  await expect(signedIn).toHaveURL(/[?&]q=deadline/);
  await expect(signedIn.getByTestId("issue-row-aaaa0002")).toBeVisible();
});

test("narrows on every word, as the server does", async ({ signedIn, stack }) => {
  // Terms AND together. "deadline" alone matches two issues; with "thirty"
  // only the one whose title carries both.
  await signedIn.goto(`${stack.appUrl}/issues?q=deadline`);
  await expect(signedIn.getByTestId("issue-row-aaaa0002")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0003")).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/issues?q=deadline+thirty`);
  await expect(signedIn.getByTestId("issue-row-aaaa0002")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0003")).toHaveCount(0);
});

test("keeps a quoted phrase whole", async ({ signedIn, stack }) => {
  // A term may contain spaces, and quoting is the only way to ask for one.
  await signedIn.goto(`${stack.appUrl}/issues?q=%22slow+connections%22`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();

  // The same words, not adjacent, match nothing as a phrase.
  await signedIn.goto(`${stack.appUrl}/issues?q=%22connections+slow%22`);
  await expect(signedIn.getByText("No issues match this filter")).toBeVisible();

  // And the box shows it back with its quotes, so the filter survives a
  // round trip through the address bar unchanged.
  await signedIn.goto(`${stack.appUrl}/issues?q=%22slow+connections%22`);
  await expect(signedIn.getByTestId("filter-text")).toHaveValue('"slow connections"');
});

test("toggles a status chip into and out of the URL", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).toHaveURL(/status=closed/);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();

  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).not.toHaveURL(/status=/);
});

test("clears every filter at once", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?label=bug&q=deadline&status=open`);
  await signedIn.getByTestId("filter-clear").click();
  await expect(signedIn).not.toHaveURL(/[?&](label|q|status)=/);
});

test("ignores a status the issue list cannot show, rather than breaking", async ({
  signedIn,
  stack,
}) => {
  // A URL shared from the pull request list, or typed by hand.
  await signedIn.goto(`${stack.appUrl}/issues?status=merged`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
});

test("opens an issue from the list", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("issue-row-aaaa0001").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001/);
  await expect(signedIn.getByTestId("issue-title")).toContainText("Sign-in is unreliable");
});
