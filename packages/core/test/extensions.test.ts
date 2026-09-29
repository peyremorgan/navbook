/**
 * What a plugin registers, exercised through the pure functions that consume
 * it — spec 02 §2.12.
 *
 * The extension here is synthetic on purpose. `@navbook/plugin-kb` will
 * exercise these seams for real, but a suite that tested them through the one
 * plugin that is grandfathered would be testing the exception; this one claims
 * an ordinary `rep` namespace and nothing it does is special-cased anywhere.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  type CoreExtensions,
  commentScopeFor,
  ExtensionConflictError,
  git,
  listEntities,
  makeWsCtx,
  matchesQuery,
  mergeExtensions,
  type NavTree,
  NO_EXTENSIONS,
  needsComments,
  newIssueFile,
  parseQuery,
  parseTree,
  type Repo,
  readStringOrList,
  type StructuralProblem,
  validateRepo,
} from "../src/index.ts";

/* ------------------------------------------------------------ the extension */

/** What `rep/` parses into: one entry per file, keyed by name. */
interface ReportModel {
  reports: string[];
}

const reportsLocation = {
  dir: "rep",
  build(files: NavTree, paths: readonly string[]) {
    const reports: string[] = [];
    const problems: StructuralProblem[] = [];
    for (const path of paths) {
      const name = path.slice("rep/".length);
      if (!name.endsWith(".json")) {
        problems.push({ path, message: `'rep/' holds .json reports; '${name}' is not one` });
        continue;
      }
      if ((files.get(path) ?? "").trim() === "") {
        problems.push({ path, message: `'${name}' is empty` });
        continue;
      }
      reports.push(name);
    }
    return { model: { reports } satisfies ReportModel, problems };
  },
};

const extensions = (parts: Partial<CoreExtensions>[] = []): CoreExtensions =>
  mergeExtensions([
    {
      treeLocations: [reportsLocation],
      frontmatterKeys: [
        {
          key: "rep-build",
          kinds: ["issue", "pr"],
          shape: "string",
          validate: (value) =>
            typeof value === "string"
              ? []
              : [{ key: "rep-build", message: "'rep-build' must be a string" }],
        },
        { key: "rep-tag", kinds: ["issue"], shape: "string-or-list" },
      ],
      queryKeys: [
        {
          key: "rep",
          kinds: ["issue", "pr"],
          matches: (values, entity) => {
            const tags = readStringOrList(entity.fm, "rep-tag");
            return values.every((wanted) => tags.includes(wanted));
          },
        },
      ],
      doctorChecks: [
        {
          id: "X-rep-1",
          level: "error",
          run: (repo: Repo) =>
            (repo.extProblems.get("rep") ?? []).map((problem) => ({
              check: "X-rep-1",
              level: "error" as const,
              path: problem.path,
              message: problem.message,
            })),
        },
      ],
      commitScopes: ["report"],
    },
    ...parts,
  ]);

/* ----------------------------------------------------------------- fixtures */

const ISSUE = [
  "---",
  "title: Login times out",
  "author: alice@example.com",
  "created: 2026-08-02T09:14:00Z",
  "rep-build: 4711",
  "rep-tag: [flaky, slow]",
  "---",
  "",
  "Aborts after 5 s.",
  "",
].join("\n");

const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));

const base = {
  "issues/open/ab12cd34-login/issue.md": ISSUE,
};

/* -------------------------------------------------------------------- tests */

