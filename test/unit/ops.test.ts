import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newIssueFile, parseFile, readRevisions, validateIssue } from "../../src/core/files.ts";
import {
  planClose,
  planComment,
  planEntityOpen,
  planInit,
  planMergedBlock,
  planPaths,
  planPrUpdate,
  planReopen,
  RevisionUnchangedError,
} from "../../src/core/ops.ts";
import { type EntityRecord, type NavTree, parseTree } from "../../src/core/tree.ts";

const SHA_A = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
const SHA_B = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";
const SHA_C = "0011223344556677889900aabbccddeeff001122";

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

const prEntity = (revisions: string, extra = ""): EntityRecord =>
  entityFrom(
    "prs/open/dk3mp2x9-auth/pr.md",
    `---\ntitle: Auth\nauthor: ked@example.com\ncreated: 2026-08-04T16:40:00Z\ntarget: main\nsource: feat/auth\n${extra}revisions:\n${revisions}---\n\nBody.\n`,
  );

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
    assert.equal(plan.message, "nb: initialize navbook");
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
    assert.equal(result.plan.message, "nb: open #bqlybac0");
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
    assert.equal(plan.message, "nb: comment on #bqlybac0");
    assert.deepEqual(plan.trailers, [{ key: "Refs", id: "bqlybac0" }]);
  });

  it("says 'review' in the commit subject for a review", () => {
    const { plan } = planComment(issueEntity(), "t5kr1gq6", new Date(), "---\n---\n\nx\n", {
      review: true,
    });
    assert.equal(plan.message, "nb: review #bqlybac0");
  });
});

describe("planPrUpdate", () => {
  const oneRevision = `  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n`;

  it("appends a revision without touching the existing entries", () => {
    const plan = planPrUpdate(prEntity(oneRevision), {
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
    assert.equal(plan.message, "nb: update #dk3mp2x9");
  });

  it("refuses when HEAD already is the latest recorded revision", () => {
    assert.throws(
      () =>
        planPrUpdate(prEntity(oneRevision), {
          head: SHA_A,
          base: SHA_B,
          date: "2026-08-06T10:00:00Z",
        }),
      RevisionUnchangedError,
    );
  });

  it("allows re-recording a head that is not the latest entry", () => {
    const two = `${oneRevision}  - head: ${SHA_C}\n    base: ${SHA_B}\n    date: 2026-08-05T10:00:00Z\n`;
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
    const entity = prEntity(
      `  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-08-04T16:40:00Z\n`,
    );
    const plan = planMergedBlock(entity, {
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
    assert.equal(plan.message, "nb: merge #dk3mp2x9");
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
});
