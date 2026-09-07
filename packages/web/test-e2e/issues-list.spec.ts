/**
 * The listing and its filter, which is the URL.
 *
 * What is asserted is that the query string and what the server returns agree,
 * starting with the empty case: a filter naming no status means any status, so
 * an unfiltered listing holds closed issues too.
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
