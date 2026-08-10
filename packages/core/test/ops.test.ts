import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newIssueFile, parseFile, readRevisions, validateIssue } from "../src/core/files.ts";
import { FrontmatterError } from "../src/core/frontmatter.ts";
import {
  docsSubject,
  type FileOp,
  LinkRewriteError,
  linkRepairOps,
  planArchiveMerged,
  planClose,
  planComment,
  planDelete,
  planEntityOpen,
  planInit,
  planLink,
  planMergedBlock,
  planPaths,
  planPrUpdate,
  planReopen,
  planUnlink,
  RevisionUnchangedError,
  rewriteLinks,
} from "../src/core/ops.ts";
import { type EntityRecord, type NavTree, parseTree } from "../src/core/tree.ts";

const SHA_A = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
const SHA_B = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";
const SHA_C = "0011223344556677889900aabbccddeeff001122";
const ONE_REVISION = `  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n`;

function entityFrom(path: string, content: string): EntityRecord {
  const repo = parseTree(new Map([[path, content]]) as NavTree);
  const entity = [...repo.issues, ...repo.prs][0];
  assert.ok(entity, `no entity parsed from ${path}`);
  return entity;
}

const issueEntity = (extra = "", status = "open"): EntityRecord =>
  entityFrom(
    `issues/${status}/bqlybac0-login-timeout/issue.md`,
    `---\ntitle: Login times out\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\nlabels: [bug]\n${extra}---\n\nBody.\n`,
  );

/** An issue named by id, for the link planners that relate several of them. */
const linkIssue = (id: string, links = ""): EntityRecord =>
  entityFrom(
    `issues/open/${id}-x/issue.md`,
    `---\ntitle: Issue ${id}\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\n${links}---\n\nBody.\n`,
  );

/** The frontmatter a write op would produce, for matching keys against. */
function frontmatterOf(op: FileOp | undefined): string {
  assert.ok(op && op.op === "write", "expected a write op");
  return op.content;
}

const prEntity = (revisions: string, extra = ""): EntityRecord =>
  entityFrom(
    "prs/open/dk3mp2x9-auth/pr.md",
    `---\ntitle: Auth\nauthor: ked@example.com\ncreated: 2026-08-04T16:40:00Z\ntarget: main\nsource: feat/auth\n${extra}revisions:\n${revisions}---\n\nBody.\n`,
  );

describe("docsSubject", () => {
  it("scopes a Conventional Commits docs subject by entity kind", () => {
    assert.equal(docsSubject("issue", "close", "bqlybac0"), "docs(issue): close #bqlybac0");
    assert.equal(docsSubject("pr", "comment on", "dk3mp2x9"), "docs(pr): comment on #dk3mp2x9");
  });
});

describe("planInit", () => {
  it("creates every status directory with a .gitkeep", () => {
    const plan = planInit();
    assert.deepEqual(plan.ops.map((op) => (op.op === "write" ? op.path : "")).sort(), [
      "issues/closed/.gitkeep",
      "issues/open/.gitkeep",
      "prs/closed/.gitkeep",
      "prs/merged/.gitkeep",
      "prs/open/.gitkeep",
    ]);
    assert.equal(plan.message, "docs: initialize navbook");
    assert.deepEqual(plan.trailers, []);
  });
});

describe("planEntityOpen", () => {
  it("names the directory from the id and the title's slug", () => {
    const content = newIssueFile({
      title: "Login times out on slow connections",
      author: "alice@example.com",
      created: "2026-08-02T09:14:00Z",
      body: "Body.",
    });
    const result = planEntityOpen(
      "issue",
      "bqlybac0",
      "Login times out on slow connections",
      content,
    );
    assert.equal(result.dirPath, "issues/open/bqlybac0-login-times-out-on-slow-connections");
    assert.equal(result.filePath, `${result.dirPath}/issue.md`);
    assert.equal(result.plan.message, "docs(issue): open #bqlybac0");
    assert.deepEqual(result.plan.trailers, [], "opening carries the id in its subject already");
    assert.deepEqual(validateIssue(parseFile(content)), []);
  });

  it("puts pull requests under prs/open with a pr.md", () => {
    const result = planEntityOpen("pr", "dk3mp2x9", "Auth refactor", "---\n---\n\nx\n");
    assert.equal(result.filePath, "prs/open/dk3mp2x9-auth-refactor/pr.md");
  });

  it("falls back to a usable slug for a title that folds away", () => {
    const result = planEntityOpen("issue", "bqlybac0", "🎉", "---\n---\n\nx\n");
    assert.equal(result.dirPath, "issues/open/bqlybac0-untitled");
  });
});

