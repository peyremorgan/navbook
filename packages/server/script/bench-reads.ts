/**
 * Time the reads an issue page makes, against a tree as large as you like.
 *
 *   node script/bench-reads.ts
 *   K=50 SLOW=1900 RUNS=7 node script/bench-reads.ts
 *
 * Opening an issue sends five queries at once — Viewer, Issue, Issues,
 * Features and People. The documents sent here are the web client's own,
 * imported from its generated module, so what is timed is what a browser asks.
 *
 * The repository is this checkout's `.navbook/` copied K times (default 16)
 * with fresh ids, committed to a fixture with a bare origin. K=16 is about the
 * deployed tracker's 2 100 files (#esqpmn7i). SLOW adds that many milliseconds
 * to every fetch, by reaching the origin through an `ext::` transport that
 * sleeps first; 1900 makes a fetch take about the 2.3 s production's takes.
 *
 * Two servers are started on the clone, one after the other:
 *
 * - warm: a pull interval of an hour, so nothing fetches after the first
 *   request. What it measures is the tree work alone.
 * - idle: a pull interval of PULL ms (default 2000), each sample taken after
 *   that long without a request — the first page somebody opens after a quiet
 *   spell, which is the one that pays for a fetch.
 *
 * Every figure is the median of RUNS samples (default 5), with the slowest in
 * brackets. A query's time runs from the request leaving to the whole response
 * arriving, so on a page load it includes waiting behind the other four.
 */

import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRepo, makeWsCtx } from "@navbook/core";
import { print } from "graphql";
import * as documents from "../../web/src/generated/gql/graphql.ts";
import { type ServerHandle, startServer } from "../src/server.ts";
import { makeFixture } from "../test/helpers/temprepo.ts";

const K = Number(process.env.K ?? 16);
const SLOW = Number(process.env.SLOW ?? 0);
const PULL = Number(process.env.PULL ?? 2000);
const RUNS = Number(process.env.RUNS ?? 5);
const VERBOSE = Boolean(process.env.VERBOSE);
const SOURCE = join(import.meta.dirname, "..", "..", "..", ".navbook");

// --- the fixture ------------------------------------------------------------

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const mint = () =>
  Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * 36)]).join("");

function issueIds(root: string): string[] {
  const ids: string[] = [];
  for (const status of ["open", "closed"]) {
    for (const entry of readdirSync(join(root, "issues", status), { withFileTypes: true })) {
      if (entry.isDirectory()) ids.push(entry.name.slice(0, 8));
    }
  }
  return ids;
}

/** Replace every id in `map` throughout a copied tree, in text and in directory names. */
function remap(dir: string, map: Map<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) remap(path, map);
    else if (entry.name.endsWith(".md")) {
      let text = readFileSync(path, "utf8");
      for (const [from, to] of map) text = text.split(from).join(to);
      writeFileSync(path, text);
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const to = map.get(entry.name.slice(0, 8));
    if (entry.isDirectory() && to && entry.name[8] === "-") {
      renameSync(join(dir, entry.name), join(dir, to + entry.name.slice(8)));
    }
  }
}

/** An issue with both subtasks and comments, so the Issue query does all its work. */
function pickTarget(): string {
  for (const status of ["open", "closed"]) {
    for (const name of readdirSync(join(SOURCE, "issues", status))) {
      const dir = join(SOURCE, "issues", status, name);
      try {
        const text = readFileSync(join(dir, "issue.md"), "utf8");
        if (/^subtasks:/m.test(text) && statSync(join(dir, "comments")).isDirectory()) {
          return name.slice(0, 8);
        }
      } catch {}
    }
  }
  throw new Error(`no issue in ${SOURCE} has both subtasks and comments`);
}

const fixture = makeFixture();
const dir = fixture.server.dir;
const nav = join(dir, ".navbook");
const target = pickTarget();
const ids = issueIds(SOURCE);
cpSync(join(SOURCE, "specs"), join(nav, "specs"), { recursive: true });
for (let k = 0; k < K; k++) {
  const copy = join(fixture.home, `copy${k}`);
  cpSync(join(SOURCE, "issues"), copy, { recursive: true });
  if (k > 0) remap(copy, new Map(ids.map((id) => [id, mint()])));
  cpSync(copy, join(nav, "issues"), { recursive: true });
}
fixture.server.commitAll("seed");
const pushed = fixture.server.git(["push", "-q", "origin", "main"]);
if (pushed.code !== 0) throw new Error(pushed.stderr);
if (SLOW > 0) {
  const slow = join(fixture.home, "slow.sh");
  writeFileSync(slow, `#!/bin/sh\nsleep ${SLOW / 1000}\nexec "$@"\n`, { mode: 0o755 });
  fixture.server.git(["remote", "set-url", "origin", `ext::${slow} %S ${fixture.origin}`]);
  fixture.server.git(["config", "protocol.ext.allow", "always"]);
}

