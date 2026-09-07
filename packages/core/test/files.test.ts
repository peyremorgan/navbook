import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  newCommentFile,
  newIssueFile,
  newPrFile,
  normalizeBody,
  parseFile,
  readAssignees,
  readLabels,
  readParent,
  readReviewers,
  readRevisions,
  readSubtasks,
  validateComment,
  validateIssue,
  validatePr,
} from "../src/core/files.ts";

const SHA_A = "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d";
const SHA_B = "91d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0";

const messages = (problems: { message: string }[]): string =>
  problems.map((p) => p.message).join(" | ");

describe("issue.md", () => {
  const valid = `---
title: Login times out on slow connections
author: Alice Smith <alice@example.com>
created: 2026-08-02T09:14:00Z
labels: [bug, auth]
assignee: ked@example.com
---

Login POST aborts after 5 s.
`;

  it("accepts the spec's example", () => {
    assert.deepEqual(validateIssue(parseFile(valid)), []);
  });

  it("requires title, author, created and a non-empty description", () => {
    const problems = validateIssue(parseFile("---\n---\n\n"));
    const text = messages(problems);
    assert.match(text, /missing required key 'title'/);
    assert.match(text, /missing required key 'author'/);
    assert.match(text, /missing required key 'created'/);
    assert.match(text, /description must not be empty/);
  });

  it("treats a whitespace-only description as empty", () => {
    const problems = validateIssue(
      parseFile("---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\n---\n\n   \n\n"),
    );
    assert.match(messages(problems), /description must not be empty/);
  });

  it("rejects a status key, since status is the path", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nstatus: open\n---\n\nbody\n`;
    assert.match(messages(validateIssue(parseFile(text))), /must not carry a 'status' key/);
  });

  it("rejects malformed authors, timestamps, labels and assignees", () => {
    const text = `---\ntitle: t\nauthor: not-an-address\ncreated: someday\nlabels: [ok, ""]\nassignee: [nope]\n---\n\nbody\n`;
    const problems = messages(validateIssue(parseFile(text)));
    assert.match(problems, /'author' must be an RFC 5322 address/);
    assert.match(problems, /'created' must be an ISO 8601 timestamp/);
    assert.match(problems, /'labels' must be a list of non-empty strings/);
    assert.match(problems, /'assignee' must be a person or list of persons/);
  });

  it("requires duplicate-of to be a Navbook ID", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nduplicate-of: 12\n---\n\nbody\n`;
    assert.match(messages(validateIssue(parseFile(text))), /'duplicate-of' must be a Navbook ID/);
  });

  it("accepts decomposition links and reads them back", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nparent: bqlybac0\nsubtasks: [mz4kq1rv, t5kr1gq6]\n---\n\nbody\n`;
    const parsed = parseFile(text);
    assert.deepEqual(validateIssue(parsed), []);
    assert.equal(readParent(parsed.fm), "bqlybac0");
    assert.deepEqual(readSubtasks(parsed.fm), ["mz4kq1rv", "t5kr1gq6"]);
  });

  it("accepts a block-style subtasks list, which is the same YAML", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nsubtasks:\n  - mz4kq1rv\n  - t5kr1gq6\n---\n\nbody\n`;
    const parsed = parseFile(text);
    assert.deepEqual(validateIssue(parsed), []);
    assert.deepEqual(readSubtasks(parsed.fm), ["mz4kq1rv", "t5kr1gq6"]);
  });

  it("rejects link keys that are not Navbook IDs", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nparent: [a]\nsubtasks: mz4kq1rv\n---\n\nbody\n`;
    const problems = messages(validateIssue(parseFile(text)));
    assert.match(problems, /'parent' must be a Navbook ID/);
    assert.match(problems, /'subtasks' must be a list of Navbook IDs/);
    assert.match(
      messages(
        validateIssue(
          parseFile(
            `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nsubtasks: [mz4kq1rv, NOPE]\n---\n\nbody\n`,
          ),
        ),
      ),
      /'subtasks' must be a list of Navbook IDs/,
    );
  });

  it("reads malformed link keys as no link at all, so a renderer never trips", () => {
    const { fm } = parseFile(
      `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nparent: 12\nsubtasks: [mz4kq1rv, 7, x]\n---\n\nbody\n`,
    );
    assert.equal(readParent(fm), null);
    assert.deepEqual(readSubtasks(fm), ["mz4kq1rv"]);
  });

  it("accepts unknown keys and unusual but legal hand edits", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\nsome-tool-key: {a: 1}\nassignee: [a@b.co, c@d.co]\n---\n\nbody\n`;
    assert.deepEqual(validateIssue(parseFile(text)), []);
    assert.deepEqual(readAssignees(parseFile(text).fm), ["a@b.co", "c@d.co"]);
  });

  it("distinguishes a missing key from an empty one", () => {
    assert.match(
      messages(validateIssue(parseFile("---\ntitle:\n---\n\nbody\n"))),
      /'title' must be a non-empty string/,
    );
    assert.match(
      messages(validateIssue(parseFile("---\n---\n\nbody\n"))),
      /missing required key 'title'/,
    );
  });
});

