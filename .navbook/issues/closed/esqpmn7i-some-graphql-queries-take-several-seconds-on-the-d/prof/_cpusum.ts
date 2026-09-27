// Summarise a .cpuprofile: self time and inclusive time by function, top N.
import { readFileSync } from "node:fs";
const prof = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const nodes = new Map<number, any>();
for (const n of prof.nodes) nodes.set(n.id, n);
const parent = new Map<number, number>();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map<number, number>();
const dt = prof.timeDeltas; const samples = prof.samples;
for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) ?? 0) + (dt[i] ?? 0));
const key = (n: any) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/packages\//, "").replace(/.*node_modules\//, "nm/")}:${n.callFrame.lineNumber}`;
const bySelf = new Map<string, number>(); const byIncl = new Map<string, number>();
for (const [id, us] of self) {
  const seen = new Set<string>();
  let cur: number | undefined = id;
  bySelf.set(key(nodes.get(id)), (bySelf.get(key(nodes.get(id))) ?? 0) + us);
  while (cur !== undefined) { const k = key(nodes.get(cur)); if (!seen.has(k)) { seen.add(k); byIncl.set(k, (byIncl.get(k) ?? 0) + us); } cur = parent.get(cur); }
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)}ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`).join("\n");
console.log(`total sampled ${(total / 1000).toFixed(0)}ms\n--- self ---\n${top(bySelf, 25)}\n--- inclusive ---\n${top(byIncl, 40)}`);
