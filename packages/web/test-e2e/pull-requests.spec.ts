/**
 * Pull requests, and the one thing about them that is genuinely different from
 * issues: their files live on the branch they propose to merge, so which
 * branch the server is on decides what it can read and what it can write.
 *
 * The fixture is arranged around that. One pull request is on the branch the
 * clone is checked out at — readable and writable. The other is on a branch the
 * clone has only fetched — findable with `allRefs`, readable, and writable by
 * nobody. Proving the second refuses, and says which branch to serve, is the
 * point of this file.
 *
 * The unserved one is also where the review request is asserted, for the same
 * reason: nothing here can write to it, so what it asks of the signed-in person
 * stays outstanding however much the rest of the suite reviews the other.
 */

import { chooseOrCreate, expect, test, toasts } from "./helpers/fixtures.ts";

test("lists what the checkout holds, and no more", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
  // Its files are on a branch this clone does not have checked out.
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toHaveCount(0);
});

test("finds the rest with every fetched branch", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs?refs=all`);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toBeVisible();
  // And it says where it found it.
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toContainText("feat/unserved");
});

test("puts the branch toggle in the address bar", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs`);
  await signedIn.getByTestId("all-refs").click();
  await expect(signedIn).toHaveURL(/refs=all/);
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toBeVisible();

  await signedIn.getByTestId("all-refs").click();
  await expect(signedIn).not.toHaveURL(/refs=all/);
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toHaveCount(0);
});

test("marks a draft as one", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs?refs=all`);
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toContainText("Draft");
});

test("shows what a pull request proposes and what it has been", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn.getByTestId("pr-title")).toContainText("Raise the sign-in deadline");
  await expect(signedIn.getByTestId("pr-target")).toHaveText("main");
  await expect(signedIn.getByTestId("pr-detail")).toContainText("feat/served");

  // A revision is a recorded state of the branch, and the newest is the one a
  // review binds to unless told otherwise.
  await expect(signedIn.getByTestId("revisions")).toContainText("latest");
});

test("shows a review as a verdict bound to a revision", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  const thread = signedIn.getByTestId("pr-comment-thread");
  await expect(thread).toContainText("Approved");
  // The file and line it points at, which is what makes it a review of code.
  await expect(thread).toContainText("app/auth/session.ts:42-48");
});

test("records a comment, and then a review with a verdict", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);

  await signedIn.getByTestId("review-body").fill("A plain remark, with no verdict.");
  await signedIn.getByTestId("review-submit").click();
  await expect(toasts(signedIn)).toContainText("Commented");
  await expect(signedIn.getByTestId("pr-comment-thread")).toContainText("A plain remark");

  await signedIn.getByTestId("review-body").fill("Requesting a change to the constant's name.");
  await signedIn.getByRole("radio", { name: "Request changes" }).check();
  await signedIn.getByTestId("review-submit").click();
  await expect(toasts(signedIn)).toContainText("Review recorded");
  await expect(signedIn.getByTestId("pr-comment-thread")).toContainText("Changes requested");
});

test("offers the review fields only once there is a verdict", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  // The server refuses review fields on a plain comment, so they are not there
  // to fill in until the comment has become a review.
  await expect(signedIn.getByTestId("review-revision")).toHaveCount(0);

  await signedIn.getByRole("radio", { name: "Approve" }).check();
  await expect(signedIn.getByTestId("review-revision")).toBeVisible();
  await expect(signedIn.getByTestId("review-file")).toBeVisible();
  await expect(signedIn.getByTestId("review-line")).toBeVisible();
});

test("refuses a comment on a branch it does not serve, and says which", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002`);
  await expect(signedIn.getByTestId("pr-title")).toContainText("does not serve");

  await signedIn.getByTestId("review-body").fill("Can this be commented on from here?");
  await signedIn.getByTestId("review-submit").click();

  // Not a toast: the remedy is to serve another branch, which is an operator's
  // action, and it belongs beside the form that provoked it.
  const alert = signedIn.getByTestId("unserved-branch");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("feat/unserved");
  await expect(alert).toContainText("serve a checkout of that branch");

  // And the form stops offering, rather than letting it be tried again.
  await expect(signedIn.getByTestId("review-submit")).toBeDisabled();
});