describe("planClose and planReopen", () => {
  it("moves the directory and records a resolution", () => {
    const plan = planClose(issueEntity(), { resolution: "fixed" });
    assert.deepEqual(plan.ops[0], {
      op: "move",
      from: "issues/open/bqlybac0-login-timeout",
      to: "issues/closed/bqlybac0-login-timeout",
    });
    const write = plan.ops[1];
    assert.equal(write?.op, "write");
    assert.equal(
      write?.op === "write" && write.path,
      "issues/closed/bqlybac0-login-timeout/issue.md",
    );
    assert.match(write?.op === "write" ? write.content : "", /resolution: fixed/);
    assert.deepEqual(plan.trailers, [{ key: "Closes", id: "bqlybac0" }]);
  });

  it("scopes the commit subject by entity kind", () => {
    assert.equal(planClose(issueEntity()).message, "docs(issue): close #bqlybac0");
    assert.equal(planClose(prEntity(ONE_REVISION)).message, "docs(pr): close #dk3mp2x9");
    assert.equal(planReopen(issueEntity("", "closed")).message, "docs(issue): reopen #bqlybac0");
    assert.equal(planReopen(prEntity(ONE_REVISION)).message, "docs(pr): reopen #dk3mp2x9");
  });

  it("writes the rewritten file at the destination, not the source", () => {
    const plan = planClose(issueEntity(), { resolution: "fixed" });
    for (const op of plan.ops) {
      if (op.op === "write") assert.ok(op.path.startsWith("issues/closed/"), op.path);
    }
  });

  it("moves without rewriting when no resolution is given", () => {
    const plan = planClose(issueEntity());
    assert.equal(plan.ops.length, 1);
    assert.equal(plan.ops[0]?.op, "move");
  });

  it("implies the duplicate resolution when only --duplicate-of is given", () => {
    const plan = planClose(issueEntity(), { duplicateOf: "mz4kq1rv" });
    const content = plan.ops.find((op) => op.op === "write");
    assert.match(content?.op === "write" ? content.content : "", /resolution: duplicate/);
    assert.match(content?.op === "write" ? content.content : "", /duplicate-of: mz4kq1rv/);
  });

  it("preserves unknown keys and label order through a close", () => {
    const entity = issueEntity("mytool-field: keep me\n");
    const plan = planClose(entity, { resolution: "fixed" });
    const write = plan.ops.find((op) => op.op === "write");
    const content = write?.op === "write" ? write.content : "";
    assert.match(content, /mytool-field: keep me/);
    assert.match(content, /labels: \[bug\]/);
  });

  it("clears the resolution on reopen", () => {
    const entity = issueEntity("resolution: fixed\n", "closed");
    const plan = planReopen(entity);
    const write = plan.ops.find((op) => op.op === "write");
    assert.ok(write?.op === "write" && !/resolution:/.test(write.content));
    assert.deepEqual(plan.trailers, [{ key: "Refs", id: "bqlybac0" }]);
  });

  it("also clears duplicate-of when reopening a duplicate", () => {
    const entity = issueEntity("resolution: duplicate\nduplicate-of: mz4kq1rv\n", "closed");
    const write = planReopen(entity).ops.find((op) => op.op === "write");
    assert.ok(write?.op === "write" && !/duplicate-of:/.test(write.content));
  });

  it("leaves an unrelated duplicate-of alone when reopening", () => {
    const entity = issueEntity("resolution: fixed\nduplicate-of: mz4kq1rv\n", "closed");
    const write = planReopen(entity).ops.find((op) => op.op === "write");
    assert.ok(write?.op === "write" && /duplicate-of: mz4kq1rv/.test(write.content));
  });

  it("only moves when reopening an entity that had no resolution", () => {
    const plan = planReopen(issueEntity("", "closed"));
    assert.equal(plan.ops.length, 1);
    assert.equal(plan.ops[0]?.op, "move");
  });
});

