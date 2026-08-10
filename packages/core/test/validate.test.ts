import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NavTree } from "../src/core/tree.ts";
import {
  type Check,
  checkRevisionsAppendOnly,
  checkTimestampSkew,
  type Diagnostic,
  hasErrors,
  type ValidateOptions,
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
const codes = (entries: Record<string, string>, opts: ValidateOptions = {}): Check[] =>
  validateTree(tree(entries), opts).map((d) => d.check);

/** The single file a diagnostic's repair would write, for matching keys against. */
function fixContent(diagnostic: Diagnostic | undefined): string {
  const write = diagnostic?.fix?.find((op) => op.op === "write");
  assert.ok(write?.op === "write", "expected a repair that writes a file");
  return write.content;
}

/** The tree a repair would leave behind, so a fix can be checked by its result. */
function applyFix(
  entries: Record<string, string>,
  diagnostic: Diagnostic | undefined,
): Record<string, string> {
  const out = { ...entries };
  for (const op of diagnostic?.fix ?? []) {
    if (op.op === "write") out[op.path] = op.content;
  }
  return out;
}

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

  it("warns about a link naming nothing, from either side", () => {
    assert.deepEqual(
      codes({ "issues/open/bqlybac0-x/issue.md": issue("t", "parent: mz4kq1rv\n") }),
      ["D8"],
    );
    assert.deepEqual(
      codes({ "issues/open/bqlybac0-x/issue.md": issue("t", "subtasks: [mz4kq1rv, t5kr1gq6]\n") }),
      ["D8", "D8"],
    );
  });

  it("does not warn about a subtask a recursive delete took with its parent", () => {
    assert.deepEqual(
      validateTree(tree({ "issues/open/bqlybac0-x/issue.md": issue() }), {
        commitMessages: [
          "docs(issue): delete #mz4kq1rv\n\nDeletes: t5kr1gq6\n",
          "docs(issue): link #t5kr1gq6\n\nRefs: t5kr1gq6\nRefs: mz4kq1rv\n",
        ],
      }),
      [],
    );
  });
});

/* Two issues, linked or not, for the link checks to judge. */
const linked = (id: string, links: string): Record<string, string> => ({
  [`issues/open/${id}-x/issue.md`]: issue(`Issue ${id}`, links),
});

