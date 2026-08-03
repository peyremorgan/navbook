import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NavTree } from "../src/core/tree.ts";
import {
  type Check,
  checkRevisionsAppendOnly,
  checkTimestampSkew,
  hasErrors,
  validateTree,
} from "../src/core/validate.ts";

const SHA_A = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
const SHA_B = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";
const SHA_C = "0011223344556677889900aabbccddeeff001122";

const issue = (title = "A title", extra = "", body = "Body."): string =>
  `---\ntitle: ${title}\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\n${extra}---\n\n${body}\n`;

const pr = (heads: string[] = [SHA_A]): string =>
  `---\ntitle: Auth\nauthor: ked@example.com\ncreated: 2026-08-04T16:40:00Z\ntarget: main\nsource: feat/auth\nrevisions:\n${heads
    .map((head) => `  - head: ${head}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n`)
    .join("")}---\n\nBody.\n`;

const comment = (extra = "", body = "Reproduced."): string =>
  `---\nauthor: bob@example.com\n${extra}---\n\n${body}\n`;

const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));
const codes = (entries: Record<string, string>, opts = {}): Check[] =>
  validateTree(tree(entries), opts).map((d) => d.check);

describe("a conforming tree", () => {
  it("produces no diagnostics", () => {
    assert.deepEqual(
      codes({
        "issues/open/.gitkeep": "",
        "issues/closed/.gitkeep": "",
        "prs/open/.gitkeep": "",
        "prs/merged/.gitkeep": "",
        "prs/closed/.gitkeep": "",
        "issues/open/bqlybac0-login-timeout/issue.md": issue(),
        "issues/open/bqlybac0-login-timeout/comments/2026-08-03T141207Z-t5kr1gq6.md": comment(),
        "prs/open/dk3mp2x9-auth/pr.md": pr(),
        "prs/open/dk3mp2x9-auth/comments/2026-08-05T101433Z-q8zm3vp1.md": comment(
          `verdict: approve\nrevision: ${SHA_A}\n`,
          "LGTM",
        ),
      }),
      [],
    );
  });

  it("accepts unusual but legal hand edits", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(
          "A title",
          "unknown-key: {deep: [1, 2]}\nmilestone: v1\n",
        ),
        "issues/open/bqlybac0-x/notes-for-later.txt": "not a navbook file",
        "archive/2024/issues/closed/mz4kq1rv-old/issue.md": issue("Old"),
        "config.yaml": "future: true",
        "sync/github/state.json": "{}",
      }),
      [],
    );
  });
});

describe("D1 names and layout", () => {
  it("flags a bad entity directory name", () => {
    assert.deepEqual(codes({ "issues/open/Bad_Name/issue.md": issue() }), ["D1"]);
  });

  it("flags a bad comment filename", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/notes.md": comment(),
      }),
      ["D1"],
    );
  });

  it("flags an unexpected status directory", () => {
    assert.deepEqual(codes({ "issues/triage/bqlybac0-x/issue.md": issue() }), ["D1"]);
  });

  it("flags a missing issue.md", () => {
    assert.deepEqual(
      codes({ "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md": comment() }),
      ["D1"],
    );
  });
});

describe("D2 frontmatter", () => {
  it("flags a missing required key", () => {
    assert.deepEqual(codes({ "issues/open/bqlybac0-x/issue.md": "---\ntitle: t\n---\n\nbody\n" }), [
      "D2",
      "D2",
    ]);
  });

  it("flags an empty description", () => {
    assert.deepEqual(codes({ "issues/open/bqlybac0-x/issue.md": issue("t", "", "   ") }), ["D2"]);
  });

  it("flags a comment with no author", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md": "---\n---\n\nhi\n",
      }),
      ["D2"],
    );
  });

  it("flags review fields on an issue comment", () => {
    const codesFound = codes({
      "issues/open/bqlybac0-x/issue.md": issue(),
      "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-t5kr1gq6.md": comment(
        `verdict: approve\nrevision: ${SHA_A}\n`,
      ),
    });
    assert.deepEqual(codesFound, ["D2"]);
  });
});

