/**
 * What a pull request proposes, read from the two SHAs its revision pins.
 *
 * The pull request lives on a branch the server has only fetched, which is
 * the ordinary case (spec 03 §3.5) and the one worth proving: the commits and
 * the diff are read from the object store, so a branch that is not checked
 * out answers exactly as one that is.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeWsCtx, updatePr } from "@navbook/core";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";

interface Changes {
  base: string;
  head: string;
  additions: number;
  deletions: number;
  files: {
    path: string;
    oldPath: string | null;
    status: string;
    additions: number;
    deletions: number;
    binary: boolean;
    lines: number;
    patch: string | null;
    truncated: boolean;
  }[];
}

interface Commits {
  total: number;
  commits: { sha: string; subject: string; author: string; date: string }[];
}

describe("a pull request's commits and changes", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ pullIntervalMs: 0 });
    const { peer } = h.fixture;
    peer.write("src/app.ts", "const a = 1;\nconst b = 2;\n");
    peer.commitAll("chore: seed");
    peer.git(["push", "--quiet", "origin", "main:main"]);
    // A commit of its own first, on a scratch branch the pull request's branch
    // is then made from; the pull request is opened on top, and re-pinned so
    // its own opening commit is part of the revision, as a `nav pr update`
    // after a round of review would make it.
    peer.git(["checkout", "--quiet", "-b", "work"]);
    peer.write("src/app.ts", "const a = 1;\nconst b = 3;\n");
    peer.commitAll("fix: b is three");
    peer.filePr("Fix the login", "Here is the change.", "pr111111", "fix-login");
    peer.git(["checkout", "--quiet", "fix-login"]);
    updatePr(makeWsCtx({ cwd: peer.dir, env: h.fixture.env }), "pr111111", { commit: true });
    peer.git(["checkout", "--quiet", "main"]);
    const pushed = peer.git(["push", "--quiet", "origin", "fix-login:fix-login"]);
    assert.equal(pushed.code, 0, pushed.stderr);
  });

  after(async () => {
    await h.stop();
  });

  it("lists the commits the revision introduces, oldest first", async () => {
    const data = ok<{ pr: { commits: Commits } }>(
      await h.gql(
        `query Q($ref: ID!) { pr(ref: $ref) { commits { total commits { sha subject author date } } } }`,
        { ref: "pr111111" },
      ),
    );
    assert.equal(data.pr.commits.total, 3);
    assert.deepEqual(
      data.pr.commits.commits.map((c) => c.subject),
      ["fix: b is three", "feat: Fix the login", "docs(pr): open #pr111111"],
    );
    assert.equal(data.pr.commits.commits.at(-1)?.sha.length, 40);
    assert.equal(data.pr.commits.commits[0]?.author, "Nav Server <server@test.invalid>");
    assert.match(data.pr.commits.commits[0]?.date ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("keeps the oldest when limited, and says how many there are", async () => {
    const data = ok<{ pr: { commits: Commits } }>(
      await h.gql(
        `query Q($ref: ID!) { pr(ref: $ref) { commits(limit: 1) { total commits { subject } } } }`,
        {
          ref: "pr111111",
        },
      ),
    );
    assert.equal(data.pr.commits.total, 3);
    assert.deepEqual(
      data.pr.commits.commits.map((c) => c.subject),
      ["fix: b is three"],
    );
  });

  it("diffs the revision against its merge base, tracker files last", async () => {
    const data = ok<{ pr: { changes: Changes } }>(
      await h.gql(
        `query Q($ref: ID!) { pr(ref: $ref) { changes {
           base head additions deletions
           files { path oldPath status additions deletions binary lines patch truncated }
         } } }`,
        { ref: "pr111111" },
      ),
    );
    const { changes } = data.pr;
    assert.match(changes.base, /^[0-9a-f]{40}$/);
    assert.match(changes.head, /^[0-9a-f]{40}$/);
    assert.deepEqual(
      changes.files.map((f) => [f.path, f.status, f.additions, f.deletions]),
      [
        ["fix-login.txt", "ADDED", 1, 0],
        ["src/app.ts", "MODIFIED", 1, 1],
        [".navbook/prs/open/pr111111-fix-the-login/pr.md", "ADDED", changes.files[2]?.additions, 0],
      ],
    );
    assert.equal(
      changes.files[1]?.patch,
      "@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n",
    );
    assert.equal(changes.files[1]?.lines, 4);
    assert.equal(changes.files[1]?.truncated, false);
    assert.equal(
      changes.additions,
      changes.files.reduce((n, f) => n + f.additions, 0),
    );
    assert.equal(changes.deletions, 1);
  });

  it("answers one file by path", async () => {
    const data = ok<{ pr: { changes: Changes } }>(
      await h.gql(
        `query Q($ref: ID!, $paths: [String!]) { pr(ref: $ref) { changes(paths: $paths) { files { path patch } } } }`,
        { ref: "pr111111", paths: ["src/app.ts"] },
      ),
    );
    assert.deepEqual(
      data.pr.changes.files.map((f) => f.path),
      ["src/app.ts"],
    );
    assert.match(data.pr.changes.files[0]?.patch ?? "", /\+const b = 3;/);
  });

  it("is empty for a pull request that recorded no revision", async () => {
    // Hand-written, as the format allows: a pr.md with no `revisions:` at all.
    h.fixture.peer.write(
      ".navbook/prs/open/pr222222-no-revision/pr.md",
      [
        "---",
        "title: No revision yet",
        "author: Someone <someone@example.invalid>",
        "created: 2026-08-01T10:00:00Z",
        "target: main",
        "---",
        "",
        "Nothing pinned.",
        "",
      ].join("\n"),
    );
    h.fixture.peer.commitAll("docs(pr): open #pr222222");
    h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]);
    const data = ok<{ pr: { commits: Commits; changes: Changes } }>(
      await h.gql(
        `query Q($ref: ID!) { pr(ref: $ref) { commits { total commits { sha } } changes { files { path } additions } } }`,
        { ref: "pr222222" },
      ),
    );
    assert.deepEqual(data.pr.commits, { total: 0, commits: [] });
    assert.deepEqual(data.pr.changes, { files: [], additions: 0 });
  });

  it("refuses a revision whose commits this clone does not have", async () => {
    h.fixture.peer.write(
      ".navbook/prs/open/pr333333-elsewhere/pr.md",
      [
        "---",
        "title: Pinned elsewhere",
        "author: Someone <someone@example.invalid>",
        "created: 2026-08-01T10:00:00Z",
        "target: main",
        "revisions:",
        "  - head: 0123456789012345678901234567890123456789",
        "    base: 0123456789012345678901234567890123456789",
        "    date: 2026-08-01T10:00:00Z",
        "---",
        "",
        "Its objects never reached this clone.",
        "",
      ].join("\n"),
    );
    h.fixture.peer.commitAll("docs(pr): open #pr333333");
    h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]);
    const response = await h.gql(
      `query Q($ref: ID!) { pr(ref: $ref) { changes { files { path } } } }`,
      {
        ref: "pr333333",
      },
    );
    assert.equal(errorCode(response), "MISSING_COMMIT");
  });

  it("rejects a limit that is not a count", async () => {
    const response = await h.gql(
      `query Q($ref: ID!) { pr(ref: $ref) { commits(limit: -1) { total } } }`,
      {
        ref: "pr111111",
      },
    );
    assert.equal(errorCode(response), "INVALID_INPUT");
  });
});