describe("tree locations", () => {
  it("routes a registered directory to the plugin and keeps its model", () => {
    const repo = parseTree(tree({ ...base, "rep/4711.json": "{}" }), { ext: extensions() });
    assert.deepEqual((repo.ext.get("rep") as ReportModel).reports, ["4711.json"]);
    // Routed, so not also reported as an uninterpreted path.
    assert.deepEqual(repo.reserved, []);
    assert.deepEqual(repo.problems, []);
  });

  it("builds an empty model when the directory is absent", () => {
    // An empty `rep/` and no `rep/` are different states, and only a plugin
    // that was asked either way can tell them apart.
    const repo = parseTree(tree(base), { ext: extensions() });
    assert.deepEqual((repo.ext.get("rep") as ReportModel).reports, []);
  });

  it("keeps the location's faults for the plugin to report", () => {
    const repo = parseTree(tree({ ...base, "rep/notes.txt": "hi", "rep/empty.json": "  " }), {
      ext: extensions(),
    });
    assert.equal(repo.extProblems.get("rep")?.length, 2);
    // Not core's problems: `doctor` reports them under the plugin's own check.
    assert.deepEqual(repo.problems, []);
  });

  it("leaves the directory reserved when no plugin claims it", () => {
    const repo = parseTree(tree({ ...base, "rep/4711.json": "{}" }));
    assert.deepEqual(repo.reserved, ["rep/4711.json"]);
    assert.equal(repo.ext.size, 0);
  });

  it("does not read an archived copy of a claimed directory", () => {
    // The rule `specs/` follows: an archived copy is not a shape anything
    // defines, so it stays preserved rather than read as live data.
    const repo = parseTree(tree({ ...base, "archive/2025/rep/old.json": "{}" }), {
      ext: extensions(),
    });
    assert.deepEqual((repo.ext.get("rep") as ReportModel).reports, []);
    assert.deepEqual(repo.reserved, ["archive/2025/rep/old.json"]);
  });

  it("does not claim a file that merely starts with the directory's name", () => {
    const repo = parseTree(tree({ ...base, "reports.md": "x" }), { ext: extensions() });
    assert.deepEqual((repo.ext.get("rep") as ReportModel).reports, []);
    assert.deepEqual(repo.reserved, ["reports.md"]);
  });
});

describe("frontmatter keys", () => {
  it("coerces a declared key to its shape", () => {
    // YAML reads `4711` as a number; the plugin declared it a string, and a
    // plugin comparing it to one would otherwise never match.
    const repo = parseTree(tree(base), { ext: extensions() });
    const issue = repo.issues[0];
    assert.equal(issue?.fm["rep-build"], "4711");
    assert.deepEqual(issue?.fm["rep-tag"], ["flaky", "slow"]);
  });

  it("leaves a declared key raw when no extension is registered", () => {
    const repo = parseTree(tree(base));
    assert.equal(repo.issues[0]?.fm["rep-build"], 4711);
  });

  it("accepts the scalar spelling of a string-or-list key", () => {
    const one = ISSUE.replace("rep-tag: [flaky, slow]", "rep-tag: flaky");
    const repo = parseTree(tree({ "issues/open/ab12cd34-login/issue.md": one }), {
      ext: extensions(),
    });
    assert.equal(repo.issues[0]?.fm["rep-tag"], "flaky");
    assert.deepEqual(readStringOrList(repo.issues[0]?.fm ?? {}, "rep-tag"), ["flaky"]);
  });

  it("runs a declared validator and reports under D2", () => {
    const bad = ISSUE.replace("rep-build: 4711", "rep-build: [1, 2]");
    const found = validateRepo(
      parseTree(tree({ "issues/open/ab12cd34-login/issue.md": bad }), { ext: extensions() }),
      { ext: extensions() },
    );
    const d2 = found.filter((d) => d.check === "D2");
    assert.equal(d2.length, 1);
    assert.match(d2[0]?.message ?? "", /'rep-build' must be a string/);
  });

  it("does not run a validator for a key the entity does not carry", () => {
    // A plugin's key is optional by construction: a tree written before the
    // plugin existed has none, and requiring one would make installing a
    // plugin retroactively invalidate the repository.
    const without = ISSUE.replace("rep-build: 4711\n", "").replace("rep-tag: [flaky, slow]\n", "");
    const found = validateRepo(
      parseTree(tree({ "issues/open/ab12cd34-login/issue.md": without }), { ext: extensions() }),
      { ext: extensions() },
    );
    assert.deepEqual(found, []);
  });

  it("does not run an issue validator against a pull request", () => {
    const ext = extensions();
    const def = ext.frontmatterKeys.find((k) => k.key === "rep-tag");
    assert.deepEqual(def?.kinds, ["issue"]);
  });
});