test("shows who was asked to review, and what each of them said", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  const states = signedIn.getByTestId("reviewer-states");
  // Asked in the fixture, and answered there too.
  await expect(states.getByTestId("reviewer-someone@example.invalid")).toContainText("Approved");
});

test("asks somebody else to review, and shows them as pending", async ({ signedIn, stack }) => {
  // A fresh address each run: the suite shares one repository, so a request
  // made here must not depend on nobody having made it before.
  const who = `reviewer-${Date.now()}@example.invalid`;
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);

  await signedIn.getByTestId("edit-reviewers").click();
  await chooseOrCreate(signedIn, "input-reviewers", who);
  await signedIn.getByTestId("save-reviewers").click();

  await expect(toasts(signedIn)).toContainText("docs(pr): edit #bbbb0001");
  await expect(signedIn.getByTestId(`reviewer-${who}`)).toContainText("Pending");
});

test("edits the fields updatePr takes, not only the reviewers", async ({ signedIn, stack }) => {
  // A fresh value each run, for the reason the reviewer test gives: the suite
  // shares one repository across runs.
  const label = `triaged-${Date.now()}`;
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);

  await signedIn.getByTestId("edit-labels").click();
  await chooseOrCreate(signedIn, "input-labels", label);
  await signedIn.getByTestId("save-labels").click();
  await expect(toasts(signedIn)).toContainText("docs(pr): edit #bbbb0001");
  await expect(signedIn.getByTestId(`chip-labels-${label}`)).toBeVisible();

  // A milestone is the field the server has a test for and the page had no
  // control for at all, which is the whole of this bug.
  const milestone = `v${Date.now()}`;
  await signedIn.getByTestId("edit-milestone").click();
  await chooseOrCreate(signedIn, "input-milestone", milestone);
  await signedIn.getByTestId("save-milestone").click();
  await expect(signedIn.getByTestId(`chip-milestone-${milestone}`)).toBeVisible();

  // And it survives a reload, so what is on screen is what was written rather
  // than what the cache was told.
  await signedIn.reload();
  await expect(signedIn.getByTestId(`chip-labels-${label}`)).toBeVisible();
  await expect(signedIn.getByTestId(`chip-milestone-${milestone}`)).toBeVisible();
});

test("edits a pull request's title in place", async ({ signedIn, stack }) => {
  const title = `Raise the sign-in deadline (${Date.now()})`;
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);

  await signedIn.getByTestId("edit-title").click();
  await signedIn.getByTestId("input-title").fill(title);
  await signedIn.getByTestId("save-title").click();

  await expect(signedIn.getByTestId("pr-title")).toHaveText(title);
  await signedIn.reload();
  await expect(signedIn.getByTestId("pr-title")).toHaveText(title);
});

test("records a review that judges nothing", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await signedIn.getByTestId("review-body").fill("Read it through; nothing to add.");
  await signedIn.getByRole("radio", { name: "Reviewed, no verdict" }).check();
  // It binds to a revision like any review, so the fields appear.
  await expect(signedIn.getByTestId("review-revision")).toBeVisible();
  await signedIn.getByTestId("review-submit").click();

  await expect(toasts(signedIn)).toContainText("Review recorded");
  await expect(signedIn.getByTestId("pr-comment-thread")).toContainText("Reviewed");
});

test("says a review is pending on one nobody has answered", async ({ signedIn, stack }) => {
  // The unserved pull request: nothing in this suite can write to it, so its
  // request stays outstanding however much the rest of the suite reviews.
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002`);
  await expect(signedIn.getByTestId("review-decision")).toContainText("Review pending");
  await expect(signedIn.getByTestId("reviewer-person@example.invalid")).toContainText("Pending");
});

test("says how many approvals are still needed, and what asks for them", async ({
  signedIn,
  stack,
}) => {
  // The unserved pull request again, for the reason the header gives: the
  // fixture asks for two approvals and nothing in this suite can add one here,
  // so the count stays where the fixture put it however often this runs.
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002`);
  await expect(signedIn.getByTestId("review-decision")).toContainText("0 of 2 approvals");
  await expect(signedIn.getByTestId("review-policy")).toContainText(
    "Requires 2 approvals · self-review off",
  );
  // Nothing is disabled by any of it: the API exposes no merge, and a policy
  // gates nothing anywhere (spec 01 §1.7).
  await expect(signedIn.getByTestId("review-policy-problems")).toHaveCount(0);
});

