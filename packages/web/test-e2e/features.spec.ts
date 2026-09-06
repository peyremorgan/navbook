/**
 * Features in the browser: the listing, the page, and the document editor.
 *
 * Two things here can only be proved end to end. The timeline mixes three
 * lists the server hands back separately, and the commit in it comes from git
 * rather than from the tree — so a stack with a real repository behind it is
 * the only place it can appear at all. And the stale-save refusal needs two
 * saves racing over one file, which is a server decision the client only shows.
 */

import { chooseOrCreate, expect, signIn, test } from "./helpers/fixtures.ts";

test("lists the features the repository holds", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/features`);
  await expect(signedIn.getByTestId("feature-row-authentication")).toBeVisible();
  await expect(signedIn.getByTestId("feature-row-billing")).toBeVisible();

  const authentication = signedIn.getByTestId("feature-row-authentication");
  await expect(authentication).toContainText("Authentication");
  await expect(authentication).toContainText("2 documents");
  // A feature with nothing written down is still a feature.
  await expect(signedIn.getByTestId("feature-row-billing")).toContainText("0 documents");
});

test("shows a feature's documents, its work and its history", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/features/authentication`);

  await expect(signedIn.getByTestId("feature-title")).toContainText("Authentication");
  await expect(signedIn.getByTestId("spec-row-login-flow.md")).toBeVisible();
  await expect(signedIn.getByTestId("spec-row-session-policy.md")).toBeVisible();

  // The issues that name it, and not the ones that do not.
  const timeline = signedIn.getByTestId("timeline");
  await expect(timeline.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(timeline.getByTestId("issue-row-cafe0005")).toBeVisible();
  await expect(timeline.getByTestId("issue-row-aaaa0006")).toHaveCount(0);

  // And the commit that only ever touched code, found through its trailer.
  await expect(timeline.getByText("fix: raise the sign-in deadline")).toBeVisible();

  // The path on disk, because the files are the product.
  await expect(signedIn.getByText(".navbook/specs/authentication")).toBeVisible();
});

test("reaches a feature from an issue, and back again", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("issue-feature-authentication").first().click();
  await expect(signedIn).toHaveURL(/\/features\/authentication$/);

  await signedIn.goto(`${stack.appUrl}/issues/aaaa0001`);
  await signedIn.getByTestId("chip-features-authentication").click();
  await expect(signedIn).toHaveURL(/\/features\/authentication$/);

  // And the feature sends you back to the issues that name it.
  await signedIn.getByTestId("filter-issues").click();
  await expect(signedIn).toHaveURL(/\/issues\?feature=authentication$/);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
});

test("creates a feature and lands on its page", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/features`);
  await signedIn.getByTestId("new-feature").click();
  await signedIn.getByTestId("new-feature-title").fill("Search and indexing");
  await signedIn.getByTestId("new-feature-summary").fill("Finding things.");
  await signedIn.getByTestId("new-feature-submit").click();

  await expect(signedIn).toHaveURL(/\/features\/search-and-indexing$/);
  await expect(signedIn.getByTestId("feature-title")).toContainText("Search and indexing");
  await expect(signedIn.getByText("Nothing written down yet.")).toBeVisible();
});

test("adds a document, then edits it with a preview", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/features/billing`);
  await signedIn.getByTestId("add-spec").click();
  await signedIn.getByTestId("new-spec-title").fill("Invoice numbering");
  await signedIn.getByTestId("new-spec-body").fill("## Requirements\n\nNumbers SHALL be gapless.");
  await signedIn.getByTestId("new-spec-submit").click();

  await expect(signedIn).toHaveURL(/\/features\/billing\/invoice-numbering\.md$/);
  await expect(signedIn.getByTestId("spec-title")).toContainText("Invoice numbering");
  await expect(signedIn.getByText("Numbers SHALL be gapless.")).toBeVisible();

  await signedIn.getByTestId("edit-spec").click();
  await signedIn
    .getByTestId("input-spec-body")
    .fill("## Requirements\n\nNumbers SHALL be **gapless**.");

  // The preview renders the draft, not what is saved.
  await signedIn.getByTestId("spec-tab-preview").click();
  await expect(signedIn.getByTestId("spec-preview").locator("strong")).toHaveText("gapless");
  await signedIn.getByTestId("spec-tab-write").click();
  await expect(signedIn.getByTestId("input-spec-body")).toBeVisible();

  await signedIn.getByTestId("save-spec").click();
  await expect(signedIn.getByTestId("edit-spec")).toBeVisible();
  await expect(signedIn.locator("strong", { hasText: "gapless" })).toBeVisible();
});

test("refuses a save made against a version somebody has replaced", async ({
  signedIn,
  stack,
  context,
}) => {
  const path = `${stack.appUrl}/features/authentication/session-policy.md`;
  await signedIn.goto(path);
  await signedIn.getByTestId("edit-spec").click();
  await signedIn.getByTestId("input-spec-body").fill("Mine.");

  // Somebody else, in another tab, saves the same file first — while this
  // editor is still open on the version it started from.
  const other = await context.newPage();
  await signIn(other, stack, { name: "Someone Else", email: "someone@example.invalid" });
  await other.goto(path);
  await other.getByTestId("edit-spec").click();
  await other.getByTestId("input-spec-body").fill("Theirs.");
  await other.getByTestId("save-spec").click();
  await expect(other.getByTestId("edit-spec")).toBeVisible();
  await other.close();

  await signedIn.getByTestId("save-spec").click();
  await expect(signedIn.getByTestId("spec-stale")).toBeVisible();
  // The draft is still there: what was typed is the only copy of itself.
  await expect(signedIn.getByTestId("input-spec-body")).toHaveValue("Mine.");

  await signedIn.getByTestId("spec-reload").click();
  await expect(signedIn.getByTestId("spec-stale")).toHaveCount(0);
});

test("sets a feature on an issue from its sidebar", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues/aaaa0006`);
  await expect(signedIn.getByTestId("sidebar-features")).toContainText("None");

  await signedIn.getByTestId("edit-features").click();
  await chooseOrCreate(signedIn, "input-features", "billing");
  await signedIn.getByTestId("save-features").click();

  await expect(signedIn.getByTestId("chip-features-billing")).toBeVisible();
  await signedIn.goto(`${stack.appUrl}/features/billing`);
  await expect(signedIn.getByTestId("timeline").getByTestId("issue-row-aaaa0006")).toBeVisible();
});
