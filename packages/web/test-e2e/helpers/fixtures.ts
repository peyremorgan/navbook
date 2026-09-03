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
import { type Stack, startStack } from "./stack.ts";

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