test("finds the reviews this person still owes", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs?refs=all`);
  await signedIn.getByTestId("awaiting-me").click();
  await expect(signedIn).toHaveURL(/awaiting=me/);

  // Asked of the signed-in person and unanswered; the other one asked somebody
  // else, so it drops out.
  await expect(signedIn.getByTestId("pr-row-bbbb0002")).toBeVisible();
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toHaveCount(0);

  await signedIn.getByTestId("awaiting-me").click();
  await expect(signedIn).not.toHaveURL(/awaiting=me/);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
});

test("refuses to change the reviewers of a branch it does not serve", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002`);
  await signedIn.getByTestId("edit-reviewers").click();
  await chooseOrCreate(signedIn, "input-reviewers", "nobody@example.invalid");
  await signedIn.getByTestId("save-reviewers").click();

  const alert = signedIn.getByTestId("unserved-branch");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("feat/unserved");

  // And it stops offering, as the comment form does: a second attempt would be
  // refused the same way, and typing into one is worse than not being asked.
  // Every field goes, not just the one that was refused — the refusal is about
  // the branch, which is the same answer for all of them.
  for (const field of ["reviewers", "labels", "assignees", "features", "milestone", "title"]) {
    await expect(signedIn.getByTestId(`edit-${field}`)).toHaveCount(0);
  }
});

test("says so when there is no such pull request", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/zzzz9999`);
  await expect(signedIn.getByText("Not found")).toBeVisible();
});

/*
 * The three tabs. The conversation is what the page always was; the other two
 * read the revision's commits and diff from the object store, which is what
 * makes them work for the unserved pull request too.
 */

test("opens on the conversation, and puts the tab in the address bar", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn.getByTestId("pr-tab-conversation")).toHaveAttribute("aria-current", "page");
  await expect(signedIn.getByTestId("pr-comment-thread")).toBeVisible();

  await signedIn.getByTestId("pr-tab-commits").click();
  await expect(signedIn).toHaveURL(/tab=commits/);
  await expect(signedIn.getByTestId("pr-commits")).toBeVisible();
  await expect(signedIn.getByTestId("pr-comment-thread")).toHaveCount(0);

  await signedIn.getByTestId("pr-tab-conversation").click();
  await expect(signedIn).not.toHaveURL(/tab=/);
  await expect(signedIn.getByTestId("pr-comment-thread")).toBeVisible();
});

test("lists the commits the branch brings, oldest first", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001?tab=commits`);
  const table = signedIn.getByTestId("pr-commits");
  await expect(table).toContainText("feat: Raise the sign-in deadline");
  await expect(table).toContainText("Navbook Dev Server");
  // The tab says how many once it has read them.
  await expect(signedIn.getByTestId("pr-tab-commits")).toContainText("1");
});

test("shows what the branch changes, file by file", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001?tab=changes`);
  await expect(signedIn.getByTestId("changes-summary")).toContainText("2 files changed");
  const file = signedIn.getByTestId("diff-file-feat-served.txt");
  await expect(file).toContainText("feat-served.txt");
  await expect(file).toContainText("+1");
  await expect(file).toContainText("work on feat/served");
  // A file folds away and comes back.
  await file.getByRole("button", { name: "Collapse" }).click();
  await expect(file).not.toContainText("work on feat/served");
  await file.getByRole("button", { name: "Expand" }).click();
  await expect(file).toContainText("work on feat/served");
});

test("withholds a large file until it is asked for", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001?tab=changes`);
  const big = signedIn.getByTestId("diff-file-generated/feat-served.txt");
  // Listed with its counts, but its lines are not on the page.
  await expect(big).toContainText("+1200");
  await expect(big).toContainText("Large diff not shown by default");
  await expect(big).not.toContainText("line 1200 of feat/served");

  await signedIn.getByTestId("load-diff-generated/feat-served.txt").click();
  await expect(big).toContainText("line 1200 of feat/served");
  await expect(big).not.toContainText("Large diff not shown by default");
});

test("reads the diff of a pull request on a branch it does not serve", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0002?tab=changes`);
  await expect(signedIn.getByTestId("changes-summary")).toContainText("2 files changed");
  await expect(signedIn.getByTestId("diff-file-feat-unserved.txt")).toContainText(
    "work on feat/unserved",
  );
});