describe("D11 broken links", () => {
  it("says nothing about a tree whose links agree", () => {
    assert.deepEqual(
      codes({
        ...linked("bqlybac0", "subtasks: [mz4kq1rv]\n"),
        ...linked("mz4kq1rv", "parent: bqlybac0\n"),
      }),
      [],
    );
  });

  it("errors when only the child records the link, and offers to add the entry", () => {
    const diagnostics = validateTree(
      tree({ ...linked("bqlybac0", ""), ...linked("mz4kq1rv", "parent: bqlybac0\n") }),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.check, d.level, d.path]),
      [["D11", "error", "issues/open/bqlybac0-x/issue.md"]],
    );
    assert.match(fixContent(diagnostics[0]), /^subtasks: \[mz4kq1rv\]$/m);
  });

  it("errors when only the parent records the link, and offers to set the parent", () => {
    const diagnostics = validateTree(
      tree({ ...linked("bqlybac0", "subtasks: [mz4kq1rv]\n"), ...linked("mz4kq1rv", "") }),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.check, d.path]),
      [["D11", "issues/open/mz4kq1rv-x/issue.md"]],
    );
    assert.match(fixContent(diagnostics[0]), /^parent: bqlybac0$/m);
  });

  it("offers no repair for a disputed subtask until something can decide it", () => {
    const disputed = {
      ...linked("bqlybac0", "subtasks: [t5kr1gq6]\n"),
      ...linked("mz4kq1rv", "subtasks: [t5kr1gq6]\n"),
      ...linked("t5kr1gq6", "parent: bqlybac0\n"),
    };
    const reported = validateTree(tree(disputed));
    assert.deepEqual(
      reported.map((d) => [d.check, d.path]),
      [["D11", "issues/open/t5kr1gq6-x/issue.md"]],
    );
    assert.equal(reported[0]?.fix, undefined);

    // The winner already lists the subtask, so only the loser's entry and the
    // child's own key have to change.
    const settled = validateTree(tree(disputed), { decideLinkConflict: () => "mz4kq1rv" });
    const written = (settled[0]?.fix ?? []).map((op) => (op.op === "write" ? op.path : "?"));
    assert.deepEqual(written.sort(), [
      "issues/open/bqlybac0-x/issue.md",
      "issues/open/t5kr1gq6-x/issue.md",
    ]);
    assert.equal(validateTree(tree(applyFix(disputed, settled[0]))).length, 0);
  });

  it("gives every fault touching one file the same content for it", () => {
    // Both children name a parent that lists neither: two faults, one file.
    const diagnostics = validateTree(
      tree({
        ...linked("bqlybac0", ""),
        ...linked("mz4kq1rv", "parent: bqlybac0\n"),
        ...linked("t5kr1gq6", "parent: bqlybac0\n"),
      }),
    );
    assert.equal(diagnostics.length, 2);
    assert.equal(fixContent(diagnostics[0]), fixContent(diagnostics[1]));
    assert.match(fixContent(diagnostics[0]), /^subtasks: \[mz4kq1rv, t5kr1gq6\]$/m);
  });

  it("errors on a repeated entry and offers to drop the repeat", () => {
    const diagnostics = validateTree(
      tree({
        ...linked("bqlybac0", "subtasks: [mz4kq1rv, mz4kq1rv]\n"),
        ...linked("mz4kq1rv", "parent: bqlybac0\n"),
      }),
    );
    assert.deepEqual(
      diagnostics.map((d) => d.check),
      ["D11"],
    );
    assert.match(fixContent(diagnostics[0]), /^subtasks: \[mz4kq1rv\]$/m);
  });

  it("errors on a link naming a pull request, and never offers a repair", () => {
    const diagnostics = validateTree(
      tree({
        ...linked("bqlybac0", "parent: dk3mp2x9\n"),
        "prs/open/dk3mp2x9-auth/pr.md": pr(),
      }),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.check, d.path]),
      [["D11", "issues/open/bqlybac0-x/issue.md"]],
    );
    assert.equal(diagnostics[0]?.fix, undefined);
  });

  it("rejects a link key on a pull request as a schema fault, not a broken link", () => {
    assert.deepEqual(
      codes({
        "prs/open/dk3mp2x9-auth/pr.md": pr().replace(
          "target: main",
          "target: main\nparent: bqlybac0",
        ),
      }),
      ["D2", "D8"],
    );
  });

  it("leaves a link whose target is not here to D8, which knows it may be elsewhere", () => {
    assert.deepEqual(codes(linked("bqlybac0", "parent: mz4kq1rv\n")), ["D8"]);
  });
});

describe("D12 loops in the tree", () => {
  it("errors on an issue that is its own parent", () => {
    assert.deepEqual(
      validateTree(tree(linked("bqlybac0", "parent: bqlybac0\n"))).map((d) => [d.check, d.level]),
      [["D12", "error"]],
    );
  });

  it("errors on an issue that lists itself", () => {
    assert.deepEqual(codes(linked("bqlybac0", "subtasks: [bqlybac0]\n")), ["D12"]);
  });

  it("errors once on a longer loop, against its smallest member", () => {
    const diagnostics = validateTree(
      tree({
        ...linked("bqlybac0", "parent: mz4kq1rv\nsubtasks: [t5kr1gq6]\n"),
        ...linked("mz4kq1rv", "parent: t5kr1gq6\nsubtasks: [bqlybac0]\n"),
        ...linked("t5kr1gq6", "parent: bqlybac0\nsubtasks: [mz4kq1rv]\n"),
      }),
    );
    assert.deepEqual(
      diagnostics.map((d) => [d.check, d.path]),
      [["D12", "issues/open/bqlybac0-x/issue.md"]],
    );
  });

  it("never offers to break a loop, since every link on it is equally suspect", () => {
    const diagnostics = validateTree(tree(linked("bqlybac0", "parent: bqlybac0\n")));
    assert.equal(diagnostics[0]?.fix, undefined);
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
