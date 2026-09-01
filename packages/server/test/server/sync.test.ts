/**
 * The clone, kept in step with origin — spec 06 §6.3.
 *
 * These are the tests that distinguish a server that owns a clone from one that
 * owns a database: work done elsewhere has to become visible, and work done
 * here has to leave.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type Harness, ok, startHarness } from "../helpers/harness.ts";
import { makeFixture, originSubjects, serverCommand } from "../helpers/temprepo.ts";

const OPEN = `mutation Open($title: String!) {
  openIssue(input: { title: $title, body: "x" }) {
    issue { id title }
    commit { committed pushed }
  }
}`;

interface OpenResult {
  openIssue: {
    issue: { id: string; title: string };
    commit: { committed: boolean; pushed: boolean };
  };
}

describe("synchronising with origin", () => {
  let h: Harness;

  before(async () => {
    // Every read fetches, so what the peer pushes is visible immediately
    // rather than after the staleness window.
    h = await startHarness({ pullIntervalMs: 0 });
  });

  after(async () => {
    await h.stop();
  });

  it("sees an issue somebody else pushed", async () => {
    h.fixture.peer.fileIssue("Filed from a terminal", "Not through the API.", "pe111111");
    const pushed = h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]);
    assert.equal(pushed.code, 0, pushed.stderr);

    const data = ok<{ issues: { id: string; title: string }[] }>(
      await h.gql(`query { issues { id title } }`),
    );
    assert.deepEqual(data.issues, [{ id: "pe111111", title: "Filed from a terminal" }]);
  });

  it("merges what arrived and keeps both changes when the two race", async () => {
    // The peer commits and pushes without the server knowing.
    h.fixture.peer.fileIssue("Theirs", "From the terminal.", "pe222222");
    assert.equal(h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]).code, 0);

    // The server's own mutation now has to pull before it writes.
    const mine = ok<OpenResult>(await h.gql(OPEN, { title: "Ours" })).openIssue;
    assert.equal(mine.commit.pushed, true);

    // Both are in the server's tree...
    const listed = ok<{ issues: { title: string }[] }>(await h.gql(`query { issues { title } }`));
    const titles = listed.issues.map((issue) => issue.title);
    assert.ok(titles.includes("Theirs"), titles.join(", "));
    assert.ok(titles.includes("Ours"), titles.join(", "));

    // ...and both reached origin.
    const subjects = originSubjects(h.fixture.origin);
    assert.ok(subjects.some((s) => s === `docs(issue): open #${mine.issue.id}`));
    assert.ok(subjects.some((s) => s === "docs(issue): open #pe222222"));
  });

  it("keeps landing mutations as the remote goes on moving", async () => {
    // The refusal-and-retry path itself cannot be provoked from out here — it
    // needs a push to arrive between this server's own pull and its push —
    // so `test/unit/sync.test.ts` drives that matrix with injected git.
    const before = originSubjects(h.fixture.origin).length;
    h.fixture.peer.git(["fetch", "--quiet", "origin"]);
    h.fixture.peer.git(["merge", "--quiet", "--no-edit", "origin/main"]);
    h.fixture.peer.fileIssue("Racing", "Pushed mid-flight.", "pe333333");
    assert.equal(h.fixture.peer.git(["push", "--quiet", "origin", "main:main"]).code, 0);

    const mine = ok<OpenResult>(await h.gql(OPEN, { title: "Also racing" })).openIssue;
    assert.equal(mine.commit.pushed, true);
    assert.ok(originSubjects(h.fixture.origin).length > before + 1);
  });
});

describe("without a remote", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ noRemote: true });
  });

  after(async () => {
    await h.stop();
  });

  it("says on startup that nothing will be pushed", () => {
    assert.match(h.stderr(), /no 'origin' remote; running local-only/);
  });

  it("commits without pushing, and says so", async () => {
    const result = ok<OpenResult>(await h.gql(OPEN, { title: "Local only" })).openIssue;
    assert.equal(result.commit.committed, true);
    assert.equal(result.commit.pushed, false);

    const subject = h.fixture.server.git(["log", "-1", "--format=%s"]).stdout.trim();
    assert.equal(subject, `docs(issue): open #${result.issue.id}`);
  });

  it("still reads and writes normally", async () => {
    const opened = ok<OpenResult>(await h.gql(OPEN, { title: "Offline work" })).openIssue;
    const data = ok<{ issue: { title: string } }>(
      await h.gql(`query Q($ref: ID!) { issue(ref: $ref) { title } }`, { ref: opened.issue.id }),
    );
    assert.equal(data.issue.title, "Offline work");
  });
});

describe("a clone that cannot be served", () => {
  /** Start the server against `dir` and return how it refused. */
  const attempt = (
    dir: string,
    env: NodeJS.ProcessEnv = {},
  ): { status: number; stderr: string } => {
    const [command, ...leading] = serverCommand();
    const result = spawnSync(
      command as string,
      [
        ...leading,
        "--repo",
        dir,
        "--port",
        "0",
        "--oidc-issuer",
        "https://issuer.invalid",
        "--oidc-audience",
        "test",
        "--oidc-jwks-url",
        "https://issuer.invalid/jwks",
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...env } },
    );
    return { status: result.status ?? 1, stderr: result.stderr ?? "" };
  };

  it("refuses a repository with no .navbook/", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-bare-"));
    try {
      spawnSync("git", ["init", "--quiet", "-b", "main", dir]);
      const result = attempt(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /is not a Navbook repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a directory that is not a repository at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-nogit-"));
    try {
      assert.equal(attempt(dir).status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a clone with uncommitted changes", () => {
    // Every mutation commits, and --commit refuses while unrelated work is
    // staged (spec 04 §4.2), so a dirty clone would fail every write. Better
    // to say so at startup than on somebody's first issue.
    const fixture = makeFixture();
    try {
      fixture.server.write("stray.txt", "not committed\n");
      const result = attempt(fixture.server.dir, fixture.env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /uncommitted changes/);
    } finally {
      fixture.cleanup();
    }
  });

  it("refuses a detached HEAD", () => {
    const fixture = makeFixture();
    try {
      const head = fixture.server.git(["rev-parse", "HEAD"]).stdout.trim();
      fixture.server.git(["checkout", "--quiet", "--detach", head]);
      const result = attempt(fixture.server.dir, fixture.env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /HEAD is detached/);
    } finally {
      fixture.cleanup();
    }
  });

  it("refuses to start without the options it cannot invent", () => {
    const [command, ...leading] = serverCommand();
    const result = spawnSync(command as string, [...leading, "--port", "0"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr ?? "", /missing required option --oidc-issuer/);
    // And says how, rather than only that it will not.
    assert.match(result.stderr ?? "", /Usage: nav-server/);
  });
});