describe("pr.md", () => {
  const valid = `---
title: Refactor auth token handling
author: ked@example.com
created: 2026-08-04T16:40:00Z
target: main
source: feat/auth-refactor
revisions:
  - head: ${SHA_A}
    base: ${SHA_B}
    date: 2026-08-04T16:40:00Z
---

Replaces the ad-hoc token cache.
`;

  it("accepts the spec's example", () => {
    assert.deepEqual(validatePr(parseFile(valid)), []);
  });

  it("requires target and at least one revision", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\n---\n\nbody\n`;
    const problems = messages(validatePr(parseFile(text)));
    assert.match(problems, /missing required key 'target'/);
    assert.match(problems, /'revisions' must be a list with at least one entry/);
  });

  it("rejects decomposition links, which relate issues only", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\nparent: bqlybac0\nsubtasks: [mz4kq1rv]\nrevisions:\n  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-01-01\n---\n\nbody\n`;
    const problems = messages(validatePr(parseFile(text)));
    assert.match(problems, /'parent' is an issue-only key/);
    assert.match(problems, /'subtasks' is an issue-only key/);
  });

  it("accepts one reviewer or several, and reads them back", () => {
    const one = parseFile(
      valid.replace("source: feat/auth-refactor", "source: x\nreviewer: alice@example.com"),
    );
    assert.deepEqual(validatePr(one), []);
    assert.deepEqual(readReviewers(one.fm), ["alice@example.com"]);

    const many = parseFile(
      valid.replace(
        "source: feat/auth-refactor",
        "source: x\nreviewer: [alice@example.com, Bo <bo@example.com>]",
      ),
    );
    assert.deepEqual(validatePr(many), []);
    assert.deepEqual(readReviewers(many.fm), ["alice@example.com", "Bo <bo@example.com>"]);
  });

  it("rejects a reviewer that is not a person", () => {
    const text = valid.replace("source: feat/auth-refactor", "reviewer: nobody");
    assert.match(
      messages(validatePr(parseFile(text))),
      /'reviewer' must be a person or list of persons/,
    );
  });

  it("rejects an empty reviewer list, which says nothing at all", () => {
    const text = valid.replace("source: feat/auth-refactor", "reviewer: []");
    assert.match(
      messages(validatePr(parseFile(text))),
      /'reviewer' must be a person or list of persons/,
    );
  });

  it("reads no reviewers from a file that names none", () => {
    assert.deepEqual(readReviewers(parseFile(valid).fm), []);
  });

  it("rejects an empty revisions list", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\nrevisions: []\n---\n\nbody\n`;
    assert.match(messages(validatePr(parseFile(text))), /at least one entry/);
  });

  it("requires 40-hex SHAs and timestamps in every revision", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\nrevisions:\n  - head: abc\n    base: ${SHA_B}\n    date: nope\n---\n\nbody\n`;
    const problems = messages(validatePr(parseFile(text)));
    assert.match(problems, /revisions\[0\]\.head must be a 40-hex commit SHA/);
    assert.match(problems, /revisions\[0\]\.date must be an ISO 8601 timestamp/);
  });

  it("keeps an all-digit SHA intact instead of letting YAML make it a number", () => {
    const digits = "4".repeat(40);
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\nrevisions:\n  - head: ${digits}\n    base: ${SHA_B}\n    date: 2026-01-01\n---\n\nbody\n`;
    const parsed = parseFile(text);
    assert.deepEqual(validatePr(parsed), []);
    assert.equal(readRevisions(parsed.fm)[0]?.head, digits);
  });

  it("validates the merged block when present", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\nrevisions:\n  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-01-01\nmerged:\n  date: nope\n  by: not-an-address\n  commit: xyz\n---\n\nbody\n`;
    const problems = messages(validatePr(parseFile(text)));
    assert.match(problems, /'merged.date' must be an ISO 8601 timestamp/);
    assert.match(problems, /'merged.by' must be an RFC 5322 address/);
    assert.match(problems, /'merged.commit' must be a 40-hex commit SHA/);
  });

  it("rejects a non-boolean draft", () => {
    const text = `---\ntitle: t\nauthor: a@b.co\ncreated: 2026-01-01\ntarget: main\ndraft: yes-please\nrevisions:\n  - head: ${SHA_A}\n    base: ${SHA_B}\n    date: 2026-01-01\n---\n\nbody\n`;
    assert.match(messages(validatePr(parseFile(text))), /'draft' must be a boolean/);
  });
});

