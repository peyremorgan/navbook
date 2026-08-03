import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allIds, type NavTree, parseTree, statusDir } from "../src/core/tree.ts";

const SHA_A = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
const SHA_B = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";

const issue = (title = "Login times out"): string =>
  `---\ntitle: ${title}\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n`;

const pr = (): string =>
  `---\ntitle: Auth refactor\nauthor: ked@example.com\ncreated: 2026-08-04T16:40:00Z\ntarget: main\nsource: feat/auth\nrevisions:\n  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n---\n\nBody.\n`;

const comment = (): string => "---\nauthor: bob@example.com\n---\n\nReproduced.\n";

const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));

describe("parseTree", () => {
  it("reads the spec's example layout", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-login-timeout/issue.md": issue(),
        "issues/open/bqlybac0-login-timeout/comments/2026-08-03T141207Z-t5kr1gq6.md": comment(),
        "issues/open/bqlybac0-login-timeout/comments/2026-08-04T093012Z-w2rfk8na.md": comment(),
        "issues/closed/mz4kq1rv-crash-on-empty-file/issue.md": issue("Crash"),
        "prs/open/dk3mp2x9-auth-refactor/pr.md": pr(),
        "prs/open/dk3mp2x9-auth-refactor/comments/2026-08-05T101433Z-q8zm3vp1.md": comment(),
      }),
    );
    assert.deepEqual(repo.problems, []);
    assert.deepEqual(repo.issues.map((i) => [i.id, i.status]).sort(), [
      ["bqlybac0", "open"],
      ["mz4kq1rv", "closed"],
    ]);
    assert.deepEqual(
      repo.prs.map((p) => [p.id, p.status]),
      [["dk3mp2x9", "open"]],
    );
    assert.equal(repo.issues.find((i) => i.id === "bqlybac0")?.comments.length, 2);
  });

  it("derives id, slug and paths from the directory name", () => {
    const repo = parseTree(tree({ "issues/open/bqlybac0-login-timeout/issue.md": issue() }));
    const entity = repo.issues[0]!;
    assert.equal(entity.id, "bqlybac0");
    assert.equal(entity.slug, "login-timeout");
    assert.equal(entity.dirPath, "issues/open/bqlybac0-login-timeout");
    assert.equal(entity.filePath, "issues/open/bqlybac0-login-timeout/issue.md");
    assert.equal(entity.title, "Login times out");
  });

  it("keeps comments sorted by filename", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-09T000000Z-ccccccc3.md": comment(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-aaaaaaa1.md": comment(),
        "issues/open/bqlybac0-x/comments/2026-08-05T101433Z-bbbbbbb2.md": comment(),
      }),
    );
    assert.deepEqual(
      repo.issues[0]?.comments.map((c) => c.id),
      ["aaaaaaa1", "bbbbbbb2", "ccccccc3"],
    );
  });

  it("ignores .gitkeep files everywhere", () => {
    const repo = parseTree(
      tree({
        "issues/open/.gitkeep": "",
        "issues/closed/.gitkeep": "",
        "prs/open/.gitkeep": "",
        "prs/merged/.gitkeep": "",
        "prs/closed/.gitkeep": "",
      }),
    );
    assert.deepEqual(repo.problems, []);
    assert.deepEqual(repo.issues, []);
  });

  it("tolerates reserved and unknown top-level names", () => {
    const repo = parseTree(
      tree({ "config.yaml": "x: 1", "sync/github/state.json": "{}", "NOTES.md": "hi" }),
    );
    assert.deepEqual(repo.problems, []);
    assert.deepEqual(repo.reserved.sort(), ["NOTES.md", "config.yaml", "sync/github/state.json"]);
  });

  it("preserves unknown extra files inside an entity directory", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/attachment.png": "binary-ish",
        "issues/open/bqlybac0-x/future/thing.md": "reserved",
      }),
    );
    assert.deepEqual(repo.problems, []);
    assert.deepEqual(repo.issues[0]?.extraFiles, [
      "issues/open/bqlybac0-x/attachment.png",
      "issues/open/bqlybac0-x/future/thing.md",
    ]);
  });

  it("treats the archive subtree as closed while remembering it is archived", () => {
    const repo = parseTree(
      tree({
        "archive/2025/issues/closed/mz4kq1rv-old/issue.md": issue("Old"),
        "archive/2025/prs/merged/dk3mp2x9-old/pr.md": pr(),
      }),
    );
    assert.deepEqual(repo.problems, []);
    assert.equal(repo.issues[0]?.status, "closed");
    assert.equal(repo.issues[0]?.archived, true);
    assert.equal(repo.issues[0]?.archiveYear, "2025");
    assert.equal(repo.prs[0]?.status, "merged");
  });

  it("flags status directories that are not in the allowed set", () => {
    const repo = parseTree(tree({ "issues/wip/bqlybac0-x/issue.md": issue() }));
    assert.equal(repo.problems.length, 1);
    assert.match(repo.problems[0]!.message, /must contain only open\/, closed\//);
  });

  it("flags a merged directory under issues, which is a PR-only status", () => {
    const repo = parseTree(tree({ "issues/merged/bqlybac0-x/issue.md": issue() }));
    assert.match(repo.problems[0]!.message, /must contain only open\/, closed\//);
  });

  it("flags files sitting directly in a status directory", () => {
    const repo = parseTree(tree({ "issues/open/stray.md": issue() }));
    assert.match(repo.problems[0]!.message, /must contain entity directories, not files/);
  });

  it("flags entity directory names that break the grammar", () => {
    const repo = parseTree(tree({ "issues/open/Login-Timeout/issue.md": issue() }));
    assert.match(repo.problems[0]!.message, /does not match <id>-<slug>/);
    assert.deepEqual(repo.issues, []);
  });

  it("flags comment filenames that break the grammar", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/notes.md": comment(),
      }),
    );
    assert.match(repo.problems[0]!.message, /does not match <timestamp>-<id>\.md/);
    assert.equal(repo.issues[0]?.comments.length, 0);
  });

  it("flags an entity directory with no issue.md", () => {
    const repo = parseTree(
      tree({ "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-aaaaaaa1.md": comment() }),
    );
    assert.match(repo.problems[0]!.message, /missing its issue\.md/);
    assert.deepEqual(repo.issues, []);
  });

  it("flags a pull-request directory holding an issue.md", () => {
    const repo = parseTree(tree({ "prs/open/dk3mp2x9-x/issue.md": issue() }));
    assert.match(repo.problems[0]!.message, /missing its pr\.md/);
  });

  it("reports a file whose frontmatter block is missing", () => {
    const repo = parseTree(tree({ "issues/open/bqlybac0-x/issue.md": "no frontmatter here\n" }));
    assert.match(repo.problems[0]!.message, /must start with a '---' frontmatter delimiter/);
  });

  it("collects every ID, entities and comments alike", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md": comment(),
        "prs/open/dk3mp2x9-y/pr.md": pr(),
      }),
    );
    assert.deepEqual(
      allIds(repo)
        .map((entry) => entry.id)
        .sort(),
      ["bqlybac0", "dk3mp2x9", "t5kr1gq6"],
    );
  });

  it("records that comments were deliberately not loaded", () => {
    const repo = parseTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }), {
      commentsLoaded: false,
    });
    assert.equal(repo.commentsLoaded, false);
  });

  it("is insensitive to the order paths arrive in", () => {
    const entries = {
      "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md": comment(),
      "issues/open/bqlybac0-x/issue.md": issue(),
    };
    const forward = parseTree(new Map(Object.entries(entries)));
    const reverse = parseTree(new Map(Object.entries(entries).reverse()));
    assert.equal(forward.issues[0]?.comments.length, reverse.issues[0]?.comments.length);
    assert.deepEqual(forward.problems, reverse.problems);
  });
});

describe("statusDir", () => {
  it("maps kinds to their directory names", () => {
    assert.equal(statusDir("issue", "open"), "issues/open");
    assert.equal(statusDir("pr", "merged"), "prs/merged");
  });
});