describe("planComment", () => {
  it("names the file from the timestamp and the comment id", () => {
    const { plan, path } = planComment(
      issueEntity(),
      "t5kr1gq6",
      new Date("2026-08-03T14:12:07Z"),
      "---\nauthor: bob@example.com\n---\n\nhi\n",
    );
    assert.equal(
      path,
      "issues/open/bqlybac0-login-timeout/comments/2026-08-03T141207Z-t5kr1gq6.md",
    );
    assert.equal(plan.message, "docs(issue): comment on #bqlybac0");
    assert.deepEqual(plan.trailers, [{ key: "Refs", id: "bqlybac0" }]);
  });

  it("says 'review' in the commit subject for a review", () => {
    const { plan } = planComment(
      prEntity(ONE_REVISION),
      "t5kr1gq6",
      new Date(),
      "---\n---\n\nx\n",
      {
        review: true,
      },
    );
    assert.equal(plan.message, "docs(pr): review #dk3mp2x9");
  });
});

describe("planArchiveMerged", () => {
  it("moves the pull request into prs/merged/ under a pr-scoped subject", () => {
    const plan = planArchiveMerged(prEntity(ONE_REVISION));
    assert.deepEqual(plan.ops, [
      { op: "move", from: "prs/open/dk3mp2x9-auth", to: "prs/merged/dk3mp2x9-auth" },
    ]);
    assert.equal(plan.message, "docs(pr): archive merged #dk3mp2x9");
    assert.deepEqual(plan.trailers, [{ key: "Refs", id: "dk3mp2x9" }]);
  });
});

describe("planPrUpdate", () => {
  it("appends a revision without touching the existing entries", () => {
    const plan = planPrUpdate(prEntity(ONE_REVISION), {
      head: SHA_C,
      base: SHA_B,
      date: "2026-08-06T10:00:00Z",
    });
    const write = plan.ops[0];
    const content = write?.op === "write" ? write.content : "";
    const revisions = readRevisions(parseFile(content).fm);
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]?.head, SHA_A, "the first entry is untouched");
    assert.equal(revisions[1]?.head, SHA_C);
    assert.equal(plan.message, "docs(pr): update #dk3mp2x9");
  });

  it("refuses when HEAD already is the latest recorded revision", () => {
    assert.throws(
      () =>
        planPrUpdate(prEntity(ONE_REVISION), {
          head: SHA_A,
          base: SHA_B,
          date: "2026-08-06T10:00:00Z",
        }),
      RevisionUnchangedError,
    );
  });

  it("allows re-recording a head that is not the latest entry", () => {
    const two = `${ONE_REVISION}  - head: ${SHA_C}\n    base: ${SHA_B}\n    date: 2026-08-05T10:00:00Z\n`;
    const plan = planPrUpdate(prEntity(two), {
      head: SHA_A,
      base: SHA_B,
      date: "2026-08-06T10:00:00Z",
    });
    const write = plan.ops[0];
    assert.equal(readRevisions(parseFile(write?.op === "write" ? write.content : "").fm).length, 3);
  });
});

describe("planMergedBlock", () => {
  it("records date, author and merge commit", () => {
    const plan = planMergedBlock(prEntity(ONE_REVISION), {
      date: "2026-08-07T12:00:00Z",
      by: "ked@example.com",
      commit: SHA_C,
    });
    const write = plan.ops[0];
    const fm = parseFile(write?.op === "write" ? write.content : "").fm;
    assert.deepEqual(fm.merged, {
      date: "2026-08-07T12:00:00Z",
      by: "ked@example.com",
      commit: SHA_C,
    });
    assert.equal(plan.message, "docs(pr): merge #dk3mp2x9");
  });
});

