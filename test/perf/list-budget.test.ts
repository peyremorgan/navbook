/**
 * The performance budget of spec 05 §5.2: a cold `nav issue list` on a
 * 1000-issue repository must finish in under 500 ms on commodity hardware.
 *
 * The budget applies to the artifact users run — the compiled `dist/` build
 * that `package.json` points its `bin` at. Running the TypeScript sources
 * directly adds roughly 150 ms of type stripping per invocation, so the suite
 * measures and reports either way but only holds the strict budget when it is
 * pointed at a build via `NAV_BIN`, as the release CI job does.
 *
 * The loose limit is what actually fails, so a busy shared runner reports
 * rather than blocks — while a genuine regression (a heavy new import, a
 * per-entity subprocess) still trips it.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeNavRepo, type TempRepo } from "../helpers/temprepo.ts";

const ISSUE_COUNT = 1000;
export const BUDGET_MS = 500;
/** Where the test actually fails, leaving room for a busy shared runner. */
const HARD_LIMIT_MS = BUDGET_MS * 4;
/** True when measuring compiled JavaScript rather than the TypeScript sources. */
const MEASURING_A_BUILD = (process.env.NAV_BIN ?? "").includes("dist");

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministic, valid, collision-free IDs — no randomness in a benchmark. */
function syntheticId(index: number): string {
  let rest = "";
  let value = index;
  for (let i = 0; i < 6; i++) {
    rest = (ALPHABET[value % ALPHABET.length] as string) + rest;
    value = Math.floor(value / ALPHABET.length);
  }
  return `a${rest}1`;
}

function seedIssues(repo: TempRepo, count: number): void {
  const labels = ["bug", "auth", "docs", "perf", "ui"];
  for (let i = 0; i < count; i++) {
    const id = syntheticId(i);
    const dir = join(repo.dir, ".navbook/issues/open", `${id}-synthetic-issue-${i}`);
    mkdirSync(join(dir, "comments"), { recursive: true });
    writeFileSync(
      join(dir, "issue.md"),
      `---\ntitle: Synthetic issue ${i}\nauthor: dev${i % 7}@example.com\ncreated: 2026-08-0${(i % 9) + 1}T09:14:00Z\nlabels: [${labels[i % labels.length]}]\n---\n\nBody of synthetic issue ${i}.\nA second line so the file is not trivially small.\n`,
      "utf8",
    );
    // Two comments each: 3000 files in total, which is where a naive
    // implementation that always reads every comment starts to hurt.
    for (const [n, cid] of [`${id}c1`.slice(-8), `${id}c2`.slice(-8)].entries()) {
      writeFileSync(
        join(dir, "comments", `2026-08-0${(i % 9) + 1}T1${n}0000Z-${cid}.md`),
        `---\nauthor: dev${(i + n) % 7}@example.com\n---\n\nComment ${n} on issue ${i}.\n`,
        "utf8",
      );
    }
  }
}

function timed(run: () => { code: number; stdout: string; stderr: string }): {
  ms: number;
  stdout: string;
} {
  const start = process.hrtime.bigint();
  const result = run();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result.code, 0, result.stderr);
  return { ms, stdout: result.stdout };
}

describe(`nav issue list on ${ISSUE_COUNT} issues`, { timeout: 300_000 }, () => {
  it(`stays within the ${BUDGET_MS} ms budget`, () => {
    const repo = makeNavRepo();
    try {
      seedIssues(repo, ISSUE_COUNT);
      repo.commitAll("chore: seed a large tracker");

      const plain = timed(() => repo.nav(["issue", "list"]));
      const filtered = timed(() => repo.nav(["issue", "list", "label:perf"]));
      const searched = timed(() => repo.nav(["issue", "list", "synthetic issue 42"]));

      assert.equal(plain.stdout.split("\n").length, ISSUE_COUNT + 2, "every issue is listed");

      const report = [
        `list (${ISSUE_COUNT} issues, 2 comments each): ${plain.ms.toFixed(0)} ms`,
        `list label:perf (no comments read): ${filtered.ms.toFixed(0)} ms`,
        `list "free text" (all comments read): ${searched.ms.toFixed(0)} ms`,
        `budget ${BUDGET_MS} ms; measuring ${MEASURING_A_BUILD ? "the dist build" : "TypeScript sources"}`,
      ].join("\n  ");
      console.log(`  ${report}`);

      if (MEASURING_A_BUILD) {
        assert.ok(
          plain.ms < BUDGET_MS,
          `cold list took ${plain.ms.toFixed(0)} ms, over the ${BUDGET_MS} ms budget of spec 05 §5.2`,
        );
      }
      assert.ok(
        plain.ms < HARD_LIMIT_MS,
        `cold list took ${plain.ms.toFixed(0)} ms, far beyond the ${BUDGET_MS} ms budget`,
      );
      assert.ok(
        searched.ms < HARD_LIMIT_MS * 2,
        `full-text list took ${searched.ms.toFixed(0)} ms`,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("skips comment files when the query cannot need them", () => {
    const repo = makeNavRepo();
    try {
      seedIssues(repo, 200);
      repo.commitAll("chore: seed");
      const metadataOnly = timed(() => repo.nav(["issue", "list", "label:perf"]));
      const fullText = timed(() => repo.nav(["issue", "list", "second line"]));
      console.log(
        `  metadata-only ${metadataOnly.ms.toFixed(0)} ms vs full-text ${fullText.ms.toFixed(0)} ms`,
      );
      assert.ok(metadataOnly.ms <= fullText.ms + 50, "lazy comment loading should not be slower");
    } finally {
      repo.cleanup();
    }
  });
});
