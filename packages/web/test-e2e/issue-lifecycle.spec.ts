/**
 * Writing: filing, editing, closing, reopening, commenting, linking.
 *
 * Every one of these commits to a real repository and pushes to a real origin,
 * so what is being proved is not that a form submits — it is that the round
 * trip through git works and that the page then shows what the tree says.
 *
 * The specs file what they need rather than relying on the fixture's issues,
 * because they share one repository and one server: a test that mutated a
 * seeded issue would change what the read-only specs see.
 */

import { expect, type Page } from "@playwright/test";
import { chooseOrCreate, test, toasts } from "./helpers/fixtures.ts";

/** File an issue through the form, and return the id the server minted. */
async function fileIssue(page: Page, appUrl: string, title: string, body: string): Promise<string> {
  await page.goto(`${appUrl}/issues/new`);
  await page.getByTestId("new-title").fill(title);
  await page.getByTestId("new-body").fill(body);
  await page.getByTestId("submit-issue").click();
  await expect(page.getByTestId("issue-detail")).toBeVisible();
  const id = (await page.getByTestId("issue-id").innerText()).replace("#", "");
  expect(id).toMatch(/^[a-z][a-z0-9]{7}$/);
  return id;
}

test("files an issue and lands on it", async ({ signedIn, stack }) => {
  const id = await fileIssue(
    signedIn,
    stack.appUrl,
    "The list does not refresh",
    "It keeps showing what it showed before.",
  );

  await expect(signedIn).toHaveURL(new RegExp(`/issues/${id}$`));
  await expect(signedIn.getByTestId("issue-title")).toHaveText("The list does not refresh");
  // Authored by the person signed in, which is the whole point of the gateway.
  await expect(signedIn.getByTestId("issue-detail")).toContainText("A Person");

  // And it is in the listing, which means the cached one was let go of.
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId(`issue-row-${id}`)).toBeVisible();
});

test("says what it committed, and that it reached the remote", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "A pushed issue", "The fixture has an origin.");
  // `pushed` is not decoration: a change only in the server's clone is in
  // nobody's `git pull`, and the toast would have said "but not pushed"
  // instead. The fixture has an origin, so this one landed.
  await expect(toasts(signedIn)).toContainText("Filed");
  await expect(toasts(signedIn)).toContainText("docs(issue): open #");
  await expect(toasts(signedIn)).not.toContainText("not pushed");
});

test("edits a title in place, and sends only the title", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "Before", "A description that must survive.");

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("input-title").fill("After");
  await signedIn.getByTestId("save-title").click();

  await expect(signedIn.getByTestId("issue-title")).toHaveText("After");
  // The body was never in the patch, so it is exactly as it was.
  await signedIn.reload();
  await expect(signedIn.getByTestId("issue-detail")).toContainText(
    "A description that must survive.",
  );
  await expect(signedIn.getByTestId("issue-title")).toHaveText("After");
});

test("sends nothing at all when an edit changed nothing", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "Unchanged", "Nothing will happen to this.");

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("save-title").click();

  // The server refuses an empty patch, so a request would have produced an
  // error. Silence is the correct outcome for closing an editor untouched.
  await expect(signedIn.getByText("That will not do")).toHaveCount(0);
  await expect(toasts(signedIn)).not.toContainText("Saved");
  await expect(toasts(signedIn)).not.toContainText("That will not do");
});

test("refuses to empty a title, before asking the server", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "Has a title", "And a description.");

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("input-title").fill("   ");
  await signedIn.getByTestId("save-title").click();

  await expect(signedIn.getByText("a title is required")).toBeVisible();
  await expect(signedIn.getByTestId("issue-title")).toHaveText("Has a title");
});