// --- measuring --------------------------------------------------------------

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const cell = (xs: number[]) => `${median(xs).toFixed(0)} (${Math.max(...xs).toFixed(0)})`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function time(body: () => void): number {
  const start = performance.now();
  body();
  return performance.now() - start;
}

const PAGE = {
  Viewer: [documents.ViewerDocument, {}],
  Issue: [documents.IssueDocument, { ref: target }],
  Issues: [documents.IssuesDocument, { filter: {} }],
  Features: [documents.FeaturesDocument, {}],
  People: [documents.PeopleDocument, {}],
} as const;
type Name = keyof typeof PAGE;
const NAMES = Object.keys(PAGE) as Name[];
const TEXT = Object.fromEntries(NAMES.map((name) => [name, print(PAGE[name][0])]));

async function query(server: ServerHandle, name: Name): Promise<number> {
  const start = performance.now();
  const response = await fetch(`http://127.0.0.1:${server.port}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer bench" },
    body: JSON.stringify({ query: TEXT[name], variables: PAGE[name][1], operationName: name }),
  });
  const body = (await response.json()) as { errors?: unknown[] };
  const ms = performance.now() - start;
  // A figure for a request that failed would be a figure for the wrong work.
  if (body.errors) throw new Error(`${name} failed: ${JSON.stringify(body.errors)}`);
  return ms;
}

/** The five queries at once, as the page sends them. */
async function page(server: ServerHandle): Promise<Record<Name | "page", number>> {
  const start = performance.now();
  const each = await Promise.all(NAMES.map((name) => query(server, name)));
  return {
    ...(Object.fromEntries(NAMES.map((name, i) => [name, each[i]])) as Record<Name, number>),
    page: performance.now() - start,
  };
}

function start(pullIntervalMs: number): Promise<ServerHandle> {
  return startServer({
    config: {
      repoPath: dir,
      port: 0,
      provider: { issuer: "bench", jwksUrl: "http://127.0.0.1:1/" },
      audience: "bench",
      policy: { requireClaims: [], allowEmailDomains: [], requireEmailVerified: false },
      remote: "origin",
      pullIntervalMs,
      gitTimeoutMs: 60_000,
      graphiql: false,
    },
    env: fixture.env,
    auth: { verify: async () => ({ name: "Bench", email: "bench@example.invalid" }) },
    report: (line) => {
      if (VERBOSE) console.error(`server: ${line}`);
    },
  });
}

type Row = Record<Name | "page", number[]>;
const emptyRow = (): Row =>
  Object.fromEntries([...NAMES, "page"].map((name) => [name, [] as number[]])) as Row;
const record = (row: Row, sample: Record<Name | "page", number>) => {
  for (const name of [...NAMES, "page"] as const) row[name].push(sample[name]);
};

try {
  const ws = makeWsCtx({ cwd: dir, env: fixture.env });
  const entities = loadRepo(ws).byId.size;
  let files = 0;
  const count = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) count(join(d, e.name));
      else files++;
    }
  };
  count(nav);
  const loadAll: number[] = [];
  const loadNone: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    loadAll.push(time(() => loadRepo(ws)));
    loadNone.push(time(() => loadRepo(ws, { comments: "none" })));
  }
  const fetchMs = time(() =>
    spawnSync("git", ["fetch", "--quiet", "origin"], { cwd: dir, env: fixture.env }),
  );

  const alone = emptyRow();
  const warm = emptyRow();
  const warmServer = await start(3_600_000);
  try {
    await page(warmServer); // pays the one fetch, and warms the JIT
    for (const name of NAMES) {
      for (let i = 0; i < RUNS; i++) alone[name].push(await query(warmServer, name));
    }
    for (let i = 0; i < RUNS; i++) record(warm, await page(warmServer));
  } finally {
    await warmServer.close();
  }

  const idle = emptyRow();
  const idleServer = await start(PULL);
  try {
    await page(idleServer);
    for (let i = 0; i < RUNS; i++) {
      await sleep(PULL + 50);
      record(idle, await page(idleServer));
    }
  } finally {
    await idleServer.close();
  }

  const pad = (s: string, n: number) => s.padStart(n);
  const line = (label: string, row: Partial<Row>) =>
    label.padEnd(18) +
    [...NAMES, "page" as const]
      .map((name) => pad(row[name]?.length ? cell(row[name]) : "—", 14))
      .join("");
  console.log(`tree      ${entities} entities, ${files} files (K=${K}), Issue #${target}`);
  console.log(`loadRepo  all ${cell(loadAll)} ms, without comments ${cell(loadNone)} ms`);
  console.log(`fetch     ${fetchMs.toFixed(0)} ms (SLOW=${SLOW}), pull interval ${PULL} ms`);
  console.log(`runs      ${RUNS}; median (slowest), ms\n`);
  console.log("".padEnd(18) + [...NAMES, "page"].map((name) => pad(name, 14)).join(""));
  console.log(line("alone, warm", alone));
  console.log(line("page, warm", warm));
  console.log(line("page, after idle", idle));
} finally {
  fixture.cleanup();
}