describe("comments", () => {
  it("accepts a bare comment", () => {
    assert.deepEqual(
      validateComment(parseFile("---\nauthor: a@b.co\n---\n\nhi\n"), { onPr: false }),
      [],
    );
  });

  it("requires an author", () => {
    assert.match(
      messages(validateComment(parseFile("---\n---\n\nhi\n"), { onPr: false })),
      /missing required key 'author'/,
    );
  });

  it("accepts the spec's inline review example", () => {
    const text = `---\nauthor: alice@example.com\nverdict: request-changes\nrevision: ${SHA_A}\nfile: src/auth/login.c\nline: 142\n---\n\n> if (timeout > 5)\n\nOff-by-one.\n`;
    assert.deepEqual(validateComment(parseFile(text), { onPr: true }), []);
  });

  it("requires a revision whenever a verdict or file anchor is present", () => {
    const withVerdict = parseFile("---\nauthor: a@b.co\nverdict: approve\n---\n\nlgtm\n");
    assert.match(
      messages(validateComment(withVerdict, { onPr: true })),
      /'revision' \(40-hex SHA\) is required/,
    );
    const withFile = parseFile("---\nauthor: a@b.co\nfile: src/x.c\n---\n\nnote\n");
    assert.match(
      messages(validateComment(withFile, { onPr: true })),
      /'revision' \(40-hex SHA\) is required/,
    );
  });

  it("accepts the third verdict, which judges nothing", () => {
    const text = `---\nauthor: a@b.co\nverdict: comment\nrevision: ${SHA_A}\n---\n\nRead it.\n`;
    assert.deepEqual(validateComment(parseFile(text), { onPr: true }), []);
  });

  it("rejects unknown verdicts", () => {
    const text = `---\nauthor: a@b.co\nverdict: maybe\nrevision: ${SHA_A}\n---\n\nhm\n`;
    assert.match(
      messages(validateComment(parseFile(text), { onPr: true })),
      /'verdict' must be one of/,
    );
  });

  it("rejects review fields on an issue comment", () => {
    const text = `---\nauthor: a@b.co\nverdict: approve\nrevision: ${SHA_A}\n---\n\nlgtm\n`;
    assert.match(
      messages(validateComment(parseFile(text), { onPr: false })),
      /only meaningful on pull-request comments/,
    );
  });

  it("accepts integer and range line anchors, and rejects nonsense", () => {
    const make = (line: string): string =>
      `---\nauthor: a@b.co\nrevision: ${SHA_A}\nfile: src/x.c\nline: ${line}\n---\n\nnote\n`;
    for (const line of ["142", "140-145", "1"]) {
      assert.deepEqual(validateComment(parseFile(make(line)), { onPr: true }), [], line);
    }
    for (const line of ["0", "-3", "145-140", "abc", "1.5"]) {
      assert.match(
        messages(validateComment(parseFile(make(line)), { onPr: true })),
        /'line' must be/,
        line,
      );
    }
  });

  it("requires reply-to to be a Navbook ID", () => {
    const text = "---\nauthor: a@b.co\nreply-to: nope\n---\n\nhi\n";
    assert.match(
      messages(validateComment(parseFile(text), { onPr: false })),
      /'reply-to' must be a Navbook ID/,
    );
  });
});