test("adds labels, and the listing can then be filtered by one", async ({ signedIn, stack }) => {
  const id = await fileIssue(signedIn, stack.appUrl, "Needs a label", "So it can be found.");

  await signedIn.getByTestId("edit-labels").click();
  await chooseOrCreate(signedIn, "input-labels", "regression");
  await signedIn.getByTestId("save-labels").click();

  await expect(signedIn.getByTestId("sidebar-labels")).toContainText("regression");

  await signedIn.goto(`${stack.appUrl}/issues?label=regression`);
  await expect(signedIn.getByTestId(`issue-row-${id}`)).toBeVisible();
});

test("closes with a resolution and reopens again", async ({ signedIn, stack }) => {
  const id = await fileIssue(signedIn, stack.appUrl, "Will be closed", "And then reopened.");

  await signedIn.getByTestId("close-issue").click();
  await signedIn.getByTestId("close-resolution").fill("wontfix");
  await signedIn.getByTestId("confirm-close").click();

  await expect(signedIn.getByTestId("closed-banner")).toContainText("Resolution: wontfix");
  // Closing moves the directory, so it leaves the open listing entirely.
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId(`issue-row-${id}`)).toHaveCount(0);
  await signedIn.goto(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId(`issue-row-${id}`)).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/issues/${id}`);
  await signedIn.getByTestId("reopen-issue").click();
  await expect(signedIn.getByTestId("closed-banner")).toHaveCount(0);
});

test("records a duplicate as a link to the issue it duplicates", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "Filed twice", "The same as another.");

  await signedIn.getByTestId("close-issue").click();
  await signedIn.getByTestId("close-resolution").fill("duplicate");
  await signedIn.getByTestId("close-duplicate-of").fill("aaaa0001");
  await signedIn.getByTestId("confirm-close").click();

  await expect(signedIn.getByTestId("closed-banner")).toContainText("Duplicate of");
  await signedIn.getByTestId("closed-banner").getByRole("link").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001/);
});

test("comments, and replies to the comment", async ({ signedIn, stack }) => {
  await fileIssue(signedIn, stack.appUrl, "Worth discussing", "Somebody will have a view.");

  await signedIn.getByTestId("comment-body").fill("The first word on this.");
  await signedIn.getByTestId("comment-submit").click();
  await expect(signedIn.getByTestId("comment-thread")).toContainText("The first word on this.");

  const first = signedIn.locator("[data-testid^=comment-c], [data-testid^=comment-]").first();
  await first.getByRole("button", { name: "Reply" }).first().click();
  await expect(signedIn.getByText("Replying to")).toBeVisible();

  await signedIn.getByTestId("comment-body").fill("And the second.");
  await signedIn.getByTestId("comment-submit").click();

  // Nested, not beside: the reply names the comment it answers.
  await expect(signedIn.getByTestId("comment-thread")).toContainText("And the second.");
  await expect(
    signedIn
      .getByTestId("comment-thread")
      .locator("[data-testid^=comment-] [data-testid^=comment-]"),
  ).toHaveCount(1);
});

test("renders a comment as Markdown, without letting it become markup", async ({
  signedIn,
  stack,
}) => {
  await fileIssue(signedIn, stack.appUrl, "Markdown in a comment", "See below.");

  await signedIn
    .getByTestId("comment-body")
    .fill("**bold** and `code`\n\n<script>globalThis.__pwned = true</script>");
  await signedIn.getByTestId("comment-submit").click();

  await expect(signedIn.getByTestId("comment-thread").locator("strong")).toHaveText("bold");
  // The tag came from a repository anyone can write to; it must be text.
  await expect(signedIn.getByTestId("comment-thread")).toContainText("<script>");
  expect(await signedIn.evaluate(() => "__pwned" in globalThis)).toBe(false);
});

test("files one issue under another", async ({ signedIn, stack }) => {
  const parent = await fileIssue(signedIn, stack.appUrl, "A parent", "It will hold a subtask.");
  const child = await fileIssue(signedIn, stack.appUrl, "A child", "It will be filed under one.");

  await signedIn.goto(`${stack.appUrl}/issues/${parent}`);
  await signedIn.getByTestId("add-subtask").click();
  await signedIn.getByTestId("link-child-ref").fill(child);
  await signedIn.getByTestId("confirm-link").click();

  await expect(signedIn.getByRole("link", { name: "A child" })).toBeVisible();

  // The child knows about it too, which is the reciprocal half of the link.
  await signedIn.goto(`${stack.appUrl}/issues/${child}`);
  await expect(signedIn.getByRole("link", { name: "A parent" })).toBeVisible();
});

test("asks before moving a subtask that already has a parent", async ({ signedIn, stack }) => {
  const first = await fileIssue(signedIn, stack.appUrl, "The first parent", "It holds one.");
  const second = await fileIssue(signedIn, stack.appUrl, "The second parent", "It wants it.");
  const child = await fileIssue(signedIn, stack.appUrl, "The subtask", "It will be moved.");

  await signedIn.goto(`${stack.appUrl}/issues/${first}`);
  await signedIn.getByTestId("add-subtask").click();
  await signedIn.getByTestId("link-child-ref").fill(child);
  await signedIn.getByTestId("confirm-link").click();
  await expect(signedIn.getByRole("link", { name: "The subtask" })).toBeVisible();

  await signedIn.goto(`${stack.appUrl}/issues/${second}`);
  await signedIn.getByTestId("add-subtask").click();
  await signedIn.getByTestId("link-child-ref").fill(child);
  await signedIn.getByTestId("confirm-link").click();

  // Refused, and the refusal names the parent it has now — moving a subtask
  // changes a structure somebody else may be reading, so it is asked.
  await expect(signedIn.getByText("It already has a parent")).toBeVisible();
  await expect(signedIn.getByRole("dialog")).toContainText("The first parent");

  // Declining leaves the tree exactly as it was.
  await signedIn.getByRole("button", { name: "Leave it" }).click();
  await expect(signedIn.getByRole("link", { name: "The subtask" })).toHaveCount(0);

  await signedIn.getByTestId("add-subtask").click();
  await signedIn.getByTestId("link-child-ref").fill(child);
  await signedIn.getByTestId("confirm-link").click();
  await signedIn.getByTestId("confirm-reparent").click();

  await expect(signedIn.getByRole("link", { name: "The subtask" })).toBeVisible();
  await signedIn.goto(`${stack.appUrl}/issues/${first}`);
  await expect(signedIn.getByRole("link", { name: "The subtask" })).toHaveCount(0);
});

test("unlinks a subtask, which survives as an issue", async ({ signedIn, stack }) => {
  const parent = await fileIssue(signedIn, stack.appUrl, "Holds one briefly", "Not for long.");
  const child = await fileIssue(signedIn, stack.appUrl, "Briefly held", "It will be let go.");

  await signedIn.goto(`${stack.appUrl}/issues/${parent}`);
  await signedIn.getByTestId("add-subtask").click();
  await signedIn.getByTestId("link-child-ref").fill(child);
  await signedIn.getByTestId("confirm-link").click();
  await expect(signedIn.getByRole("link", { name: "Briefly held" })).toBeVisible();

  await signedIn.getByTestId(`unlink-${child}`).click();
  await expect(signedIn.getByRole("link", { name: "Briefly held" })).toHaveCount(0);

  // Unlinking is not deleting: the issue is still there, at the top level.
  await signedIn.goto(`${stack.appUrl}/issues/${child}`);
  await expect(signedIn.getByTestId("issue-title")).toHaveText("Briefly held");
});

test("files an issue under a parent from the start", async ({ signedIn, stack }) => {
  const parent = await fileIssue(signedIn, stack.appUrl, "Filed under from birth", "A parent.");

  await signedIn.goto(`${stack.appUrl}/issues/new`);
  await signedIn.getByTestId("new-title").fill("Born a subtask");
  await signedIn.getByTestId("new-body").fill("Filed under another from the form.");
  await signedIn.getByTestId("new-parent").fill(parent);
  await signedIn.getByTestId("submit-issue").click();

  await expect(signedIn.getByRole("link", { name: "Filed under from birth" })).toBeVisible();
});
