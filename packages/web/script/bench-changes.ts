/**
 * Time the Changes tab of a pull request against a repository of your choosing.
 *
 *   node script/bench-changes.ts <repo> <pr-id> [runs]
 *   PROFILE=1 node script/bench-changes.ts <repo> <pr-id>
 *
 * The fixture repository's pull requests are a file apiece, which says nothing
 * about a diff of five thousand lines. This runs the built bundle (build it
 * first) against any repository that holds a Navbook tree and a pull request
 * whose revision pins the two commits to compare — a clone of a large project
 * with a hand-written `pr.md` on a branch is enough — and reports, per run,
 * when the `PrChanges` request left and returned, how many bytes it was, and
 * when the summary line and every row of every file were painted, all
 * measured from the click on the tab in the page's own clock.
 *
 * The stack the end-to-end suite uses supplies the issuer and serves the
 * bundle; a second `nav-server` is started on the given repository, and the
 * browser's `config.json` is answered with that server's address instead of
 * the fixture's. The repository is served as it stands: it must have a clean
 * tree, and a remote it cannot reach should be removed first, or every read
 * will wait on a fetch.
 *
 * With `PROFILE` set, one warm run is taken under the CPU profiler and the
 * functions with the most self time are printed, which is how the cost of a
 * component per file header was found.
 */

// The measuring runs in the page, so this one file needs the browser's types.
/// <reference lib="dom" />

import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import { PACKAGE_ROOT, startStack } from "../test-e2e/helpers/stack.ts";

const [repo, prId, runsArg] = process.argv.slice(2);
if (!repo || !prId) throw new Error("usage: bench-changes.ts <repo> <pr-id> [runs]");
const runs = Number(runsArg ?? 3);
const AUDIENCE = "navbook";

const stack = await startStack();
const server = spawn(
  process.execPath,
  [
    `${PACKAGE_ROOT}/../server/src/main.ts`,
    "--repo",
    repo,
    "--port",
    "0",
    "--oidc-discovery-url",
    `${stack.issuer.issuer}/.well-known/openid-configuration`,
    "--oidc-audience",
    AUDIENCE,
    "--no-graphiql",
  ],
  { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
);
let errors = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk: string) => {
  errors += chunk;
});
const apiPort = await new Promise<number>((done, fail) => {
  let out = "";
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => {
    out += chunk;
    const match = /listening on http:\/\/localhost:(\d+)/.exec(out);
    if (match) done(Number(match[1]));
  });
  server.once("exit", (code) => fail(new Error(`nav-server exited with ${code}:\n${errors}`)));
});
const apiUrl = `http://localhost:${apiPort}/graphql`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route("**/config.json", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      graphqlUrl: apiUrl,
      oidc: {
        discoveryUrl: `${stack.issuer.issuer}/.well-known/openid-configuration`,
        clientId: "navbook-web",
        audience: AUDIENCE,
      },
    }),
  }),
);
const page = await context.newPage();

// The e2e sign-in helper waits for an issue list, which a repository with no
// issues never shows; this waits for the page's heading instead.
await page.goto(`${stack.appUrl}/issues`);
await page.waitForSelector("#email");
await page.fill("#name", "Bench");
await page.fill("#email", "bench@example.com");
await page.click("button[type=submit]");
await page.waitForURL(new RegExp(`^${stack.appUrl}/issues`));
await page.getByRole("heading", { name: "Issues" }).waitFor();

interface Run {
  /** Milliseconds after the click, all of them. */
  request: number;
  response: number;
  bytes: number;
  summary: number;
  allRows: number;
  rows: number;
  files: number;
}