describe("query keys", () => {
  const ext = extensions();

  it("parses a registered term", () => {
    const query = parseQuery(["rep:flaky"], "issue", ext);
    assert.ok(!("message" in query));
    assert.deepEqual(query.ext.rep, ["flaky"]);
  });

  it("treats the same term as free text without the extension", () => {
    const query = parseQuery(["rep:flaky"], "issue");
    assert.ok(!("message" in query));
    assert.deepEqual(query.text, ["rep:flaky"]);
    assert.deepEqual(Object.keys(query.ext), []);
  });

  it("matches an entity carrying the value", () => {
    const repo = parseTree(tree(base), { ext });
    const entity = repo.issues[0];
    assert.ok(entity);
    const hit = parseQuery(["rep:flaky"], "issue", ext);
    const miss = parseQuery(["rep:green"], "issue", ext);
    assert.ok(!("message" in hit) && !("message" in miss));
    assert.equal(matchesQuery(hit, entity, undefined, ext), true);
    assert.equal(matchesQuery(miss, entity, undefined, ext), false);
  });

  it("ANDs repeated values the way the definition says", () => {
    const repo = parseTree(tree(base), { ext });
    const entity = repo.issues[0];
    assert.ok(entity);
    const both = parseQuery(["rep:flaky", "rep:slow"], "issue", ext);
    const one = parseQuery(["rep:flaky", "rep:green"], "issue", ext);
    assert.ok(!("message" in both) && !("message" in one));
    assert.equal(matchesQuery(both, entity, undefined, ext), true);
    assert.equal(matchesQuery(one, entity, undefined, ext), false);
  });

  it("matches nothing when the query outlives the extension that parsed it", () => {
    // Nothing can be concluded, and matching nothing is the answer that does
    // not invent members.
    const repo = parseTree(tree(base), { ext });
    const entity = repo.issues[0];
    assert.ok(entity);
    const query = parseQuery(["rep:flaky"], "issue", ext);
    assert.ok(!("message" in query));
    assert.equal(matchesQuery(query, entity, undefined, NO_EXTENSIONS), false);
  });

  it("refuses a term given no value", () => {
    const query = parseQuery(["rep:"], "issue", ext);
    assert.ok("message" in query);
    assert.match(query.message, /missing a value/);
  });

  it("refuses a term on the wrong kind", () => {
    const narrow = mergeExtensions([
      { queryKeys: [{ key: "only", kinds: ["pr"], matches: () => true }] },
    ]);
    const query = parseQuery(["only:x"], "issue", narrow);
    assert.ok("message" in query);
    assert.match(query.message, /does not describe an issue/);
  });

  it("reports what a definition's parse refuses", () => {
    const strict = mergeExtensions([
      {
        queryKeys: [
          {
            key: "num",
            kinds: ["issue"],
            parse: (value) =>
              /^\d+$/.test(value) ? value : { message: `'num:' takes a number, not '${value}'` },
            matches: () => true,
          },
        ],
      },
    ]);
    const bad = parseQuery(["num:soon"], "issue", strict);
    assert.ok("message" in bad);
    assert.match(bad.message, /takes a number/);
    assert.ok(!("message" in parseQuery(["num:12"], "issue", strict)));
  });

  it("asks for comments only when a term present needs them", () => {
    const chatty = mergeExtensions([
      { queryKeys: [{ key: "said", kinds: ["issue"], needsComments: true, matches: () => true }] },
    ]);
    const without = parseQuery(["rep:flaky"], "issue", ext);
    const with_ = parseQuery(["said:x"], "issue", chatty);
    assert.ok(!("message" in without) && !("message" in with_));
    assert.equal(needsComments(without, ext), false);
    assert.equal(needsComments(with_, chatty), true);
  });

  it("makes a listing read the comments such a term needs, and only then", () => {
    const chatty = mergeExtensions([
      { queryKeys: [{ key: "said", kinds: ["issue"], needsComments: true, matches: () => true }] },
    ]);
    const said = parseQuery(["said:x"], "issue", chatty);
    const plain = parseQuery(["label:bug"], "issue", chatty);
    assert.ok(!("message" in said) && !("message" in plain));
    assert.equal(commentScopeFor(said, "issue", chatty), "all");
    assert.equal(commentScopeFor(plain, "issue", chatty), "none");
    // A pull-request listing reads its own comments whatever it is asked.
    assert.equal(commentScopeFor(plain, "pr", chatty), "prs");
  });

  it("finds an entity by what a comment says, through a term that reads comments", () => {
    // End to end over a tree on disk: the listing must load the comments the
    // term matches against, or it answers from a tree that has none.
    const dir = mkdtempSync(join(tmpdir(), "navbook-said-"));
    try {
      git(["init", "--quiet", "-b", "main"], { cwd: dir });
      const write = (rel: string, text: string): void => {
        const abs = join(dir, ".navbook", ...rel.split("/"));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, "utf8");
      };
      write("navbook.json", '{"version": 1}\n');
      const issue = (title: string) =>
        `---\ntitle: ${title}\nauthor: a@example.com\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n`;
      write("issues/open/bqlybac0-x/issue.md", issue("Discussed"));
      write(
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md",
        "---\nauthor: b@example.com\n---\n\nSeen it flaky on CI.\n",
      );
      write("issues/open/e9v8jyz3-y/issue.md", issue("Quiet"));
      const said = mergeExtensions([
        {
          queryKeys: [
            {
              key: "said",
              kinds: ["issue"],
              needsComments: true,
              matches: (values, entity) =>
                values.every((value) => entity.comments.some((c) => c.body.includes(value))),
            },
          ],
        },
      ]);
      const ws = makeWsCtx({ cwd: dir, env: {}, ext: said });
      const query = parseQuery(["said:flaky"], "issue", said);
      assert.ok(!("message" in query));
      const found = listEntities(ws, "issue", query).map((entity) => entity.id);
      assert.deepEqual(found, ["bqlybac0"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctor checks", () => {
  it("runs a registered check and reports its diagnostics", () => {
    const ext = extensions();
    const repo = parseTree(tree({ ...base, "rep/notes.txt": "hi" }), { ext });
    const found = validateRepo(repo, { ext });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.check, "X-rep-1");
    assert.equal(found[0]?.level, "error");
    assert.match(found[0]?.message ?? "", /is not one/);
  });

  it("sorts plugin checks after every check this format defines", () => {
    const ext = extensions();
    // A tree with both a D1 fault (a file directly in a status directory) and
    // a plugin fault.
    const repo = parseTree(tree({ ...base, "issues/open/loose.md": "x", "rep/notes.txt": "hi" }), {
      ext,
    });
    const codes = validateRepo(repo, { ext }).map((d) => d.check);
    assert.deepEqual(codes, ["D1", "X-rep-1"]);
  });

  it("reports a check that throws rather than failing the run", () => {
    // `doctor` is what somebody runs when they already suspect something is
    // wrong; producing no report at all is the least useful thing it could do.
    const broken = mergeExtensions([
      {
        doctorChecks: [
          {
            id: "X-bad-1",
            level: "error",
            run: () => {
              throw new Error("boom");
            },
          },
        ],
      },
    ]);
    const found = validateRepo(parseTree(tree(base), { ext: broken }), { ext: broken });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.check, "X-bad-1");
    assert.match(found[0]?.message ?? "", /check X-bad-1 failed: boom/);
  });

  it("reports a malformed plugins declaration as D15", () => {
    const repo = parseTree(
      tree({ ...base, "navbook.json": JSON.stringify({ version: 1, plugins: [] }) }),
    );
    const found = validateRepo(repo);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.check, "D15");
    assert.match(found[0]?.message ?? "", /'plugins' must be an object/);
  });

  it("says a marker is not JSON once, not once per key that could not be read", () => {
    const repo = parseTree(tree({ ...base, "navbook.json": "{oh dear" }));
    const found = validateRepo(repo);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.message, "is not valid JSON");
  });
});

