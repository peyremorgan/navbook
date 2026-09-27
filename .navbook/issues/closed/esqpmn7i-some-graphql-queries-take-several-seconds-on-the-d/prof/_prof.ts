/* Profiling harness: seeds a fixture from this repo's .navbook (K copies, ids remapped),
 * starts nav-server in-process with a stub authenticator, and times queries.
 * env: K=copies (default 1) SLOW=ms added to every fetch (0=off) PULL=pull-interval-ms MODE=issue|page|sweep */
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadRepo, makeWsCtx } from "@navbook/core";
import { startServer } from "./src/server.ts";
import { makeFixture } from "./test/helpers/temprepo.ts";

const K = Number(process.env.K ?? 1);
const SLOW = Number(process.env.SLOW ?? 0);
const PULL = Number(process.env.PULL ?? 10000);
const MODE = process.env.MODE ?? "issue";
const SRC = join(process.cwd(), "..", "..", ".navbook");

const fixture = makeFixture();
const dir = fixture.server.dir;
const ALPH = "abcdefghijklmnopqrstuvwxyz0123456789";
const mint = () => Array.from({ length: 8 }, () => ALPH[Math.floor(Math.random() * 36)]).join("");
const idsIn = (root: string): string[] => {
  const out: string[] = [];
  for (const status of ["open", "closed"]) {
    for (const e of readdirSync(join(root, "issues", status), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(e.name.slice(0, 8));
    }
  }
  return out;
};
const rewrite = (root: string, map: Map<string, string>) => {
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) {
        let text = readFileSync(p, "utf8");
        for (const [from, to] of map) text = text.split(from).join(to);
        writeFileSync(p, text);
      }
    }
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const id = e.name.slice(0, 8);
      const to = map.get(id);
      if (to && e.name[8] === "-") renameSync(join(d, e.name), join(d, to + e.name.slice(8)));
    }
  };
  walk(root);
};
const firstId = idsIn(SRC);
// the issue to query: one with subtasks and comments, if any
let target = "";
for (const status of ["open", "closed"]) {
  for (const e of readdirSync(join(SRC, "issues", status))) {
    const f = join(SRC, "issues", status, e, "issue.md");
    try {
      const text = readFileSync(f, "utf8");
      if (/^subtasks:/m.test(text) && statSync(join(SRC, "issues", status, e, "comments")).isDirectory()) { target = e.slice(0, 8); break; }
    } catch {}
  }
  if (target) break;
}
const nav = join(dir, ".navbook");
cpSync(join(SRC, "specs"), join(nav, "specs"), { recursive: true });
for (let k = 0; k < K; k++) {
  const tmp = join(dir, `_copy${k}`);
  cpSync(join(SRC, "issues"), join(tmp, "issues"), { recursive: true });
  const map = new Map(firstId.map((id) => [id, k === 0 ? id : mint()]));
  if (k > 0) rewrite(tmp, map);
  for (const status of ["open", "closed"]) {
    for (const e of readdirSync(join(tmp, "issues", status))) {
      cpSync(join(tmp, "issues", status, e), join(nav, "issues", status, e), { recursive: true });
    }
  }
}
fixture.server.commitAll("seed");
let r = fixture.server.git(["push", "-q", "origin", "main"]);
if (r.code !== 0) throw new Error(r.stderr);
if (SLOW > 0) {
  const slow = join(fixture.home, "slow.sh");
  writeFileSync(slow, `#!/bin/sh\nsleep ${SLOW / 1000}\nexec "$@"\n`, { mode: 0o755 });
  fixture.server.git(["remote", "set-url", "origin", `ext::${slow} %S ${fixture.origin}`]);
  fixture.server.git(["config", "protocol.ext.allow", "always"]);
}
const ws = makeWsCtx({ cwd: dir, env: fixture.env });
const repo = loadRepo(ws);
let files = 0; const count = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? count(join(d, e.name)) : files++; }; count(nav);
console.log(`fixture: ${repo.byId.size} entities, ${files} files, K=${K}, SLOW=${SLOW}ms, PULL=${PULL}ms, target=${target}`);
{ const t = performance.now(); loadRepo(ws); const t2 = performance.now(); loadRepo(ws, { comments: "none" }); console.log(`loadRepo(all)=${(t2 - t).toFixed(0)}ms loadRepo(none)=${(performance.now() - t2).toFixed(0)}ms`); }
{ const t = performance.now(); spawnSync("git", ["fetch", "--quiet", "--prune", "origin"], { cwd: dir, env: fixture.env }); console.log(`git fetch origin=${(performance.now() - t).toFixed(0)}ms`); }
{ const t = performance.now(); spawnSync("git", ["log", "--format=%aE%x00%aN", "HEAD"], { cwd: dir, env: fixture.env }); console.log(`git log authors=${(performance.now() - t).toFixed(0)}ms`); }