describe("D3 id uniqueness", () => {
  it("flags two entities sharing an id in the same status directory", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-one/issue.md": issue(),
        "issues/open/bqlybac0-two/issue.md": issue(),
      }),
      ["D3"],
    );
  });

  it("flags a comment id that collides with an entity id", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-bqlybac0.md": comment(),
      }),
      ["D3"],
    );
  });

  it("flags a collision across the archive boundary", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "archive/2024/issues/closed/bqlybac0-x/issue.md": issue(),
      }),
      ["D4"],
      "same id in open and closed is the status conflict D4, not a plain duplicate",
    );
  });
});

describe("D4 exactly one status directory", () => {
  it("flags an entity present in both open and closed", () => {
    const diagnostics = validateTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/closed/bqlybac0-x/issue.md": issue(),
      }),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.check),
      ["D4"],
    );
    assert.match(diagnostics[0]!.message, /more than one status directory/);
  });

  it("does not flag two different entities in different directories", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/closed/mz4kq1rv-y/issue.md": issue(),
      }),
      [],
    );
  });
});

describe("D5 reply-to targets", () => {
  it("accepts a reply to a sibling comment", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-aaaaaaa1.md": comment(),
        "issues/open/bqlybac0-x/comments/2026-08-04T141207Z-bbbbbbb2.md":
          comment("reply-to: aaaaaaa1\n"),
      }),
      [],
    );
  });

  it("flags a reply to a comment of another entity", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-aaaaaaa1.md": comment(),
        "issues/open/mz4kq1rv-y/issue.md": issue(),
        "issues/open/mz4kq1rv-y/comments/2026-08-04T141207Z-bbbbbbb2.md":
          comment("reply-to: aaaaaaa1\n"),
      }),
      ["D5"],
    );
  });

  it("flags a comment replying to itself", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue(),
        "issues/open/bqlybac0-x/comments/2026-08-03T141207Z-aaaaaaa1.md":
          comment("reply-to: aaaaaaa1\n"),
      }),
      ["D5"],
    );
  });
});

describe("D6 review revisions", () => {
  it("accepts a verdict bound to a recorded head", () => {
    assert.deepEqual(
      codes({
        "prs/open/dk3mp2x9-x/pr.md": pr([SHA_A, SHA_C]),
        "prs/open/dk3mp2x9-x/comments/2026-08-05T101433Z-q8zm3vp1.md": comment(
          `verdict: approve\nrevision: ${SHA_C}\n`,
        ),
      }),
      [],
    );
  });

  it("flags a verdict bound to a revision that was never recorded", () => {
    const diagnostics = validateTree(
      tree({
        "prs/open/dk3mp2x9-x/pr.md": pr([SHA_A]),
        "prs/open/dk3mp2x9-x/comments/2026-08-05T101433Z-q8zm3vp1.md": comment(
          `verdict: approve\nrevision: ${SHA_C}\n`,
        ),
      }),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.check),
      ["D6"],
    );
    assert.match(diagnostics[0]!.message, /not a recorded revision head/);
  });

  it("does not accept a base SHA in place of a head", () => {
    assert.deepEqual(
      codes({
        "prs/open/dk3mp2x9-x/pr.md": pr([SHA_A]),
        "prs/open/dk3mp2x9-x/comments/2026-08-05T101433Z-q8zm3vp1.md": comment(
          `verdict: approve\nrevision: ${SHA_B}\n`,
        ),
      }),
      ["D6"],
    );
  });
});

