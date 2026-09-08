/**
 * The listing and its filter, which is the URL.
 *
 * What is asserted is that the query string and what the server returns agree,
 * starting with the empty case: a filter naming no status means any status, so
 * an unfiltered listing holds closed issues too.
 *
 * Then the ways in. The front page and the wordmark both name a status, since
 * arriving nowhere in particular should not mean arriving on the closed ones;
 * the tab beside the wordmark still means the whole listing. Those are the only
 * assertions about what a URL is before anybody has typed one.
 *
 * The last few are about the bar rather than the answer: which of its controls
 * a screen is wide enough to hold, which is the one thing here that a URL
 * cannot say.
 */

import { chooseOrCreate, expect, test } from "./helpers/fixtures.ts";

/** The five menus, which are the controls that fold away on a narrow screen. */
const MENUS = ["labels", "assignees", "authors", "milestones", "features"] as const;

test("lists issues of every status, newest first", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  const rows = signedIn.locator("[data-testid^=issue-row-]");
  await expect(rows.first()).toBeVisible();

  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  // The fixture's closed issue belongs here too: no status named means any.
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();

  // Nothing is preselected, so no chip reads as pressed.
  await expect(signedIn.getByTestId("filter-status-open")).toHaveAttribute("aria-pressed", "false");
  await expect(signedIn.getByTestId("filter-status-closed")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("narrows to one status when the URL asks for it", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
  await expect(signedIn.getByTestId("filter-status-open")).toHaveAttribute("aria-pressed", "true");

  await signedIn.goto(`${stack.appUrl}/issues?status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toHaveCount(0);

  // Naming both is the same set as naming neither.
  await signedIn.goto(`${stack.appUrl}/issues?status=open&status=closed`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
});

test("sends the root to the open issues", async ({ signedIn, stack }) => {
  await signedIn.goto(stack.appUrl);
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=open`);

  // The filter arrived and not merely the path: the closed fixture issue is
  // gone, and the chip reads as pressed — which is what makes it removable.
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
  await expect(signedIn.getByTestId("filter-status-open")).toHaveAttribute("aria-pressed", "true");

  // A place to land rather than a new default for the listing, so Clear still
  // gets every status back.
  await signedIn.getByTestId("filter-clear").click();
  await expect(signedIn).not.toHaveURL(/status=/);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
});

test("replaces a query on the root rather than carrying it in", async ({ signedIn, stack }) => {
  // Nothing in the app links to `/` with a query, so one arriving there came
  // from a bookmark or a keyboard. The redirect names the whole filter, and
  // what it names is what the listing gets.
  await signedIn.goto(`${stack.appUrl}/?label=bug`);
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=open`);

  // An open issue carrying no `bug` label is still listed, so the label was
  // dropped; the closed one is not, so the status was not.
  await expect(signedIn.getByTestId("issue-row-cafe0005")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
});

test("takes the wordmark home and the tab back to where the listing was", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues?label=bug`);
  await signedIn.getByTestId("nav-prs").click();

  // The two sit next to each other and do not mean the same thing. The tab is
  // the way back to the listing as it was left (`filter-memory.spec.ts`)...
  await signedIn.getByRole("link", { name: "Issues", exact: true }).click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?label=bug`);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();

  // ...and the wordmark is the way home, every time, whatever was left where.
  await signedIn.getByRole("link", { name: "Navbook", exact: true }).click();
  await expect(signedIn).toHaveURL(`${stack.appUrl}/issues?status=open`);
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toHaveCount(0);
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
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toHaveCount(0);

  // Untoggling leaves no status named, which is every status again.
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).not.toHaveURL(/status=/);
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
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
  // A URL shared from the pull request list, or typed by hand. The status is
  // dropped, which leaves no status named — so the listing is unnarrowed.
  await signedIn.goto(`${stack.appUrl}/issues?status=merged`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0006")).toBeVisible();
});

test("opens an issue from the list", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await signedIn.getByTestId("issue-row-aaaa0001").click();
  await expect(signedIn).toHaveURL(/\/issues\/aaaa0001/);
  await expect(signedIn.getByTestId("issue-title")).toContainText("Sign-in is unreliable");
});

test("puts every menu on one line on a wide screen, with nothing to unfold", async ({
  signedIn,
  stack,
}) => {
  // A status is named so that Clear is on screen and the third row exists.
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  for (const key of MENUS) {
    await expect(signedIn.getByTestId(`filter-${key}`)).toBeVisible();
  }
  await expect(signedIn.getByTestId("filter-advanced")).toBeHidden();

  // Three rows: the box beside the chips, the five menus, then Clear. Polled
  // rather than read once, because a rect read while the page is still
  // settling is a rect from a layout that no longer holds.
  const top = async (testid: string): Promise<number> =>
    (await signedIn.getByTestId(testid).boundingBox())?.y ?? Number.NaN;

  await expect
    .poll(async () => {
      const menus: number[] = [];
      for (const key of MENUS) menus.push(await top(`filter-${key}`));
      return {
        lines: new Set(menus).size,
        chipsAbove: (await top("filter-status-open")) < Math.min(...menus),
        clearBelow: (await top("filter-clear")) > Math.max(...menus),
      };
    })
    .toEqual({ lines: 1, chipsAbove: true, clearBelow: true });
});

test("keeps a menu in view when the window narrows after it was used", async ({
  signedIn,
  stack,
}) => {
  // The menus are always on screen above `md`, so one can be chosen without the
  // panel ever having been unfolded. Narrowing the window then must not hide
  // the filter now narrowing the listing.
  await signedIn.goto(`${stack.appUrl}/issues`);
  await chooseOrCreate(signedIn, "filter-labels", "bug");
  await expect(signedIn).toHaveURL(/[?&]label=bug/);

  await signedIn.setViewportSize({ width: 390, height: 844 });
  await expect(signedIn.getByTestId("filter-advanced")).toHaveAttribute("aria-expanded", "true");
  await expect(signedIn.getByTestId("filter-labels")).toBeVisible();
});

test("gives the menus back when the window widens, without being asked", async ({
  signedIn,
  stack,
}) => {
  // The other half of hiding them with CSS: nothing is listening for a resize,
  // so widening has to be enough on its own.
  await signedIn.setViewportSize({ width: 390, height: 844 });
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId("filter-labels")).toBeHidden();

  await signedIn.setViewportSize({ width: 1280, height: 800 });
  await expect(signedIn.getByTestId("filter-labels")).toBeVisible();
  await expect(signedIn.getByTestId("filter-advanced")).toBeHidden();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds the menus away until they are asked for", async ({ signedIn, stack }) => {
    await signedIn.goto(`${stack.appUrl}/issues`);
    // What is reached for on a phone stays on screen; the menus do not.
    await expect(signedIn.getByTestId("filter-text")).toBeVisible();
    await expect(signedIn.getByTestId("filter-status-open")).toBeVisible();

    const toggle = signedIn.getByTestId("filter-advanced");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A disclosure, said as one: a button that names what it holds and reports
    // whether it is open.
    await expect(signedIn.getByRole("button", { name: "Advanced search" })).toBeVisible();
    for (const key of MENUS) {
      await expect(signedIn.getByTestId(`filter-${key}`)).toBeHidden();
    }
    // Nothing is narrowing by a menu, so there is nothing to count.
    await expect(signedIn.getByTestId("filter-advanced-count")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const key of MENUS) {
      await expect(signedIn.getByTestId(`filter-${key}`)).toBeVisible();
    }

    // And folds away again, since it is a disclosure and not a one-way door.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(signedIn.getByTestId("filter-labels")).toBeHidden();
  });

  test("narrows the listing from a menu once unfolded", async ({ signedIn, stack }) => {
    // The whole point of the toggle: what it hides still works when asked for.
    await signedIn.goto(`${stack.appUrl}/issues`);
    await signedIn.getByTestId("filter-advanced").click();
    await chooseOrCreate(signedIn, "filter-labels", "bug");

    await expect(signedIn).toHaveURL(/[?&]label=bug/);
    await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
    await expect(signedIn.getByTestId("issue-row-cafe0005")).toHaveCount(0);
    await expect(signedIn.getByTestId("filter-advanced-count")).toHaveText("1");
  });

  test("unfolds itself when the URL already names a menu filter", async ({ signedIn, stack }) => {
    // A filter you cannot see is one you cannot take off.
    await signedIn.goto(`${stack.appUrl}/issues?label=bug`);
    const toggle = signedIn.getByTestId("filter-advanced");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(signedIn.getByTestId("filter-labels")).toBeVisible();
    await expect(signedIn.getByTestId("filter-advanced-count")).toHaveText("1");
    await expect(signedIn.getByTestId("issue-row-aaaa0001")).toBeVisible();
  });

  test("counts values rather than menus, and only the menus", async ({ signedIn, stack }) => {
    // Two labels are two things chosen, though they are one menu.
    await signedIn.goto(`${stack.appUrl}/issues?label=bug&label=auth`);
    await expect(signedIn.getByTestId("filter-advanced-count")).toHaveText("2");
    // And a number on its own says nothing when it is read out rather than seen.
    await expect(signedIn.getByRole("button", { name: "Advanced search 2 chosen" })).toBeVisible();

    // The box and the chips are on screen already, so they are not counted and
    // they do not unfold anything — but they are still a filter to clear.
    await signedIn.goto(`${stack.appUrl}/issues?q=deadline&status=open`);
    await expect(signedIn.getByTestId("filter-advanced")).toHaveAttribute("aria-expanded", "false");
    await expect(signedIn.getByTestId("filter-advanced-count")).toHaveCount(0);
    await expect(signedIn.getByTestId("filter-clear")).toBeVisible();
  });
});

/**
 * Rank, deadline and the orders they can be read in — spec 02 §2.5.
 *
 * The listing keeps newest first unless somebody asks otherwise, so every
 * assertion about an order starts by asking for it. The three fixture issues
 * that carry these keys were filed in the opposite order to their ranks, which
 * is what makes an assertion about priority able to fail.
 */

/** The ids a listing shows, in the order it shows them. */
const listed = async (page: import("@playwright/test").Page): Promise<string[]> =>
  page
    // The rank chip inside a row is `issue-row-rank`, so it is excluded rather
    // than read as a row of its own.
    .locator("[data-testid^=issue-row-]:not([data-testid=issue-row-rank])")
    .evaluateAll((rows) =>
      rows.map((row) => (row.getAttribute("data-testid") ?? "").replace("issue-row-", "")),
    );

/**
 * The named ids appear in the listing, in the order given.
 *
 * Polled rather than read once: a listing is fetched after the page loads and
 * refetched when it is revisited, so reading the DOM the moment a navigation
 * settles can catch it empty. Everything not named is filtered out, so what is
 * asserted is relative order and not what else happens to be listed.
 */
async function expectOrder(page: import("@playwright/test").Page, ...ids: string[]): Promise<void> {
  await expect.poll(async () => (await listed(page)).filter((id) => ids.includes(id))).toEqual(ids);
}

test("shows a rank and a deadline on the rows that carry them", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  const urgent = signedIn.getByTestId("issue-row-aaaa0008");
  await expect(urgent.getByTestId("issue-row-rank")).toHaveText("10");
  // Its day is long past, so the badge reads as overdue rather than as a date.
  await expect(urgent.getByTestId("due-date-overdue")).toContainText("overdue");

  // And an issue carrying neither shows neither.
  const plain = signedIn.getByTestId("issue-row-cafe0005");
  await expect(plain.getByTestId("issue-row-rank")).toHaveCount(0);
  await expect(plain.getByTestId("due-date")).toHaveCount(0);
});

test("reads the listing newest first until an order is asked for", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  await expect(signedIn.getByTestId("sort-newest")).toHaveAttribute("aria-checked", "true");
  // Filed in the opposite order to their ranks, so newest-first is the reverse
  // of what priority reads — which is what lets either assertion fail.
  await expectOrder(signedIn, "aaaa0010", "aaaa0009", "aaaa0008");
});

test("puts the ranked first under priority, and says so in the URL", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  await signedIn.getByTestId("sort-priority").click();
  await expect(signedIn).toHaveURL(/sort=priority/);
  await expect(signedIn.getByTestId("sort-priority")).toHaveAttribute("aria-checked", "true");

  // Ranked 10, ranked 20, then the one with only a day — and an issue carrying
  // neither key after all three.
  await expectOrder(signedIn, "aaaa0008", "aaaa0009", "aaaa0010", "cafe0005");
});

test("puts the soonest first under deadline", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open&sort=deadline`);
  // Due 2026-08-01, then 2099-12-31, then the placed-but-undated one — the
  // second tier of the chain putting it above the row with neither key.
  await expectOrder(signedIn, "aaaa0008", "aaaa0010", "aaaa0009", "cafe0005");
});

