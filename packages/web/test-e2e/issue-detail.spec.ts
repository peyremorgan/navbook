/**
 * Reading an issue, including the parts of a subtask tree that are not issues.
 *
 * Four of the five link states cannot be produced by clicking — they need a
 * file somebody wrote by hand, which is what the fixture's edge-case issue is.
 * They are the reason `LinkNode` exists, so they are the thing to check.
 */

import { expect, test } from "./helpers/fixtures.ts";

test("renders the body as Markdown", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();

  // Written as a fenced span and a list in the fixture.
  await expect(signedIn.locator(".nav-markdown code").first()).toContainText("app/auth/session.ts");
  await expect(signedIn.locator(".nav-markdown li").first()).toBeVisible();
});

test("shows the metadata the frontmatter carries", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#aaaa0001");
  await expect(signedIn.getByTestId("sidebar-labels")).toContainText("bug");
  await expect(signedIn.getByTestId("sidebar-labels")).toContainText("auth");
  await expect(signedIn.getByTestId("sidebar-assignees")).toContainText("A Person");
  await expect(signedIn.getByTestId("sidebar-milestone")).toContainText("1.0");
  // The path is worth showing: the files are the product.
  await expect(signedIn.getByTestId("issue-detail")).toContainText(
    ".navbook/issues/open/aaaa0001-",
  );
});

test("resolves an unambiguous prefix, as every reference does", async ({ signedIn, stack }) => {
  // Four characters is the minimum the format allows, and people speak in
  // prefixes because ids are random rather than sequential.
  await signedIn.goto(`${stack.appUrl}/issues/cafe`);
  await expect(signedIn.getByTestId("issue-title")).toContainText("Document the query syntax");
  await expect(signedIn.getByTestId("issue-id")).toHaveText("#cafe0005");
});

test("refuses an ambiguous prefix rather than picking one", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa000`);
  await expect(signedIn.getByText("That prefix matches more than one")).toBeVisible();
});

test("refuses a prefix too short to be meant", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aa`);
  await expect(signedIn.getByText("That prefix is too short")).toBeVisible();
});

test("threads a reply under what it answers", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  const thread = signedIn
    .getByTestId("pr-comment-thread")
    .or(signedIn.getByTestId("comment-thread"));
  await expect(thread).toBeVisible();

  // cccc0002 replies to cccc0001, so it is nested inside it rather than beside.
  await expect(
    signedIn.getByTestId("comment-cccc0001").getByTestId("comment-cccc0002"),
  ).toBeVisible();
});

test("draws every state a subtask link can be in", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0007`);
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();

  // An ordinary subtask: a link, and no explanation needed.
  await expect(
    signedIn.getByRole("link", { name: "Make the deadline configurable" }),
  ).toBeVisible();

  // The four that need one. Each says something different, because each *is*
  // something different — collapsing them into "missing" would be a lie.
  await expect(signedIn.getByTestId("link-repeated")).toContainText("shown above");
  await expect(signedIn.getByTestId("link-notAnIssue")).toContainText("pull request");
  await expect(signedIn.getByTestId("link-unknown")).toContainText("no issue with this id");
  await expect(signedIn.getByTestId("link-cycle")).toContainText("loops");
});

test("shows the parent an issue is filed under", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0002`);
  await expect(signedIn.getByTestId("issue-detail")).toContainText("under");
  await expect(
    signedIn.getByRole("link", { name: "Sign-in is unreliable on slow connections" }),
  ).toBeVisible();
});

test("says why a closed issue is closed", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0006`);
  await expect(signedIn.getByTestId("closed-banner")).toContainText("Resolution: fixed");
  await expect(signedIn.getByTestId("reopen-issue")).toBeVisible();
});

test("says so when there is no such issue, once", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/zzzz9999`);
  // Where the issue would have been, and nowhere else: a read that fails has a
  // natural place to say so, and a toast saying it again reads as a second
  // fault rather than the same one.
  await expect(signedIn.getByText("Not found")).toBeVisible();
  await expect(signedIn.getByText("Not found")).toHaveCount(1);
});
