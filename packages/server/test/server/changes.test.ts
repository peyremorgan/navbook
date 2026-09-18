/**
 * The revision cache: what it sends inline, what it withholds, and how often
 * it asks git.
 *
 * The readers are injected, so each test states the diff it wants git to
 * have produced and counts the calls. What git actually prints is core's
 * business, and core's tests cover it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChangedFile, Diff } from "@navbook/core";
import {
  HARD_FILE_LINES,
  INLINE_FILE_LINES,
  INLINE_LINE_BUDGET,
  MAX_PATHS_PER_REQUEST,
  RevisionCache,
} from "../../src/changes.ts";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

/** A text file whose patch is `lines` lines long. */
function file(path: string, lines: number, extra: Partial<ChangedFile> = {}): ChangedFile {
  const patch =
    lines === 0 ? "" : `${Array.from({ length: lines }, (_, i) => `+${i}`).join("\n")}\n`;
  return {
    path,
    oldPath: null,
    status: "modified",
    additions: lines,
    deletions: 0,
    binary: false,
    patch,
    lines,
    ...extra,
  };
}

function diffOf(files: ChangedFile[]): Diff {
  return {
    base: BASE,
    head: HEAD,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: 0,
  };
}

interface Fake {
  cache: RevisionCache;
  diffCalls: { paths?: readonly string[]; patches?: boolean }[];
  commitCalls: number;
}

function fake(files: ChangedFile[], opts: { fail?: () => Error; navDir?: string } = {}): Fake {
  const state: Fake = { diffCalls: [], commitCalls: 0, cache: null as unknown as RevisionCache };
  state.cache = new RevisionCache({
    repoRoot: "/nowhere",
    ...(opts.navDir === undefined ? {} : { navDir: opts.navDir }),
    exists: async () => true,
    readCommits: async () => {
      state.commitCalls += 1;
      return {
        total: 3,
        commits: ["one", "two", "three"].map((subject, i) => ({
          sha: String(i).repeat(40),
          subject,
          author: "A <a@example.com>",
          date: new Date("2026-08-01T10:00:00Z"),
          message: subject,
        })),
      };
    },
    readDiff: async (_cwd, _base, _head, o = {}) => {
      state.diffCalls.push({ paths: o.paths, patches: o.patches });
      if (opts.fail && o.patches !== false && o.paths === undefined) throw opts.fail();
      const chosen = o.paths === undefined ? files : files.filter((f) => o.paths?.includes(f.path));
      return diffOf(
        o.patches === false
          ? chosen.map((f) => ({ ...f, patch: "", lines: f.additions + f.deletions }))
          : chosen,
      );
    },
  });
  return state;
}