const handle = await startServer({
  config: {
    repoPath: dir, port: 0, provider: { issuer: "x", jwksUrl: "http://127.0.0.1:1/" }, audience: "x",
    policy: { requireClaims: [], allowEmailDomains: [], requireEmailVerified: false },
    remote: "origin", pullIntervalMs: PULL, gitTimeoutMs: 30000, graphiql: false,
  },
  env: fixture.env,
  auth: { verify: async () => ({ name: "P", email: "p@example.invalid" }) },
  report: (l) => console.error("server:", l),
});

const ISSUE = readFileSync(join(process.cwd(), "_issue.graphql"), "utf8");
const Q: Record<string, [string, Record<string, unknown>]> = {
  Viewer: ["query Viewer { viewer { name email } }", {}],
  Issue: [ISSUE, { ref: target }],
  Issues: ["query Issues($filter: EntityFilter) { issues(filter: $filter) { id slug kind status path archived title author created labels assignees milestone features resolution rank deadline } }", { filter: {} }],
  Features: ["query Features { features { slug title author created summary specs { path fileName title } issues { id status } prs { id status } } }", {}],
  People: ["query People { people }", {}],
};
async function gql(name: string): Promise<{ name: string; ms: number; ok: boolean; bytes: number }> {
  const [query, variables] = Q[name]!;
  const t = performance.now();
  const res = await fetch(`http://127.0.0.1:${handle.port}/graphql`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer x" },
    body: JSON.stringify({ query, variables, operationName: name }),
  });
  const text = await res.text();
  const body = JSON.parse(text);
  return { name, ms: performance.now() - t, ok: !body.errors, bytes: text.length };
}
const fmt = (x: { name: string; ms: number; ok: boolean; bytes: number }) => `${x.name}=${x.ms.toFixed(0)}ms${x.ok ? "" : "(ERR)"}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (MODE === "issue" || MODE === "sweep") {
  const runs: number[] = [];
  for (let i = 0; i < 8; i++) { const x = await gql("Issue"); runs.push(x.ms); if (i === 0) console.log(`Issue first (pull) bytes=${x.bytes} ok=${x.ok}`); }
  console.log(`Issue sequential: ${runs.map((m) => m.toFixed(0)).join(" ")} ms`);
}
if (MODE === "page" || MODE === "sweep") {
  await sleep(PULL + 50); // make the next read pull again
  const t = performance.now();
  const all = await Promise.all(["Viewer", "Issue", "Issues", "Features", "People"].map(gql));
  console.log(`page load (concurrent, cold pull): total=${(performance.now() - t).toFixed(0)}ms  ${all.map(fmt).join("  ")}`);
  const t2 = performance.now();
  const warm = await Promise.all(["Viewer", "Issue", "Issues", "Features", "People"].map(gql));
  console.log(`page load (concurrent, warm):      total=${(performance.now() - t2).toFixed(0)}ms  ${warm.map(fmt).join("  ")}`);
  for (const name of ["Issues", "Features", "People"]) { const x = await gql(name); console.log(`  alone warm: ${fmt(x)}`); }
}
await handle.close();
fixture.cleanup();