describe("mergeExtensions", () => {
  it("merges disjoint registrations", () => {
    const merged = mergeExtensions([
      { commitScopes: ["a"], queryKeys: [{ key: "x", kinds: ["issue"], matches: () => true }] },
      { commitScopes: ["b"], queryKeys: [{ key: "y", kinds: ["pr"], matches: () => true }] },
    ]);
    assert.deepEqual(merged.commitScopes, ["a", "b"]);
    assert.deepEqual(
      merged.queryKeys.map((k) => k.key),
      ["x", "y"],
    );
  });

  it("is the empty set for no parts", () => {
    const merged = mergeExtensions([]);
    assert.deepEqual(merged.queryKeys, []);
    assert.deepEqual(merged.treeLocations, []);
  });

  it("refuses two plugins claiming one directory", () => {
    assert.throws(
      () =>
        mergeExtensions([
          { treeLocations: [reportsLocation] },
          { treeLocations: [{ ...reportsLocation }] },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionConflictError);
        assert.match(error.message, /two plugins claim the 'rep\/' directory/);
        return true;
      },
    );
  });

  it("refuses two plugins claiming one query term, key or check", () => {
    const clash = (part: Partial<CoreExtensions>): void => {
      assert.throws(() => mergeExtensions([part, part]), ExtensionConflictError);
    };
    clash({ queryKeys: [{ key: "x", kinds: ["issue"], matches: () => true }] });
    clash({ frontmatterKeys: [{ key: "x-y", kinds: ["issue"], shape: "string" }] });
    clash({ doctorChecks: [{ id: "X-a-1", level: "error", run: () => [] }] });
  });

  it("refuses a name the format already means something by", () => {
    // The built-in reading runs first, so such a claim would be shadowed and
    // the plugin's own code run on the format's data.
    const refused = (part: Partial<CoreExtensions>, pattern: RegExp): void => {
      assert.throws(
        () => mergeExtensions([part]),
        (error: unknown) => error instanceof ExtensionConflictError && pattern.test(error.message),
      );
    };
    for (const dir of ["issues", "prs", "archive", "../x", "a/b", ".hidden", ""]) {
      refused({ treeLocations: [{ ...reportsLocation, dir }] }, /not a directory a plugin may/);
    }
    for (const key of ["status", "title", "labels", "__proto__", "Bad Key"]) {
      refused(
        { frontmatterKeys: [{ key, kinds: ["issue"], shape: "string" }] },
        /not a frontmatter key/,
      );
    }
    for (const key of ["label", "status", "constructor ", "__proto__"]) {
      refused({ queryKeys: [{ key, kinds: ["issue"], matches: () => true }] }, /not a query term/);
    }
    refused({ doctorChecks: [{ id: "D1", level: "error", run: () => [] }] }, /not a check id/);
    // The one grandfathered pair of §2.12 stays claimable, with its checks.
    mergeExtensions([
      { treeLocations: [{ ...reportsLocation, dir: "specs" }] },
      { frontmatterKeys: [{ key: "feature", kinds: ["issue"], shape: "string" }] },
      { doctorChecks: [{ id: "D13", level: "error", run: () => [] }] },
    ]);
  });

  it("reports a registry that is not a list, rather than throwing a TypeError", () => {
    assert.throws(
      () =>
        mergeExtensions([
          { treeLocations: { dir: "kb" } as unknown as CoreExtensions["treeLocations"] },
        ]),
      (error: unknown) =>
        error instanceof ExtensionConflictError &&
        /'treeLocations' was registered as something other than a list/.test(error.message),
    );
  });

  it("keeps plugin terms where an Object member cannot answer for one", () => {
    // `constructor` is refused as a registration above; the terms themselves
    // sit in an object with no prototype, so no key can reach `Object`'s own.
    const query = parseQuery(["constructor:x"], "issue");
    assert.ok(!("message" in query));
    assert.equal(Object.getPrototypeOf(query.ext), null);
    assert.equal(query.ext.constructor, undefined);
  });

  it("does not repeat a commit scope two plugins both declare", () => {
    // Two plugins may legitimately commit under one scope; it is a label on a
    // message, not a namespace either of them owns.
    const merged = mergeExtensions([{ commitScopes: ["report"] }, { commitScopes: ["report"] }]);
    assert.deepEqual(merged.commitScopes, ["report"]);
  });
});

