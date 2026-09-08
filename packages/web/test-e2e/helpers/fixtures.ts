/**
 * The stack, and a signed-in page, as Playwright fixtures.
 *
 * One stack for the run rather than one per test: it holds a git repository
 * and a server that serialises every operation against a single working tree,
 * so there is nothing to gain from several and a good deal of start-up cost to
 * pay. That makes the suite stateful — tests share a repository — which the
 * specs are written to expect: each one files what it needs rather than
 * assuming what another left behind.
 *
 * Signing in is done through the issuer's own form, because that is the flow
 * under test. `storageState` cannot be reused between runs: the ports are
 * ephemeral, so a stored session names a provider that is no longer there.
 */

import { test as base, type Page } from "@playwright/test";
import { type Stack, type StackOptions, startStack } from "./stack.ts";

export interface Fixtures {
  stack: Stack;
  /** A page that has already been through the provider. */
  signedIn: Page;
}

let shared: Promise<Stack> | null = null;

/** The one stack, started on first use and stopped by the global teardown. */
export function stack(): Promise<Stack> {
  shared ??= startStack();
  return shared;
}

export async function stopStack(): Promise<void> {
  if (shared === null) return;
  const running = await shared;
  shared = null;
  await running.stop();
}

/**
 * A stack of one spec's own, for the things the shared one cannot show.
 *
 * The caller stops it. Only worth the start-up cost when a spec needs the
 * stack configured differently — a short token lifetime, so far.
 */
export function ownStack(options: StackOptions): Promise<Stack> {
  return startStack(options);
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature
  stack: async ({}, use) => {
    await use(await stack());
  },

  signedIn: async ({ page, stack: running }, use) => {
    await signIn(page, running);
    await use(page);
  },
});

export { expect } from "@playwright/test";

/**
 * The toast stack.
 *
 * Nuxt UI renders toasts into a labelled region rather than giving each one a
 * role a test can name, so the region is the handle. What is asserted through
 * it is always a `commit` — what the server recorded, and whether it landed on
 * the remote — which is the thing this client must never quietly swallow.
 */
export function toasts(page: Page) {
  return page.locator("[aria-label*=Notification]");
}

/**
 * Pick a value from a creatable menu, inventing it if the list has never seen
 * it. Labels and milestones are free text with no registry behind them, so
 * inventing one is the ordinary case rather than the exception. A person the
 * server already knows of is offered instead, and picking the first option is
 * then picking them — under the name the repository has for them, which is not
 * always the spelling that was typed.
 */
export async function chooseOrCreate(page: Page, testid: string, value: string): Promise<void> {
  await page.getByTestId(testid).click();
  await page.getByPlaceholder("Search…").fill(value);
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");
}

/**
 * Go to the app and come back holding a token.
 *
 * The redirect to the provider happens because the route middleware finds no
 * usable token; filling the form is what a person does; landing back on the
 * app is the callback route having spent the code.
 */
export async function signIn(
  page: Page,
  running: Stack,
  who: { name?: string; email?: string } = {},
): Promise<void> {
  await page.goto(`${running.appUrl}/issues`);
  await page.waitForSelector("#email");
  if (who.name !== undefined) await page.fill("#name", who.name);
  if (who.email !== undefined) await page.fill("#email", who.email);
  await page.click("button[type=submit]");
  await page.waitForURL(new RegExp(`^${running.appUrl}/issues`));
  await page.waitForSelector("[data-testid=issue-list], [data-testid=issue-count]");
}
