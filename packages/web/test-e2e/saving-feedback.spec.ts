/**
 * What the page shows between clicking Save and the server answering.
 *
 * Every write is a fetch, a commit and a push, so the answer is routinely
 * seconds away on a deployed tracker. These hold or refuse the one operation
 * under test at the network edge — `page.route` on the GraphQL endpoint —
 * and leave every other request to the real server, so what is proved is the
 * client's behaviour over a slow or refusing backend, not a mocked one.
 *
 * The edits are made on an issue nothing else reads for its metadata, so the
 * labels and assignees they leave behind break no other spec.
 */

import type { Route } from "@playwright/test";
import { chooseOrCreate, expect, test, toasts } from "./helpers/fixtures.ts";

/** Answer one named operation, and let every other one through. */
function only(operation: string, handle: (route: Route) => Promise<void>) {
  return async (route: Route): Promise<void> => {
    const body = route.request().postData() ?? "";
    if (!body.includes(`${operation}(`)) return route.continue();
    await handle(route);
  };
}

/** A gate that holds a request until the test opens it. */
function gate(): { held: Promise<void>; open: () => void } {
  let open!: () => void;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { held, open };
}

/** What the server sends when the remote refuses the push. */
const REFUSED = JSON.stringify({
  data: null,
  errors: [
    {
      message: "the remote refused the push",
      path: ["updateIssue"],
      extensions: {
        code: "SYNC_PUSH_REJECTED",
        details: ["origin rejected refs/heads/main"],
      },
    },
  ],
});

test("shows a saved assignee at once, and admits to waiting only once it is slow", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/cafe0005`);
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();

  const answer = gate();
  const hold = only("updateIssue", async (route) => {
    await answer.held;
    await route.continue();
  });
  await signedIn.route(stack.apiUrl, hold);

  await signedIn.getByTestId("edit-assignees").click();
  await chooseOrCreate(signedIn, "input-assignees", "slow@example.com");
  await signedIn.getByTestId("save-assignees").click();

  // Shown the moment it is saved, while the request is still being held —
  // not the old list, which is what read as the edit being thrown away.
  await expect(signedIn.getByTestId("chip-assignees-slow@example.com")).toBeVisible();
  await expect(signedIn.getByTestId("saving-assignees")).toHaveCount(0);

  // A responsive backend never shows a spinner: nothing for the first while.
  await signedIn.waitForTimeout(800);
  await expect(signedIn.getByTestId("saving-assignees")).toHaveCount(0);
  await expect(signedIn.getByTestId("chip-assignees-slow@example.com")).toBeVisible();
  // Then, once it has been long, the field says so — and only the field: the
  // comment button is not doing anything and does not spin.
  await expect(signedIn.getByTestId("saving-assignees")).toBeVisible();
  await expect(signedIn.getByTestId("comment-submit").locator(".animate-spin")).toHaveCount(0);

  answer.open();
  await expect(toasts(signedIn)).toContainText("Saved");
  await expect(signedIn.getByTestId("saving-assignees")).toHaveCount(0);
  await expect(signedIn.getByTestId("chip-assignees-slow@example.com")).toBeVisible();
  await signedIn.unroute(stack.apiUrl, hold);
});

test("keeps a refused edit beside the field, with a retry and a discard", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues/cafe0005`);
  await expect(signedIn.getByTestId("issue-detail")).toBeVisible();

  const refuse = only("updateIssue", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: REFUSED }),
  );
  await signedIn.route(stack.apiUrl, refuse);

  await signedIn.getByTestId("edit-labels").click();
  await chooseOrCreate(signedIn, "input-labels", "kept");
  await signedIn.getByTestId("save-labels").click();

  // The server's own words, beside the field, and the value still shown:
  // what was typed is the only copy of itself.
  const failed = signedIn.getByTestId("save-failed-labels");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("The remote refused the push");
  await expect(failed).toContainText("origin rejected refs/heads/main");
  await expect(signedIn.getByTestId("chip-labels-kept")).toBeVisible();
  // Said once, there, and not again as a toast.
  await expect(toasts(signedIn)).not.toContainText("refused");

  // Discard: the file's value comes back.
  await signedIn.getByTestId("discard-labels").click();
  await expect(failed).toHaveCount(0);
  await expect(signedIn.getByTestId("chip-labels-kept")).toHaveCount(0);

  // Again, and this time the server is let answer the retry.
  await signedIn.getByTestId("edit-labels").click();
  await chooseOrCreate(signedIn, "input-labels", "kept");
  await signedIn.getByTestId("save-labels").click();
  await expect(failed).toBeVisible();
  await signedIn.unroute(stack.apiUrl, refuse);

  await signedIn.getByTestId("retry-labels").click();
  await expect(toasts(signedIn)).toContainText("Saved");
  await expect(failed).toHaveCount(0);
  await expect(signedIn.getByTestId("chip-labels-kept")).toBeVisible();

  // And the file agrees, which is what a reload says.
  await signedIn.goto(`${stack.appUrl}/issues/cafe0005`);
  await expect(signedIn.getByTestId("chip-labels-kept")).toBeVisible();
});

test("lists a reviewer just asked as pending before the server answers", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/prs/bbbb0001`);
  await expect(signedIn.getByTestId("pr-detail")).toBeVisible();

  const answer = gate();
  const hold = only("updatePr", async (route) => {
    await answer.held;
    await route.continue();
  });
  await signedIn.route(stack.apiUrl, hold);

  await signedIn.getByTestId("edit-reviewers").click();
  await chooseOrCreate(signedIn, "input-reviewers", "asked@example.com");
  await signedIn.getByTestId("save-reviewers").click();

  // The reviewer states are derived on the server, so the row is invented
  // meanwhile: asked, and pending.
  const row = signedIn.getByTestId("reviewer-asked@example.com");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Pending");

  answer.open();
  await expect(toasts(signedIn)).toContainText("Reviewers updated");
  await expect(row).toContainText("Pending");
  await signedIn.unroute(stack.apiUrl, hold);
});

test("keeps a refused drop where it landed, until it is retried or let go", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/inbox`);
  const rows = signedIn.locator("[data-testid=inbox-list] > [data-testid^=inbox-row-]");
  await expect(rows.first()).toBeVisible();
  const before = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-testid")),
  );

  const refuse = only("updateIssue", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: REFUSED }),
  );
  await signedIn.route(stack.apiUrl, refuse);

  const grip = signedIn.getByTestId("inbox-grip-aaaa0008");
  await grip.focus();
  await signedIn.keyboard.press("Space");
  await signedIn.keyboard.press("ArrowDown");
  await signedIn.keyboard.press("Space");

  const failed = signedIn.getByTestId("save-failed-reorder");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("The remote refused the push");
  // Still where it was dropped, not sprung back: the person has not answered.
  await expect(rows.nth(1)).toHaveAttribute("data-testid", "inbox-row-aaaa0008");

  await signedIn.getByTestId("discard-reorder").click();
  await expect(failed).toHaveCount(0);
  const after = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-testid")),
  );
  expect(after).toEqual(before);
  await expect(toasts(signedIn)).not.toContainText("Saved");
  await signedIn.unroute(stack.apiUrl, refuse);
});
