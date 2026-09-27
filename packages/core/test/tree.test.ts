import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  allIds,
  type CommentScope,
  type NavTree,
  parseTree,
  statusDir,
  treePeople,
} from "../src/core/tree.ts";
import { readNavTree } from "../src/workspace/workspace.ts";

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

  describe("the marker", () => {
    it("reads the review policy out of it", () => {
      const repo = parseTree(
        tree({ "navbook.json": '{"version": 1, "review": {"minApprovals": 2}}' }),
      );
      assert.deepEqual(repo.reviewPolicy.policy, { selfReview: false, minApprovals: 2 });
      assert.equal(repo.reviewPolicy.declared, true);
    });

    it("does not call it uninterpreted, because it is read", () => {
      const repo = parseTree(tree({ "navbook.json": '{"version": 1}' }));
      assert.deepEqual(repo.reserved, []);
    });

    it("declares nothing for a tree that has none, which stays conforming", () => {
      const repo = parseTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }));
      assert.deepEqual(repo.reviewPolicy, {
        policy: { selfReview: false, minApprovals: 1 },
        declared: false,
        problems: [],
      });
    });

    it("keeps an archived copy of one reserved, since only the live marker is read", () => {
      const repo = parseTree(tree({ "archive/2026/navbook.json": '{"version": 1}' }));
      assert.deepEqual(repo.reserved, ["archive/2026/navbook.json"]);
      assert.equal(repo.reviewPolicy.declared, false);
    });

    it("carries the fault forward rather than throwing on it", () => {
      const repo = parseTree(tree({ "navbook.json": "not json at all" }));
      assert.deepEqual(repo.reviewPolicy.problems, ["is not valid JSON"]);
      assert.deepEqual(repo.problems, [], "which is D15's business, not the walk's");
    });

    it("reads the merge policy out of it too", () => {
      const repo = parseTree(
        tree({ "navbook.json": '{"version": 1, "merge": {"method": "rebase"}}' }),
      );
      assert.deepEqual(repo.mergePolicy.policy, { method: "rebase" });
      assert.equal(repo.mergePolicy.declared, true);
      // Reading one policy says nothing about the other.
      assert.equal(repo.reviewPolicy.declared, false);
    });

    it("declares no merge policy for a tree that has none", () => {
      const repo = parseTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }));
      assert.deepEqual(repo.mergePolicy, {
        policy: { method: "auto" },
        declared: false,
        problems: [],
      });
    });
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

  it("records whose comments were deliberately not loaded", () => {
    const files = tree({ "issues/open/bqlybac0-x/issue.md": issue() });
    assert.equal(parseTree(files, { commentsLoaded: "none" }).commentsLoaded, "none");
    assert.equal(parseTree(files, { commentsLoaded: "prs" }).commentsLoaded, "prs");
    assert.equal(parseTree(files).commentsLoaded, "all");
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

describe("readNavTree comment scope", () => {
  const root = mkdtempSync(join(tmpdir(), "navbook-scope-"));
  const write = (rel: string, text: string): void => {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  };
  write("issues/open/bqlybac0-x/issue.md", "---\n---\n\nb\n");
  write("issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md", "---\n---\n\nc\n");
  write("prs/open/dk3mp2x9-y/pr.md", "---\n---\n\nb\n");
  write("prs/open/dk3mp2x9-y/comments/2026-08-03T141207Z-q8zm3vp1.md", "---\n---\n\nc\n");

  const paths = (comments: CommentScope): string[] =>
    [...readNavTree(root, { comments }).keys()].filter((p) => p.includes("comments/")).sort();

  it("reads every comment by default", () => {
    assert.equal(paths("all").length, 2);
  });

  it("reads none when asked for none", () => {
    assert.deepEqual(paths("none"), []);
  });

  it("reads a pull request's comments without opening an issue's", () => {
    // What a pull-request listing needs to derive a review state, without
    // paying for the issue comments beside it (spec 05 §5.2's budget).
    assert.deepEqual(paths("prs"), ["prs/open/dk3mp2x9-y/comments/2026-08-03T141207Z-q8zm3vp1.md"]);
  });
});

describe("treePeople", () => {
  const people = (entries: Record<string, string>): string[] =>
    treePeople(parseTree(tree(entries))).map((person) =>
      person.name ? `${person.name} <${person.email}>` : person.email,
    );

  it("names everybody an entity's frontmatter does", () => {
    assert.deepEqual(
      people({
        "issues/open/bqlybac0-login-timeout/issue.md":
          "---\ntitle: Login times out\nauthor: Alice <alice@example.com>\n" +
          "created: 2026-08-02T09:14:00Z\nassignee: [ked@example.com, Bob <bob@example.com>]\n---\n\nBody.\n",
        "issues/open/bqlybac0-login-timeout/comments/2026-08-03T141207Z-t5kr1gq6.md":
          "---\nauthor: Carol <carol@example.com>\n---\n\nReproduced.\n",
      }),
      [
        "Alice <alice@example.com>",
        "ked@example.com",
        "Bob <bob@example.com>",
        "Carol <carol@example.com>",
      ],
    );
  });

  it("names the reviewers asked and the person who merged it", () => {
    assert.deepEqual(
      people({
        "prs/merged/dk3mp2x9-auth-refactor/pr.md":
          `---\ntitle: Auth refactor\nauthor: ked@example.com\ncreated: 2026-08-04T16:40:00Z\n` +
          `target: main\nsource: feat/auth\nreviewer: Rae <rae@example.com>\n` +
          `revisions:\n  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n` +
          `merged:\n  date: 2026-08-06T10:00:00Z\n  by: Mia <mia@example.com>\n---\n\nBody.\n`,
      }),
      ["ked@example.com", "Rae <rae@example.com>", "Mia <mia@example.com>"],
    );
  });

  it("names a feature's author", () => {
    assert.deepEqual(
      people({
        "specs/auth/feature.md":
          "---\ntitle: Auth\nauthor: Fay <fay@example.com>\ncreated: 2026-08-01T09:00:00Z\n---\n\nBody.\n",
      }),
      ["Fay <fay@example.com>"],
    );
  });

  it("skips what is not a person, rather than reporting it", () => {
    assert.deepEqual(
      people({
        "issues/open/bqlybac0-login-timeout/issue.md":
          "---\ntitle: Login times out\nauthor: not-an-address\n" +
          'created: 2026-08-02T09:14:00Z\nassignee: [alice@example.com, 42, ""]\n' +
          "merged:\n  by: 7\n---\n\nBody.\n",
      }),
      ["alice@example.com"],
    );
  });

  it("says each person once, however many times the tree names them", () => {
    assert.deepEqual(
      people({
        "issues/open/bqlybac0-login-timeout/issue.md":
          "---\ntitle: Login times out\nauthor: alice@example.com\n" +
          "created: 2026-08-02T09:14:00Z\n---\n\nBody.\n",
        "issues/open/bqlybac0-login-timeout/comments/2026-08-03T141207Z-t5kr1gq6.md":
          "---\nauthor: Alice <ALICE@example.com>\n---\n\nReproduced.\n",
        "issues/closed/mz4kq1rv-crash-on-empty-file/issue.md":
          "---\ntitle: Crash\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n",
      }),
      // Bare first, so the comment's spelling is what names them.
      ["Alice <alice@example.com>"],
    );
  });

  it("is empty for a tree with nobody in it", () => {
    assert.deepEqual(people({}), []);
  });
});