describe("RevisionCache.changesOf", () => {
  it("sends every file, with the patches of the small ones inline", async () => {
    const { cache } = fake([
      file("a.ts", 3),
      file("big.ts", INLINE_FILE_LINES + 1),
      file("b.ts", 2),
      file("pic.bin", 0, { binary: true }),
    ]);
    const view = await cache.changesOf(BASE, HEAD);
    assert.deepEqual(
      view.files.map((f) => [f.path, f.patch === null ? null : f.lines, f.truncated]),
      [
        ["a.ts", 3, false],
        ["big.ts", null, false],
        ["b.ts", 2, false],
        ["pic.bin", null, false],
      ],
    );
    assert.equal(view.additions, 3 + INLINE_FILE_LINES + 1 + 2);
  });

  it("stops sending patches once the budget is spent, and keeps listing", async () => {
    const files = Array.from({ length: 30 }, (_, i) =>
      file(`f${String(i).padStart(2, "0")}.ts`, 500),
    );
    const { cache } = fake(files);
    const view = await cache.changesOf(BASE, HEAD);
    const sent = view.files.filter((f) => f.patch !== null);
    assert.equal(sent.length, INLINE_LINE_BUDGET / 500);
    assert.equal(view.files.length, 30);
    assert.equal(view.files.at(-1)?.patch, null);
  });

  it("answers a file by path whatever its size, cut at the hard limit", async () => {
    const { cache, diffCalls } = fake([file("huge.ts", HARD_FILE_LINES + 5), file("a.ts", 1)]);
    const view = await cache.changesOf(BASE, HEAD, ["huge.ts"]);
    assert.equal(view.files.length, 1);
    const [huge] = view.files;
    assert.equal(huge?.truncated, true);
    assert.equal(huge?.patch?.split("\n").length, HARD_FILE_LINES + 1);
    assert.equal(huge?.lines, HARD_FILE_LINES + 5);
    // Served from the diff already read: one call to git, not two.
    assert.equal(diffCalls.length, 1);
  });

  it("reads git once per pair, however many ask, and however many at once", async () => {
    const { cache, diffCalls } = fake([file("a.ts", 1)]);
    await Promise.all([cache.changesOf(BASE, HEAD), cache.changesOf(BASE, HEAD)]);
    await cache.changesOf(BASE, HEAD, ["a.ts"]);
    assert.equal(diffCalls.length, 1);
  });

  it("falls back to a listing when the patch is more than git may produce", async () => {
    const { cache, diffCalls } = fake([file("a.ts", 4), file("b.ts", 2)], {
      fail: () => new Error("git diff produced more than 268435456 bytes of output"),
    });
    const view = await cache.changesOf(BASE, HEAD);
    assert.deepEqual(
      diffCalls.map((c) => c.patches),
      [undefined, false],
    );
    // Withheld, and known to hold something: what makes the client offer them.
    assert.deepEqual(
      view.files.map((f) => [f.path, f.patch, f.lines]),
      [
        ["a.ts", null, 4],
        ["b.ts", null, 2],
      ],
    );
    // A file asked for by path is then diffed on its own.
    const one = await cache.changesOf(BASE, HEAD, ["b.ts"]);
    assert.deepEqual(diffCalls.at(-1)?.paths, ["b.ts"]);
    assert.equal(one.files[0]?.patch, "+0\n+1\n");
    // A path that is not in the diff reads nothing, least of all the whole diff.
    const before = diffCalls.length;
    assert.deepEqual((await cache.changesOf(BASE, HEAD, ["nope.ts"])).files, []);
    assert.deepEqual((await cache.changesOf(BASE, HEAD, [])).files, []);
    assert.equal(diffCalls.length, before);
  });

  it("caps how many paths one request may name", async () => {
    const { cache } = fake([file("a.ts", 1)]);
    const paths = Array.from({ length: MAX_PATHS_PER_REQUEST + 1 }, (_, i) => `f${i}.ts`);
    await assert.rejects(cache.changesOf(BASE, HEAD, paths), (error: unknown) => {
      assert.equal((error as { extensions?: { code?: string } }).extensions?.code, "INVALID_INPUT");
      return true;
    });
  });

  it("lists the tracker's own files after everything else", async () => {
    const { cache } = fake(
      [file(".navbook/prs/open/x/pr.md", 1), file("src/a.ts", 1), file("zed.ts", 1)],
      { navDir: ".navbook" },
    );
    const view = await cache.changesOf(BASE, HEAD);
    assert.deepEqual(
      view.files.map((f) => f.path),
      ["src/a.ts", "zed.ts", ".navbook/prs/open/x/pr.md"],
    );
  });

  it("refuses a pair the clone does not have, naming the commit", async () => {
    const cache = new RevisionCache({
      repoRoot: "/nowhere",
      exists: async (_cwd, sha) => sha !== HEAD,
    });
    await assert.rejects(cache.changesOf(BASE, HEAD), (error: unknown) => {
      const gql = error as { extensions?: { code?: string; sha?: string } };
      assert.equal(gql.extensions?.code, "MISSING_COMMIT");
      assert.equal(gql.extensions?.sha, HEAD);
      return true;
    });
  });
});

describe("RevisionCache.commitsOf", () => {
  it("walks once per pair and keeps the oldest when limited", async () => {
    const state = fake([]);
    const [first, again] = await Promise.all([
      state.cache.commitsOf(BASE, HEAD, 2),
      state.cache.commitsOf(BASE, HEAD, 10),
    ]);
    assert.equal(first.total, 3);
    assert.deepEqual(
      first.commits.map((c) => c.subject),
      ["one", "two"],
    );
    assert.equal(again.commits.length, 3);
    assert.equal(state.commitCalls, 1);
  });

  it("forgets a walk that failed, so the next asker tries again", async () => {
    let calls = 0;
    const cache = new RevisionCache({
      repoRoot: "/nowhere",
      exists: async () => true,
      readCommits: async () => {
        calls += 1;
        if (calls === 1) throw new Error("git log failed");
        return { total: 0, commits: [] };
      },
    });
    await assert.rejects(cache.commitsOf(BASE, HEAD, 10), /failed/);
    assert.deepEqual(await cache.commitsOf(BASE, HEAD, 10), { total: 0, commits: [] });
    assert.equal(calls, 2);
  });
});
