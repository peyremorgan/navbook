/**
 * The assistant in the browser: the button, the slideover, a streamed reply,
 * and a write that waits for the person.
 *
 * Its own stack, with this plugin on the server's path and a stub model in
 * this process for it to call. The shared stack is the other case: a server
 * without the plugin, where the button must simply not be there.
 */

import { test as base, expect } from "@playwright/test";
import { ownStack, test as shared, signIn, toasts } from "../../web/test-e2e/helpers/fixtures.ts";
import type { Stack } from "../../web/test-e2e/helpers/stack.ts";
import { PLUGIN } from "../test/helpers/nav.ts";
import { type StubLlm, startStubLlm } from "../test/helpers/stub-llm.ts";

shared("offers nothing when the server has no assistant", async ({ signedIn, stack }) => {
  await signedIn.goto(`${stack.appUrl}/issues`);
  await expect(signedIn.getByTestId("issue-list")).toBeVisible();
  // Given a moment to have appeared, if it were going to.
  await signedIn.waitForTimeout(500);
  await expect(signedIn.getByTestId("chat-launcher")).toHaveCount(0);
});

let stack: Stack;
let stub: StubLlm;

const test = base.extend({});
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  stub = await startStubLlm();
  stack = await ownStack({
    pluginPaths: [PLUGIN],
    env: { NAV_SERVER_CHAT_BASE_URL: stub.url, NAV_SERVER_CHAT_MODEL: "stub-model" },
  });
});

test.afterAll(async () => {
  await stack.stop();
  await stub.close();
});

test.beforeEach(async ({ page }) => {
  stub.script(null);
  await signIn(page, stack);
});

/** Open the panel and say something. */
async function ask(page: import("@playwright/test").Page, text: string): Promise<void> {
  if (!(await page.getByTestId("chat-panel").isVisible()))
    await page.getByTestId("chat-launcher").click();
  await page.getByTestId("chat-prompt").locator("textarea").fill(text);
  await page.getByTestId("chat-prompt").locator("textarea").press("Enter");
}

test("opens from a button on every page, and says who it is", async ({ page }) => {
  await expect(page.getByTestId("chat-launcher")).toBeVisible();
  await page.goto(`${stack.appUrl}/prs`);
  await page.getByTestId("chat-launcher").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("stub-model");
  await expect(page.getByTestId("chat-empty")).toContainText("What is assigned to me?");
});

test("streams a Markdown reply, with a line for each tool it used", async ({ page }) => {
  stub.enqueue(
    { toolCalls: [{ name: "list_issues", arguments: { query: ["assignee:me"] } }] },
    { text: "You have **one**: #aaaa0001." },
  );
  await ask(page, "what is assigned to me?");
  const reply = page.getByTestId("chat-assistant").last();
  await expect(reply.locator("strong")).toHaveText("one");
  await expect(reply.getByRole("link", { name: "#aaaa0001" })).toBeVisible();
  await expect(page.getByTestId("chat-tool-done")).toContainText("Listed issues");
  await expect(page.getByTestId("chat-user")).toContainText("what is assigned to me?");
  // The server was asked as the person signed in.
  expect(stub.requests.at(-2)?.body.messages[0]?.content).toContain(
    "A Person <person@example.invalid>",
  );
});

test("waits for approval before filing, then files it and says so", async ({ page }) => {
  const title = `Filed from the assistant ${Date.now()}`;
  stub.enqueue(
    { toolCalls: [{ name: "open_issue", arguments: { title, body: "Written **over chat**." } }] },
    { text: "Filed it." },
  );
  await ask(page, "file an issue");
  const card = page.getByTestId("chat-approval");
  await expect(card).toContainText(`Open an issue titled “${title}”`);
  await expect(card.locator("strong")).toHaveText("over chat");
  // Nothing written yet: the listing does not have it.
  await page.getByTestId("chat-approve").click();
  await expect(toasts(page)).toContainText("docs(issue): open #");
  await expect(page.getByTestId("chat-approval")).toHaveCount(0);
  await expect(page.getByTestId("chat-record")).toBeVisible();
  await expect(page.getByTestId("chat-assistant").last()).toContainText("Filed it.");
  // The listing behind the panel was refreshed with it.
  await page.keyboard.press("Escape");
  await expect(page.getByText(title)).toBeVisible();
});

test("changes nothing when the person declines", async ({ page }) => {
  stub.enqueue(
    { toolCalls: [{ name: "close_issue", arguments: { ref: "aaaa0001" } }] },
    { text: "Left it open." },
  );
  await ask(page, "close aaaa0001");
  await page.getByTestId("chat-decline").click();
  await expect(page.getByTestId("chat-tool-declined")).toContainText("declined");
  await expect(page.getByTestId("chat-assistant").last()).toContainText("Left it open.");
  await expect(toasts(page)).not.toContainText("docs(issue): close");
  const told = stub.requests.at(-1)?.body.messages.at(-1)?.content ?? "";
  expect(told).toContain("Do not retry it");
});

test("waits for every change to be decided, saying which are", async ({ page }) => {
  const said = `Two at once ${Date.now()}`;
  stub.enqueue(
    {
      toolCalls: [
        { id: "one", name: "comment", arguments: { kind: "issue", ref: "aaaa0001", body: said } },
        { id: "two", name: "close_issue", arguments: { ref: "aaaa0001" } },
      ],
    },
    { text: "Commented; left it open." },
  );
  await ask(page, "comment on and close aaaa0001");
  await expect(page.getByTestId("chat-approval")).toHaveCount(2);
  await page.getByTestId("chat-approve").first().click();
  await expect(page.getByTestId("chat-decided")).toContainText(
    "Approved — waiting for the other changes",
  );
  await page.getByTestId("chat-decline").click();
  await expect(toasts(page)).toContainText("docs(issue): comment on #aaaa0001");
  await expect(page.getByTestId("chat-tool-declined")).toBeVisible();
  await expect(page.getByTestId("chat-assistant").last()).toContainText("Commented; left it open.");
});

test("writes without asking under Allow all", async ({ page }) => {
  stub.enqueue(
    {
      toolCalls: [
        {
          name: "comment",
          arguments: { kind: "issue", ref: "aaaa0001", body: "Noted by the assistant." },
        },
      ],
    },
    { text: "Commented." },
  );
  await page.getByTestId("chat-launcher").click();
  await page.getByTestId("chat-mode").click();
  await page.getByRole("option", { name: "Allow all" }).click();
  await ask(page, "comment on aaaa0001");
  await expect(toasts(page)).toContainText("docs(issue): comment on #aaaa0001");
  await expect(page.getByTestId("chat-approval")).toHaveCount(0);
});

test("says what failed, and starts afresh on request", async ({ page }) => {
  stub.enqueue({ status: 500, body: { error: { message: "the model is overloaded" } } });
  await ask(page, "hello?");
  await expect(page.getByTestId("chat-error")).toContainText("the model is overloaded");
  await page.getByTestId("chat-reset").click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
});

test("is not on the pages outside the app", async ({ page }) => {
  await page.goto(`${stack.appUrl}/signed-out`);
  await expect(page.getByTestId("chat-launcher")).toHaveCount(0);
});
