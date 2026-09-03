/**
 * What happens when the token runs out.
 *
 * Access tokens are short by design and the client renews them from a refresh
 * token. Nothing else exercises that: with an hour-long token every other spec
 * finishes on the one it was given, so a broken renewal would first be noticed
 * an hour into somebody's afternoon, as an app that had quietly stopped
 * working. This spec runs a stack whose tokens last seconds.
 *
 * It has its own stack for that reason, and stops it itself.
 */

import { test as base, expect } from "@playwright/test";
import { ownStack, signIn } from "./helpers/fixtures.ts";
import type { Stack } from "./helpers/stack.ts";

/** Shorter than the 30 seconds `useAuth` renews ahead of expiry, so the very
 * first request after signing in already has to renew. */
const LIFETIME_SECONDS = 35;

let stack: Stack;

const test = base.extend({});

test.beforeAll(async () => {
  stack = await ownStack({ tokenLifetimeSeconds: LIFETIME_SECONDS });
});

test.afterAll(async () => {
  await stack.stop();
});

test("renews an expiring token instead of signing the person out", async ({ page }) => {
  await signIn(page, stack);
  await expect(page.getByTestId("issue-list")).toBeVisible();

  // Past the point where the stored token is no longer worth presenting.
  await page.waitForTimeout(8000);

  // A read, and then a write: both have to go out with a token, and the one
  // in hand is now inside the renewal margin.
  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(page.getByTestId("issue-title")).toContainText("Sign-in is unreliable");

  await page.getByTestId("comment-body").fill("Written with a renewed token.");
  await page.getByTestId("comment-submit").click();
  await expect(page.getByTestId("comment-thread")).toContainText("Written with a renewed token.");

  // Renewed, not re-authenticated: nobody was sent back to the provider, and
  // the identity is the same one the token started with.
  expect(page.url()).not.toContain("/authorize");
  await expect(page.getByRole("banner")).toContainText("A Person");
});