describe("composing a file", () => {
  it("writes plugin keys after the ones this format defines", () => {
    const text = newIssueFile({
      title: "Login times out",
      author: "alice@example.com",
      created: "2026-08-02T09:14:00Z",
      body: "Aborts after 5 s.",
      milestone: "v1",
      ext: { "rep-build": "4711", "rep-tag": ["flaky", "slow"] },
    });
    const keys = [...text.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ["title", "author", "created", "milestone", "rep-build", "rep-tag"]);
    // Quoted, because the value is a string that reads as a number: writing
    // it bare would hand the plugin back the 4711 it did not ask for.
    assert.match(text, /^rep-build: "4711"$/m);
    assert.match(text, /^rep-tag: \[flaky, slow\]$/m);
  });

  it("round-trips a plugin's string value as a string", () => {
    const text = newIssueFile({
      title: "T",
      author: "a@example.com",
      created: "2026-08-02T09:14:00Z",
      body: "B",
      ext: { "rep-build": "4711" },
    });
    const repo = parseTree(new Map([["issues/open/ab12cd34-t/issue.md", text]]), {
      ext: extensions(),
    });
    assert.equal(repo.issues[0]?.fm["rep-build"], "4711");
  });

  it("writes a single plugin value as a scalar", () => {
    const text = newIssueFile({
      title: "T",
      author: "a@example.com",
      created: "2026-08-02T09:14:00Z",
      body: "B",
      ext: { "rep-tag": ["flaky"] },
    });
    assert.match(text, /^rep-tag: flaky$/m);
  });

  it("composes exactly as before when no plugin contributes", () => {
    const input = {
      title: "T",
      author: "a@example.com",
      created: "2026-08-02T09:14:00Z",
      body: "B",
    };
    assert.equal(newIssueFile({ ...input, ext: {} }), newIssueFile(input));
  });
});