async function measure(page: Page): Promise<Run> {
  await page.goto(`${stack.appUrl}/prs/${prId}`);
  await page.getByTestId("pr-detail").waitFor();
  await page.waitForTimeout(300);

  let requestAt = 0;
  let responseAt = 0;
  let bytes = 0;
  const isChanges = (postData: string | null): boolean => (postData ?? "").includes("PrChanges");
  const onRequest = (r: { url(): string; postData(): string | null }): void => {
    if (r.url() === apiUrl && isChanges(r.postData())) requestAt = Date.now();
  };
  const onResponse = async (r: {
    url(): string;
    request(): { postData(): string | null };
    body(): Promise<Buffer>;
  }): Promise<void> => {
    if (r.url() === apiUrl && isChanges(r.request().postData())) {
      responseAt = Date.now();
      bytes = (await r.body()).length;
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  const result = await page.evaluate(async () => {
    const t0 = performance.now();
    const epoch = Date.now() - t0;
    (document.querySelector("[data-testid=pr-tab-changes]") as HTMLElement).click();

    // Resolves two frames after the condition holds: the DOM is there, and
    // the paint after it has happened.
    const painted = (test: () => boolean): Promise<number> =>
      new Promise((done) => {
        const tick = (): void => {
          if (test()) {
            requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now())));
          } else requestAnimationFrame(tick);
        };
        tick();
      });
    const countRows = (): number =>
      document.querySelectorAll("[data-testid^=diff-file-] tbody tr").length;
    const countFiles = (): number => document.querySelectorAll("[data-testid^=diff-file-]").length;

    const summary = await painted(
      () => document.querySelector("[data-testid=changes-summary]") !== null,
    );
    // Files below the fold are rendered in idle batches: wait until a whole
    // second passes with no new row, then take the last time a row arrived.
    let rows = countRows();
    let allRows = summary;
    let quietSince = performance.now();
    while (performance.now() - quietSince < 1_000) {
      await new Promise((r) => requestAnimationFrame(r));
      const n = countRows();
      if (n !== rows) {
        rows = n;
        allRows = performance.now();
        quietSince = allRows;
      }
    }
    return {
      t0: epoch + t0,
      summary: summary - t0,
      allRows: allRows - t0,
      rows,
      files: countFiles(),
    };
  });
  page.off("request", onRequest);
  page.off("response", onResponse);
  return {
    request: requestAt - result.t0,
    response: responseAt - result.t0,
    bytes,
    summary: result.summary,
    allRows: result.allRows,
    rows: result.rows,
    files: result.files,
  };
}

if (process.env.PROFILE) {
  await measure(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await page.goto(`${stack.appUrl}/prs/${prId}`);
  await page.getByTestId("pr-detail").waitFor();
  await page.waitForTimeout(300);
  await cdp.send("Profiler.start");
  await page.getByTestId("pr-tab-changes").click();
  await page.getByTestId("changes-summary").waitFor();
  await page.waitForTimeout(400);
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<string, number>();
  let total = 0;
  (profile.samples ?? []).forEach((id, i) => {
    const ms = (profile.timeDeltas?.[i] ?? 0) / 1000;
    total += ms;
    const frame = byId.get(id)?.callFrame;
    if (!frame) return;
    const key = `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\//, "")}:${frame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + ms);
  });
  console.log(`profile: ${total.toFixed(0)}ms sampled; self time by function:`);
  for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`${ms.toFixed(1).padStart(8)}ms  ${key}`);
  }
}

const results: Run[] = [];
for (let i = 0; i < runs; i += 1) results.push(await measure(page));
console.table(
  results.map((run) => ({
    ...run,
    summary: Math.round(run.summary),
    allRows: Math.round(run.allRows),
  })),
);
const median = (key: keyof Run): number => {
  const sorted = results.map((run) => run[key]).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
console.log(
  `median: request at ${median("request")}ms, response at ${median("response")}ms (${median("bytes")} bytes), ` +
    `summary painted at ${median("summary").toFixed(0)}ms, ` +
    `every row painted at ${median("allRows").toFixed(0)}ms (${median("rows")} rows in ${median("files")} files)`,
);

await browser.close();
server.kill("SIGTERM");
await stack.stop();
