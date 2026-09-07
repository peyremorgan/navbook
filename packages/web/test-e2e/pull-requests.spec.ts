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
});

test("says so when there is no such pull request", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/prs/zzzz9999`);
  await expect(signedIn.getByText("Not found")).toBeVisible();
});
