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

interface Activity {
  total: number;
  commits: {
    sha: string;
    subject: string;
    date: string;
    verb: string | null;
    kind: string | null;
    entity: string | null;
    title: string | null;
    facts: { field: string; before: string | null; after: string | null }[];
    files: { path: string; status: string; tracker: boolean; patch: string | null }[];
  }[];
}

describe("a pull request's tracker commits", () => {
  let h: Harness;
  let issueDir = "";

  before(async () => {
    h = await startHarness({ pullIntervalMs: 0 });
    const { peer } = h.fixture;
    peer.fileIssue("Login is broken", "It times out.", "is111111");
    peer.git(["push", "--quiet", "origin", "main:main"]);
    // The fix and the close travel together, as the README has it; then a
    // note written by hand, whose subject follows no grammar; then the pull
    // request, re-pinned so its own opening commit is in the revision.
    peer.git(["checkout", "--quiet", "-b", "work"]);
    peer.write("src/login.ts", "export const TIMEOUT = 30;\n");
    peer.commitAll("fix: wait thirty seconds");
    peer.close("issue", "is111111", "fixed");
    const listed = peer.git(["ls-files", ".navbook/issues/closed"]).stdout.split("\n");
    issueDir = (listed.find((path) => path.endsWith("/issue.md")) ?? "").replace(
      /\/issue\.md$/,
      "",
    );
    peer.write(
      `${issueDir}/comments/2026-08-01T100000Z-cm111111.md`,
      "---\nauthor: Someone <someone@example.invalid>\n---\n\nConfirmed on 3G.\n",
    );
    peer.commitAll("Add a note by hand");
    // An old thread imported in one go: past the size a patch is sent inline.
    peer.write(
      `${issueDir}/comments/2026-08-01T110000Z-cm222222.md`,
      `---\nauthor: Someone <someone@example.invalid>\n---\n\n${Array.from({ length: 1_200 }, (_, i) => `line ${i + 1}`).join("\n")}\n`,
    );
    peer.commitAll("Import the old thread");
    peer.filePr("Fix the login timeout", "Closes #is111111.", "pr444444", "fix-timeout");
    peer.git(["checkout", "--quiet", "fix-timeout"]);
    updatePr(makeWsCtx({ cwd: peer.dir, env: h.fixture.env }), "pr444444", { commit: true });
    peer.git(["checkout", "--quiet", "main"]);
    const pushed = peer.git(["push", "--quiet", "origin", "fix-timeout:fix-timeout"]);
    assert.equal(pushed.code, 0, pushed.stderr);
  });

  after(async () => {
    await h.stop();
  });

  const query = `query Q($ref: ID!, $limit: Int!) { pr(ref: $ref) { activity(limit: $limit) {
    total commits { sha subject date verb kind entity title
      facts { field before after } files { path status tracker patch } }
  } } }`;

  it("says what each tracker commit of the revision did, oldest first", async () => {
    const data = ok<{ pr: { activity: Activity } }>(
      await h.gql(query, { ref: "pr444444", limit: 100 }),
    );
    const { total, commits } = data.pr.activity;
    assert.equal(total, 4);
    assert.deepEqual(
      commits.map((c) => [c.subject, c.verb, c.kind, c.entity, c.title]),
      [
        ["docs(issue): close #is111111", "close", "ISSUE", "is111111", "Login is broken"],
        // No grammar in the subject: the added comment file says what it was.
        ["Add a note by hand", "comment", "ISSUE", "is111111", "Login is broken"],
        ["Import the old thread", "comment", "ISSUE", "is111111", "Login is broken"],
        ["docs(pr): open #pr444444", "open", "PR", "pr444444", "Fix the login timeout"],
      ],
    );
    assert.deepEqual(commits[0]?.facts, [
      { field: "status", before: "open", after: "closed" },
      { field: "resolution", before: null, after: "fixed" },
    ]);
    assert.deepEqual(
      commits[3]?.facts.find((f) => f.field === "target"),
      { field: "target", before: null, after: "main" },
    );
    assert.match(commits[0]?.date ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("sends each commit's own tracker files, with their patches", async () => {
    const data = ok<{ pr: { activity: Activity } }>(
      await h.gql(query, { ref: "pr444444", limit: 100 }),
    );
    const close = data.pr.activity.commits[0];
    assert.deepEqual(
      close?.files.map((f) => [f.path, f.status, f.tracker]),
      [[`${issueDir}/issue.md`, "RENAMED", true]],
    );
    assert.match(close?.files[0]?.patch ?? "", /\+resolution: fixed/);
    const note = data.pr.activity.commits[1];
    assert.match(note?.files[0]?.patch ?? "", /\+Confirmed on 3G\./);
    // Past the per-file budget, as in a diff: listed, without its lines.
    const imported = data.pr.activity.commits[2]?.files[0];
    assert.equal(imported?.patch, null);
    assert.equal(imported?.status, "ADDED");
  });

  it("keeps the oldest when limited, and says how many there are", async () => {
    const data = ok<{ pr: { activity: Activity } }>(
      await h.gql(query, { ref: "pr444444", limit: 1 }),
    );
    assert.equal(data.pr.activity.total, 4);
    assert.deepEqual(
      data.pr.activity.commits.map((c) => c.verb),
      ["close"],
    );
  });

  it("marks the tracker's files in the revision's diff", async () => {
    const data = ok<{ pr: { changes: { files: { path: string; tracker: boolean }[] } } }>(
      await h.gql(`query Q($ref: ID!) { pr(ref: $ref) { changes { files { path tracker } } } }`, {
        ref: "pr444444",
      }),
    );
    const files = data.pr.changes.files;
    assert.deepEqual(
      files.filter((f) => !f.tracker).map((f) => f.path),
      ["fix-timeout.txt", "src/login.ts"],
    );
    assert.ok(files.filter((f) => f.tracker).every((f) => f.path.startsWith(".navbook/")));
    assert.ok(files.some((f) => f.tracker));
  });

  it("rejects a limit that is not a count", async () => {
    const response = await h.gql(query, { ref: "pr444444", limit: -1 });
    assert.equal(errorCode(response), "INVALID_INPUT");
  });
});
