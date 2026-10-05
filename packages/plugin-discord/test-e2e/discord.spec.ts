/**
 * The Discord bridge's layer, against a stack of its own with a Discord on
 * 127.0.0.1: linking an account from the page `/nav link` sends somebody to,
 * and the way from a record's row and page to its thread.
 *
 * Its own stack, because the bridge needs a token and settings the shared
 * fixture does not declare; serial, because the tests share that stack.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { ownStack, signIn } from "../../web/test-e2e/helpers/fixtures.ts";
import type { Stack } from "../../web/test-e2e/helpers/stack.ts";
import { GUILD, type StubDiscord, startStubDiscord, TEXT } from "../test/helpers/stub-discord.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALICE = { id: "111111111111111111", username: "alice", global_name: "Alice" };
const PERSON = { name: "Dana Discord", email: "dana@example.com" };
const LINKED = { id: "222222222222222222", username: "dana", global_name: "Dana" };

let stack: Stack;
let stub: StubDiscord;

const test = base.extend({});
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  stub = await startStubDiscord();
  stack = await ownStack({
    pluginPaths: [PLUGIN],
    env: { NAV_SERVER_DISCORD_TOKEN: "t0ken", NAV_SERVER_DISCORD_API_URL: stub.url },
    prepare: (repo) => {
      const path = join(repo.dir, ".navbook", "navbook.json");
      const marker = JSON.parse(readFileSync(path, "utf8"));
      marker.plugins = {
        ...marker.plugins,
        "@navbook/plugin-discord": {
          guild: GUILD,
          url: "https://tracker.example",
          issues: [{ channel: TEXT, on: ["assign"] }],
          people: { [LINKED.id]: PERSON.email },
        },
      };
      writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
      const git = (...args: string[]) => {
        const result = spawnSync("git", args, { cwd: repo.dir, env: repo.env, encoding: "utf8" });
        if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
      };
      git("commit", "--quiet", "-am", "chore: declare the Discord bridge");
      git("push", "--quiet", "origin", repo.branch);
    },
  });
  await until(
    () => stub.connected() && stub.commands !== null,
    () => stack.serverErrors(),
  );
});

test.afterAll(async () => {
  await stack.stop();
  await stub.close();
});

/** Ask until `probe` holds, or fail saying what was seen. */
async function until(probe: () => boolean, what: () => string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`never happened:\n${what()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** `/nav <sub>` typed by `user`, and what the bridge finally answered. */
async function slash(
  user: typeof ALICE,
  sub: string,
  options: Record<string, string> = {},
): Promise<string> {
  const interaction = stub.interact({
    type: 2,
    member: { user },
    data: {
      type: 1,
      name: "nav",
      options: [
        {
          type: 1,
          name: sub,
          options: Object.entries(options).map(([name, value]) => ({ type: 3, name, value })),
        },
      ],
    },
  });
  const [first] = await stub.answers(interaction.id);
  if (first?.type === 5) {
    const [, edited] = await stub.answers(interaction.id, 2);
    return (edited?.data as { content?: string } | undefined)?.content ?? "";
  }
  return (first?.data as { content?: string } | undefined)?.content ?? "";
}

async function codeFor(user: typeof ALICE): Promise<string> {
  const offered = await slash(user, "link");
  const code = /discord\/link\?code=([A-Z0-9]{8})/.exec(offered)?.[1];
  if (code === undefined) throw new Error(`no code in: ${offered}`);
  return code;
}

test("links the account that asked for a code, once, and unlinks it", async ({ page }) => {
  const code = await codeFor(ALICE);
  await signIn(page, stack, { name: "Alice Smith", email: "alice@example.com" });
  await page.goto(`${stack.appUrl}/discord/link?code=${code}`);
  // Opening the page links nothing: it asks.
  await expect(page.getByTestId("discord-link-confirm")).toBeVisible();
  await expect(page.getByText("alice@example.com")).toBeVisible();
  await page.getByTestId("discord-link-confirm").click();
  await expect(page.getByTestId("discord-linked")).toContainText(
    "Linked Alice to alice@example.com",
  );

  // A code works once.
  await page.goto(`${stack.appUrl}/discord/link?code=${code}`);
  await page.getByTestId("discord-link-confirm").click();
  await expect(page.getByTestId("discord-link-error")).toContainText("unknown or has expired");

  // Without a code, the link there is, and the way to undo it.
  await page.goto(`${stack.appUrl}/discord/link`);
  await expect(page.getByTestId("discord-current-link")).toContainText("Alice");
  await page.getByTestId("discord-unlink").click();
  await expect(page.getByTestId("discord-no-link")).toBeVisible();
});

test("keeps the code through signing in", async ({ page }) => {
  const code = await codeFor(ALICE);
  await page.goto(`${stack.appUrl}/discord/link?code=${code}`);
  await page.waitForSelector("#email");
  await page.fill("#name", "Alice Smith");
  await page.fill("#email", "alice@example.com");
  await page.click("button[type=submit]");
  await page.waitForURL(`${stack.appUrl}/discord/link?code=${code}`);
  await expect(page.getByTestId("discord-link-confirm")).toBeVisible();
});

test("leads from a record's row and page to its thread", async ({ page }) => {
  await signIn(page, stack, PERSON);
  // The fixture's issues are older than the bridge, so none has a thread
  // until somebody asks for one.
  await until(
    () => stack.serverErrors().includes("following"),
    () => stack.serverErrors(),
  );
  const answered = await slash(LINKED, "thread", { id: "aaaa0001" });
  const thread = /<#(\d+)>/.exec(answered)?.[1];
  expect(answered, answered).toMatch(/^Started a thread for #aaaa0001/);
  const url = `https://discord.com/channels/${GUILD}/${thread}`;

  await page.goto(`${stack.appUrl}/issues`);
  const badge = page.getByTestId("issue-discord");
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveAttribute("href", url);

  await page.goto(`${stack.appUrl}/issues/aaaa0001`);
  await expect(page.getByTestId("open-in-discord")).toHaveAttribute("href", url);

  // A record without a thread shows neither.
  await page.goto(`${stack.appUrl}/issues/aaaa0002`);
  await expect(page.getByTestId("issue-title")).toBeVisible();
  await expect(page.getByTestId("open-in-discord")).toHaveCount(0);
});
