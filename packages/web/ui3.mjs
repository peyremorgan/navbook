import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[err]", m.text());
});
const step = (s) => console.log("\n### " + s);

await page.goto("http://localhost:3000/prs");
await page.waitForSelector("#email", { timeout: 20000 });
await page.click("button[type=submit]");
await page.waitForTimeout(3000);

step("PR list, working tree only");
await page.goto("http://localhost:3000/prs");
await page.waitForSelector("[data-testid=pr-list], [data-testid=pr-count]", { timeout: 20000 });
console.log(await page.locator("[data-testid=pr-list]").innerText());
console.log("count:", await page.locator("[data-testid=pr-count]").innerText());

step("toggle every fetched branch");
await page.click("[data-testid=all-refs]");
await page.waitForTimeout(3000);
console.log("url:", page.url());
console.log(await page.locator("[data-testid=pr-list]").innerText());

step("served PR detail + review");
await page.goto("http://localhost:3000/prs/bbbb0001");
await page.waitForSelector("[data-testid=pr-detail]", { timeout: 20000 });
await page.waitForTimeout(800);
console.log("revisions:", await page.locator("[data-testid=revisions]").innerText());
console.log(
  "thread:",
  (await page.locator("[data-testid=pr-comment-thread]").innerText()).slice(0, 600),
);

step("record an approval bound to a revision");
await page.fill("[data-testid=review-body]", "Looks right to me.");
await page.getByRole("radio", { name: "Approve", exact: true }).check();
await page.waitForTimeout(300);
await page.click("[data-testid=review-submit]");
await page.waitForTimeout(3500);
console.log("thread now has approvals:", await page.locator("text=Approved").count());

step("unserved PR: comment must be refused, naming the branch");
await page.goto("http://localhost:3000/prs/bbbb0002");
await page.waitForSelector("[data-testid=pr-detail]", { timeout: 20000 });
await page.waitForTimeout(800);
console.log("title:", await page.locator("[data-testid=pr-title]").innerText());
console.log("refs:", await page.locator("[data-testid=pr-ref]").allInnerTexts());
await page.fill("[data-testid=review-body]", "Can I comment here?");
await page.click("[data-testid=review-submit]");
await page.waitForTimeout(3000);
const alert = await page.locator("[data-testid=unserved-branch]").count();
console.log("refusal shown:", alert > 0);
if (alert) console.log(await page.locator("[data-testid=unserved-branch]").innerText());
console.log(
  "submit disabled after refusal:",
  await page.locator("[data-testid=review-submit]").isDisabled(),
);
await browser.close();