describe("D8 dangling references", () => {
  it("warns about a prose reference to nothing, without erroring", () => {
    const diagnostics = validateTree(
      tree({ "issues/open/bqlybac0-x/issue.md": issue("t", "", "duplicate of #mz4kq1rv") }),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.check, d.level]),
      [["D8", "warning"]],
    );
    assert.equal(hasErrors(diagnostics), false);
  });

  it("does not warn when the reference resolves", () => {
    assert.deepEqual(
      codes({
        "issues/open/bqlybac0-x/issue.md": issue("t", "", "duplicate of #mz4kq1rv"),
        "issues/closed/mz4kq1rv-y/issue.md": issue(),
      }),
      [],
    );
  });

  it("warns about a dangling duplicate-of", () => {
    assert.deepEqual(
      codes({ "issues/open/bqlybac0-x/issue.md": issue("t", "duplicate-of: mz4kq1rv\n") }),
      ["D8"],
    );
  });

  it("warns about a dangling commit trailer once, not per commit", () => {
    const diagnostics = validateTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }), {
      commitMessages: ["fix: a\n\nCloses: mz4kq1rv\n", "fix: b\n\nRefs: mz4kq1rv\n"],
    });
    assert.deepEqual(
      diagnostics.map((d) => d.check),
      ["D8"],
    );
  });

  it("does not warn about a trailer that resolves", () => {
    assert.deepEqual(
      validateTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }), {
        commitMessages: ["fix: a\n\nCloses: bqlybac0\n"],
      }),
      [],
    );
  });

  it("does not warn about trailers naming an entity a later commit deleted", () => {
    assert.deepEqual(
      validateTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }), {
        commitMessages: [
          "docs(issue): delete #mz4kq1rv\n",
          "docs(issue): comment on #mz4kq1rv\n\nRefs: mz4kq1rv\n",
        ],
      }),
      [],
    );
  });

  it("still warns about prose pointing at a deleted entity, which is editable", () => {
    assert.deepEqual(
      codes(
        { "issues/open/bqlybac0-x/issue.md": issue("t", "", "duplicate of #mz4kq1rv") },
        { commitMessages: ["docs(issue): delete #mz4kq1rv\n"] },
      ),
      ["D8"],
    );
  });
});

describe("diagnostic ordering", () => {
  it("sorts by check, then path, then message", () => {
    const diagnostics = validateTree(
      tree({
        "issues/open/zzzzzzz9-b/issue.md": "---\n---\n\nbody\n",
        "issues/open/Bad_Name/issue.md": issue(),
        "issues/open/aaaaaaa1-a/issue.md": "---\n---\n\nbody\n",
      }),
    );
    const order = diagnostics.map((d) => `${d.check}:${d.path}`);
    assert.deepEqual([...order].sort(), order);
    assert.equal(order[0]?.startsWith("D1:"), true);
  });
});

describe("checkRevisionsAppendOnly", () => {
  const rev = (head: string) => ({ head, base: SHA_B, date: "2026-08-04T16:40:00Z" });

  it("accepts a list that only grows", () => {
    assert.deepEqual(checkRevisionsAppendOnly([[rev(SHA_A)], [rev(SHA_A), rev(SHA_C)]]), {
      ok: true,
    });
  });

  it("accepts an unchanged list", () => {
    assert.deepEqual(checkRevisionsAppendOnly([[rev(SHA_A)], [rev(SHA_A)]]), { ok: true });
  });

  it("accepts a single version and an empty history", () => {
    assert.deepEqual(checkRevisionsAppendOnly([[rev(SHA_A)]]), { ok: true });
    assert.deepEqual(checkRevisionsAppendOnly([]), { ok: true });
  });

  it("rejects a list that shrank", () => {
    const result = checkRevisionsAppendOnly([[rev(SHA_A), rev(SHA_C)], [rev(SHA_A)]]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : "", /shrank from 2 to 1/);
  });

  it("rejects an edited earlier entry", () => {
    const result = checkRevisionsAppendOnly([[rev(SHA_A)], [rev(SHA_C)]]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : "", /revisions\[0\] was edited/);
  });
});

describe("checkTimestampSkew", () => {
  it("accepts timestamps within the threshold", () => {
    const a = new Date("2026-08-02T09:00:00Z");
    const b = new Date("2026-08-02T20:00:00Z");
    assert.equal(checkTimestampSkew(a, b, 48), true);
  });

  it("rejects timestamps beyond it, in either direction", () => {
    const a = new Date("2026-08-02T09:00:00Z");
    const b = new Date("2026-08-10T09:00:00Z");
    assert.equal(checkTimestampSkew(a, b, 48), false);
    assert.equal(checkTimestampSkew(b, a, 48), false);
  });
});