describe("planDelete", () => {
  it("removes the whole directory, whatever the status", () => {
    for (const status of ["open", "closed"]) {
      assert.deepEqual(
        planDelete(issueEntity("", status)).ops,
        [{ op: "remove", path: `issues/${status}/bqlybac0-login-timeout` }],
        `status ${status}`,
      );
    }
  });

  it("scopes the subject by kind and writes no trailer", () => {
    const plan = planDelete(issueEntity());
    assert.equal(plan.message, "docs(issue): delete #bqlybac0");
    // A trailer would name the entity the commit removes: dangling by
    // construction, which is what doctor's D8 exists to report.
    assert.deepEqual(plan.trailers, []);
    assert.equal(planDelete(prEntity(ONE_REVISION)).message, "docs(pr): delete #dk3mp2x9");
  });

  it("keeps the archive prefix of an archived entity", () => {
    const entity = entityFrom(
      "archive/2019/issues/closed/bqlybac0-login-timeout/issue.md",
      "---\ntitle: Login times out\nauthor: alice@example.com\ncreated: 2019-01-02T09:14:00Z\n---\n\nBody.\n",
    );
    assert.deepEqual(planDelete(entity).ops, [
      { op: "remove", path: "archive/2019/issues/closed/bqlybac0-login-timeout" },
    ]);
  });

  it("mends the survivors before removing anything, so the ops apply in order", () => {
    const child = linkIssue("c1000000", "parent: bqlybac0\n");
    const plan = planDelete(issueEntity(), {
      repairs: [{ entity: child, edit: { parent: null } }],
    });
    assert.deepEqual(
      plan.ops.map((op) => op.op),
      ["write", "remove"],
    );
    assert.equal(frontmatterOf(plan.ops[0]).includes("parent"), false);
  });

  it("removes a whole subtree and records the extra ids it took", () => {
    const grandchild = linkIssue("d1000000", "parent: c1000000\n");
    const child = linkIssue("c1000000", "parent: bqlybac0\nsubtasks: [d1000000]\n");
    const plan = planDelete(issueEntity(), { alsoRemove: [child, grandchild] });
    assert.deepEqual(
      plan.ops.map((op) => (op.op === "remove" ? op.path : "?")),
      [
        "issues/open/bqlybac0-login-timeout",
        "issues/open/c1000000-x/",
        "issues/open/d1000000-x/",
      ].map((path) => path.replace(/\/$/, "")),
    );
    // A subtask the subject does not name would otherwise look like an entity
    // that went missing rather than one deliberately removed (check D8).
    assert.deepEqual(plan.trailers, [
      { key: "Deletes", id: "c1000000" },
      { key: "Deletes", id: "d1000000" },
    ]);
  });
});

describe("rewriteLinks", () => {
  it("writes a new list in flow style, as the spec's own examples are", () => {
    const content = rewriteLinks(linkIssue("a1000000"), { addSubtasks: ["c1000000"] });
    assert.match(content ?? "", /^subtasks: \[c1000000\]$/m);
  });

  it("appends to an existing list, keeping the order already there", () => {
    const entity = linkIssue("a1000000", "subtasks: [c1000000, b1000000]\n");
    const content = rewriteLinks(entity, { addSubtasks: ["d1000000"] });
    assert.match(content ?? "", /^subtasks: \[c1000000, b1000000, d1000000\]$/m);
  });

  it("removes the key rather than leaving an empty list behind", () => {
    const entity = linkIssue("a1000000", "subtasks: [c1000000]\n");
    const content = rewriteLinks(entity, { removeSubtasks: ["c1000000"] });
    assert.equal(content?.includes("subtasks"), false);
  });

  it("drops a repeated entry on any write, since it cannot mean anything twice", () => {
    const entity = linkIssue("a1000000", "subtasks: [c1000000, c1000000]\n");
    assert.match(rewriteLinks(entity, {}) ?? "", /^subtasks: \[c1000000\]$/m);
  });

  it("reports no change rather than churning a file that already agrees", () => {
    const entity = linkIssue("a1000000", "parent: b1000000\nsubtasks: [c1000000]\n");
    assert.equal(rewriteLinks(entity, { addSubtasks: ["c1000000"], parent: "b1000000" }), null);
    assert.equal(rewriteLinks(entity, { removeSubtasks: ["d1000000"] }), null);
  });

  it("clears the parent on null and leaves it alone on undefined", () => {
    const entity = linkIssue("a1000000", "parent: b1000000\n");
    assert.equal(rewriteLinks(entity, { parent: null })?.includes("parent"), false);
    assert.equal(rewriteLinks(entity, {}), null);
  });

  it("preserves unknown keys and the body", () => {
    const entity = linkIssue("a1000000", "unknown-key: {deep: [1, 2]}\n");
    const content = rewriteLinks(entity, { addSubtasks: ["c1000000"] }) ?? "";
    assert.match(content, /unknown-key: \{deep: \[1, 2\]\}/);
    assert.match(content, /Body\./);
  });

  it("refuses a list it cannot read rather than silently dropping what is there", () => {
    const entity = linkIssue("a1000000", "subtasks: [c1000000, 42]\n");
    assert.throws(() => rewriteLinks(entity, { addSubtasks: ["d1000000"] }), FrontmatterError);
  });

  it("names the file whose links could not be read, not the one asked about", () => {
    const bad = linkIssue("a1000000", "parent: not-an-id\n");
    assert.throws(
      () => linkRepairOps([{ entity: bad, edit: { parent: null } }]),
      (error) => {
        assert.ok(error instanceof LinkRewriteError);
        assert.equal(error.path, "issues/open/a1000000-x/issue.md");
        return true;
      },
    );
  });
});