test("keeps the order when the filter changes and when it is cleared", async ({
  signedIn,
  stack,
}) => {
  // Clearing a filter is about which rows are listed, not about the order they
  // are read in, so `sort` outlives it — as `refs` does on the other listing.
  await signedIn.goto(`${stack.appUrl}/issues?status=open&sort=priority`);
  await signedIn.getByTestId("filter-status-closed").click();
  await expect(signedIn).toHaveURL(/sort=priority/);
  await signedIn.getByTestId("filter-clear").click();
  await expect(signedIn).toHaveURL(/sort=priority/);
  await expect(signedIn).not.toHaveURL(/status=/);
});

test("reads an order it does not know as the default, rather than failing", async ({
  signedIn,
  stack,
}) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open&sort=priorty`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
  await expect(signedIn.getByTestId("sort-newest")).toHaveAttribute("aria-checked", "true");
});

test("narrows to what is overdue, and to what has no day at all", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues?status=open`);
  await signedIn.getByTestId("filter-deadline-overdue").click();
  await expect(signedIn).toHaveURL(/deadline=overdue/);
  await expect(signedIn.getByTestId("issue-row-aaaa0008")).toBeVisible();
  // Due in 2099: dated, and not late.
  await expect(signedIn.getByTestId("issue-row-aaaa0010")).toHaveCount(0);

  await signedIn.goto(`${stack.appUrl}/issues?status=open&deadline=none`);
  await expect(signedIn.getByTestId("issue-row-aaaa0009")).toBeVisible();
  await expect(signedIn.getByTestId("issue-row-aaaa0008")).toHaveCount(0);
});

test("does not offer a deadline filter on the pull requests", async ({ signedIn, stack }) => {
  // Only an issue is scheduled (spec 02 §2.5), so the chips are absent rather
  // than present and inert — and a URL naming one is read as no narrowing.
  await signedIn.goto(`${stack.appUrl}/prs?deadline=overdue`);
  await expect(signedIn.getByTestId("filter-deadline-overdue")).toHaveCount(0);
  await expect(signedIn.getByTestId("pr-row-bbbb0001")).toBeVisible();
});