describe("constructors", () => {
  it("renders an issue that validates and reads back identically", () => {
    const text = newIssueFile({
      title: "Login times out",
      author: "Alice Smith <alice@example.com>",
      created: "2026-08-02T09:14:00Z",
      body: "Login POST aborts.",
      labels: ["bug", "auth"],
      assignee: ["ked@example.com"],
      milestone: "v1",
    });
    const parsed = parseFile(text);
    assert.deepEqual(validateIssue(parsed), []);
    assert.deepEqual(readLabels(parsed.fm), ["bug", "auth"]);
    assert.deepEqual(readAssignees(parsed.fm), ["ked@example.com"]);
    assert.equal(parsed.fm.milestone, "v1");
    assert.equal(parsed.body, "\nLogin POST aborts.\n");
  });

  it("renders multiple assignees as a list", () => {
    const text = newIssueFile({
      title: "t",
      author: "a@b.co",
      created: "2026-01-01",
      body: "b",
      assignee: ["a@b.co", "c@d.co"],
    });
    assert.match(text, /assignee: \[a@b\.co, c@d\.co\]/);
  });

  it("records the parent of an issue opened as a subtask", () => {
    const text = newIssueFile({
      title: "t",
      author: "a@b.co",
      created: "2026-01-01",
      body: "b",
      parent: "bqlybac0",
    });
    assert.match(text, /^parent: bqlybac0$/m);
    assert.deepEqual(validateIssue(parseFile(text)), []);
    // The parent's side of the link is the operation's business, not the file's.
    assert.equal(text.includes("subtasks"), false);
  });

  it("renders a pull request that validates", () => {
    const text = newPrFile({
      title: "Refactor auth",
      author: "ked@example.com",
      created: "2026-08-04T16:40:00Z",
      target: "main",
      source: "feat/auth",
      revisions: [{ head: SHA_A, base: SHA_B, date: "2026-08-04T16:40:00Z" }],
      body: "Replaces the cache.",
      draft: true,
    });
    const parsed = parseFile(text);
    assert.deepEqual(validatePr(parsed), []);
    assert.equal(parsed.fm.draft, true);
    assert.deepEqual(readRevisions(parsed.fm), [
      { head: SHA_A, base: SHA_B, date: "2026-08-04T16:40:00Z" },
    ]);
  });

  it("writes one reviewer as a scalar and several as a flow list", () => {
    const render = (reviewers: string[]): string =>
      newPrFile({
        title: "Refactor auth",
        author: "ked@example.com",
        created: "2026-08-04T16:40:00Z",
        target: "main",
        source: "feat/auth",
        revisions: [{ head: SHA_A, base: SHA_B, date: "2026-08-04T16:40:00Z" }],
        body: "Replaces the cache.",
        reviewers,
      });
    assert.match(render(["alice@example.com"]), /^reviewer: alice@example\.com$/m);
    assert.match(
      render(["alice@example.com", "bo@example.com"]),
      /^reviewer: \[alice@example\.com, bo@example\.com\]$/m,
    );
    assert.equal(render([]).includes("reviewer"), false);
    assert.deepEqual(validatePr(parseFile(render(["alice@example.com", "bo@example.com"]))), []);
  });

  it("renders a review comment that validates", () => {
    const text = newCommentFile({
      author: "alice@example.com",
      body: "Off-by-one.",
      verdict: "request-changes",
      revision: SHA_A,
      file: "src/auth/login.c",
      line: "142",
    });
    assert.deepEqual(validateComment(parseFile(text), { onPr: true }), []);
    assert.match(text, /line: 142\n/, "a plain integer line stays an integer");
  });

  it("keeps a range line anchor as a string", () => {
    const text = newCommentFile({
      author: "a@b.co",
      body: "x",
      revision: SHA_A,
      file: "f",
      line: "140-145",
    });
    assert.equal(parseFile(text).fm.line, "140-145");
  });
});

describe("normalizeBody", () => {
  it("trims trailing whitespace to exactly one newline", () => {
    assert.equal(normalizeBody("text\n\n\n  \n"), "text\n");
    assert.equal(normalizeBody("text"), "text\n");
  });

  it("leaves an empty body empty", () => {
    assert.equal(normalizeBody("   \n\n"), "");
  });

  it("preserves interior blank lines", () => {
    assert.equal(normalizeBody("one\n\ntwo\n"), "one\n\ntwo\n");
  });
});