describe("planLink", () => {
  it("writes both sides and refers to both entities", () => {
    const child = linkIssue("c1000000");
    const parent = linkIssue("a1000000");
    const plan = planLink(child, parent);
    assert.equal(plan.message, "docs(issue): link #c1000000");
    assert.deepEqual(plan.trailers, [
      { key: "Refs", id: "c1000000" },
      { key: "Refs", id: "a1000000" },
    ]);
    assert.match(frontmatterOf(plan.ops[0]), /^parent: a1000000$/m);
    assert.match(frontmatterOf(plan.ops[1]), /^subtasks: \[c1000000\]$/m);
  });

  it("takes the child off every list that still claims it", () => {
    const child = linkIssue("c1000000", "parent: b1000000\n");
    const parent = linkIssue("a1000000");
    const stale = linkIssue("b1000000", "subtasks: [c1000000]\n");
    const plan = planLink(child, parent, [stale]);
    assert.equal(plan.ops.length, 3);
    assert.equal(frontmatterOf(plan.ops[2]).includes("subtasks"), false);
  });

  it("mends a half-written link without touching the side that was right", () => {
    const child = linkIssue("c1000000", "parent: a1000000\n");
    const parent = linkIssue("a1000000");
    const plan = planLink(child, parent);
    assert.deepEqual(
      plan.ops.map((op) => (op.op === "write" ? op.path : "?")),
      ["issues/open/a1000000-x/issue.md"],
    );
  });
});

describe("planUnlink", () => {
  it("clears the parent and every claim on it", () => {
    const child = linkIssue("c1000000", "parent: a1000000\n");
    const parent = linkIssue("a1000000", "subtasks: [c1000000]\n");
    const plan = planUnlink(child, [parent]);
    assert.equal(plan.message, "docs(issue): unlink #c1000000");
    assert.deepEqual(plan.trailers, [
      { key: "Refs", id: "c1000000" },
      { key: "Refs", id: "a1000000" },
    ]);
    assert.equal(frontmatterOf(plan.ops[0]).includes("parent"), false);
    assert.equal(frontmatterOf(plan.ops[1]).includes("subtasks"), false);
  });

  it("also drops an issue's claim on itself, which nothing else can undo", () => {
    const child = linkIssue("c1000000", "subtasks: [c1000000]\n");
    const plan = planUnlink(child, []);
    assert.equal(frontmatterOf(plan.ops[0]).includes("subtasks"), false);
  });
});

describe("planPaths", () => {
  it("lists both sides of a move so the commit guard can allow them", () => {
    assert.deepEqual(planPaths(planClose(issueEntity(), { resolution: "fixed" })).sort(), [
      "issues/closed/bqlybac0-login-timeout",
      "issues/closed/bqlybac0-login-timeout/issue.md",
      "issues/open/bqlybac0-login-timeout",
    ]);
  });

  it("lists a removed directory, which stands for everything beneath it", () => {
    assert.deepEqual(planPaths(planDelete(issueEntity())), ["issues/open/bqlybac0-login-timeout"]);
  });
});
