/**
 * Opening a pull request from the API, on a branch the server does not serve.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so the server writes them there: in a temporary worktree of its
 * clone, on a local copy of the branch made from the remote, pushed and taken
 * away again. What is asserted is where every commit landed, and that nothing
 * — a worktree, a local branch — is left behind that should not be.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, originSubjects, startHarness } from "../helpers/harness.ts";
import { worktrees } from "../helpers/temprepo.ts";

const OPEN = `mutation O($input: OpenPrInput!) {
  openPr(input: $input) {
    pr {
      id title source target draft refs labels assignees reviewers milestone author body
      revisions { head base }
    }
    commit { committed subject pushed }
  }
}`;

interface Opened {
  openPr: {
    pr: {
      id: string;
      title: string;
      source: string;
      target: string;
      draft: boolean;
      refs: string[];
      labels: string[];
      assignees: string[];
      reviewers: string[];
      milestone: string | null;
      author: string;
      body: string;
      revisions: { head: string; base: string }[];
    };
    commit: { committed: boolean; subject: string; pushed: boolean };
  };
}

/** A git call that has to work, for arranging a fixture. */
function must(result: { code: number; stderr: string }): void {
  assert.equal(result.code, 0, result.stderr);
}

describe("opening a pull request", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ pullIntervalMs: 0 });
  });

  after(async () => {
    await h.stop();
  });

  /** A branch somebody pushed, as the peer, which the server has never seen. */
  function pushed(name: string): void {
    h.fixture.peer.branch(name);
    must(h.fixture.peer.git(["push", "--quiet", "origin", `${name}:${name}`]));
  }

  /** The server clone is exactly as it was: nothing checked out, nothing kept. */
  function assertTidy(...branches: string[]): void {
    assert.deepEqual(worktrees(h.fixture.server.dir), [h.fixture.server.dir]);
    for (const branch of branches) {
      assert.equal(h.fixture.server.git(["branch", "--list", branch]).stdout, "", branch);
    }
    // No copy of any branch is kept once the remote has everything on it.
    assert.equal(h.fixture.server.git(["branch", "--list", "nav-server/*"]).stdout, "");
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout, "");
  }

  it("writes it on its branch, pushes the branch, and leaves nothing behind", async () => {
    pushed("feat/api");
    const tip = h.fixture.peer.git(["rev-parse", "feat/api"]).stdout.trim();
    const base = h.fixture.peer.git(["merge-base", "feat/api", "main"]).stdout.trim();
    const mainBefore = originSubjects(h.fixture.origin, "main");

    const { pr, commit } = ok<Opened>(
      await h.gql(OPEN, {
        input: {
          source: "feat/api",
          title: "A new API",
          body: "It does the thing.",
          draft: true,
          labels: ["api"],
          assignees: ["bob@example.com"],
          reviewers: ["alice@example.com"],
          milestone: "v2",
        },
      }),
    ).openPr;

    assert.equal(pr.title, "A new API");
    assert.equal(pr.body, "It does the thing.");
    assert.equal(pr.source, "feat/api");
    // The repository's default branch, since no target was named.
    assert.equal(pr.target, "main");
    assert.equal(pr.draft, true);
    assert.deepEqual(pr.labels, ["api"]);
    assert.deepEqual(pr.assignees, ["bob@example.com"]);
    assert.deepEqual(pr.reviewers, ["alice@example.com"]);
    assert.equal(pr.milestone, "v2");
    // The person asking, not the gateway that committed it.
    assert.match(pr.author, /person@example\.invalid/);
    // Read back from where it was written.
    assert.deepEqual(pr.refs, ["feat/api"]);
    // The branch's tip as the remote had it, which the pull request is about.
    assert.deepEqual(pr.revisions, [{ head: tip, base }]);
    assert.deepEqual(commit, {
      committed: true,
      subject: `docs(pr): open #${pr.id}`,
      pushed: true,
    });

    // On the branch at origin, on top of the work; nothing on main.
    assert.deepEqual(originSubjects(h.fixture.origin, "feat/api").slice(0, 2), [
      `docs(pr): open #${pr.id}`,
      "feat: work on feat/api",
    ]);
    assert.deepEqual(originSubjects(h.fixture.origin, "main"), mainBefore);
    assertTidy("feat/api");

    // And a cross-ref listing finds it where it went.
    const listed = ok<{ prs: { id: string; refs: string[] }[] }>(
      await h.gql(`query { prs(allRefs: true) { id refs } }`),
    );
    assert.deepEqual(
      listed.prs.find((candidate) => candidate.id === pr.id),
      { id: pr.id, refs: ["origin/feat/api"] },
    );
  });

  it("can then be reviewed and patched there too", async () => {
    pushed("feat/review");
    const { pr } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "feat/review", title: "Review me", body: "Please." } }),
    ).openPr;

    const reviewed = ok<{ addComment: { comment: { verdict: string; revision: string } } }>(
      await h.gql(
        `mutation R($ref: ID!) {
           addComment(input: { kind: PR, ref: $ref, body: "Yes.", verdict: APPROVE }) {
             comment { verdict revision }
           }
         }`,
        { ref: pr.id },
      ),
    ).addComment;
    assert.equal(reviewed.comment.revision, pr.revisions[0]?.head);
    assert.deepEqual(originSubjects(h.fixture.origin, "feat/review").slice(0, 2), [
      `docs(pr): review #${pr.id}`,
      `docs(pr): open #${pr.id}`,
    ]);
    assertTidy("feat/review");
  });

  it("writes on the pull request's own branch, not on one that merged it in", async () => {
    // `zfeat` carries the pull request; `alpha`, which sorts first, merged it in.
    pushed("zfeat");
    const { pr } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "zfeat", title: "Z", body: "x" } }),
    ).openPr;
    const peer = h.fixture.peer;
    must(peer.git(["fetch", "--quiet", "origin"]));
    must(peer.git(["checkout", "--quiet", "-b", "alpha", "main"]));
    must(peer.git(["merge", "--quiet", "--no-ff", "-m", "take zfeat", "origin/zfeat"]));
    must(peer.git(["push", "--quiet", "origin", "alpha:alpha"]));
    must(peer.git(["checkout", "--quiet", "main"]));
    const alphaBefore = originSubjects(h.fixture.origin, "alpha");

    const COMMENT = `mutation C($ref: ID!) {
      addComment(input: { kind: PR, ref: $ref, body: "Where does this go?" }) {
        entity { ... on Pr { refs } }
      }
    }`;
    const commented = ok<{ addComment: { entity: { refs: string[] } } }>(
      await h.gql(COMMENT, { ref: pr.id }),
    ).addComment;
    assert.deepEqual(commented.entity.refs, ["zfeat"]);
    assert.equal(originSubjects(h.fixture.origin, "zfeat")[0], `docs(pr): comment on #${pr.id}`);
    assert.deepEqual(originSubjects(h.fixture.origin, "alpha"), alphaBefore);
    assertTidy("zfeat", "alpha");

    // Once its own branch is gone, the copy `alpha` carries is no place to write.
    must(peer.git(["push", "--quiet", "origin", "--delete", "zfeat"]));
    const refused = await h.gql(COMMENT, { ref: pr.id });
    assert.equal(errorCode(refused), "PRECONDITION");
    assert.match(refused.errors[0]?.message ?? "", /is not on 'zfeat', its source branch/);
    assert.deepEqual(originSubjects(h.fixture.origin, "alpha"), alphaBefore);
    assertTidy("zfeat", "alpha");
  });

  it("takes a title from the input, not from the branch's last commit", async () => {
    pushed("feat/title");
    const { pr } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "feat/title", title: "Mine", body: "x" } }),
    ).openPr;
    assert.equal(pr.title, "Mine");
  });

  it("targets a branch other than the default when told to", async () => {
    pushed("release");
    pushed("feat/onto-release");
    const { pr } = ok<Opened>(
      await h.gql(OPEN, {
        input: { source: "feat/onto-release", target: "release", title: "Onto release", body: "x" },
      }),
    ).openPr;
    // A target the server has never checked out is judged from the remote's copy.
    assert.equal(pr.target, "release");
    assertTidy("feat/onto-release", "release");
  });

  it("reads the target from the remote, not from a stale local branch of its name", async () => {
    // The clone has its own `rel`, made long ago and never updated since: the
    // server keeps only the branch it serves up to date.
    pushed("rel");
    const server = h.fixture.server;
    must(server.git(["fetch", "--quiet", "origin"]));
    must(server.git(["branch", "--quiet", "rel", "origin/rel"]));
    const peer = h.fixture.peer;
    must(peer.git(["checkout", "--quiet", "rel"]));
    peer.write("rel-later.txt", "later\n");
    peer.commitAll("later work on rel");
    must(peer.git(["push", "--quiet", "origin", "rel:rel"]));
    must(peer.git(["checkout", "--quiet", "-b", "feat/on-rel"]));
    peer.write("on-rel.txt", "x\n");
    peer.commitAll("work on top of rel");
    must(peer.git(["push", "--quiet", "origin", "feat/on-rel:feat/on-rel"]));
    must(peer.git(["checkout", "--quiet", "main"]));
    const base = peer.git(["rev-parse", "rel"]).stdout.trim();

    try {
      const { pr } = ok<Opened>(
        await h.gql(OPEN, {
          input: { source: "feat/on-rel", target: "rel", title: "On rel", body: "x" },
        }),
      ).openPr;
      assert.equal(pr.revisions[0]?.base, base);
    } finally {
      must(server.git(["branch", "--quiet", "-D", "rel"]));
    }
  });

  it("refuses the branch it serves, and the default branch, as a source", async () => {
    const before = originSubjects(h.fixture.origin, "main");
    pushed("stable");
    const served = await h.gql(OPEN, {
      input: { source: "main", target: "stable", title: "Main into stable", body: "x" },
    });
    assert.equal(errorCode(served), "PRECONDITION");
    assert.match(served.errors[0]?.message ?? "", /'main', the branch this server serves/);

    // A default branch other than the served one, as the remote's HEAD says.
    const server = h.fixture.server;
    must(server.git(["remote", "set-head", "origin", "stable"]));
    try {
      const fallback = await h.gql(OPEN, {
        input: { source: "stable", target: "main", title: "Stable into main", body: "x" },
      });
      assert.equal(errorCode(fallback), "PRECONDITION");
      assert.match(fallback.errors[0]?.message ?? "", /'stable', the repository's default branch/);
    } finally {
      must(server.git(["remote", "set-head", "origin", "main"]));
    }
    assert.deepEqual(originSubjects(h.fixture.origin, "main"), before);
    assertTidy("stable");
  });

  for (const [what, input, code, pattern] of [
    [
      "a branch that is not on the remote",
      { source: "never-pushed" },
      "PRECONDITION",
      /'never-pushed' is not a branch on 'origin'/,
    ],
    [
      "a branch spelt with its remote",
      { source: "origin/feat/api" },
      "PRECONDITION",
      /'origin\/feat\/api' is not a branch on 'origin'/,
    ],
    [
      "a name git would not take as a branch",
      { source: "a..b" },
      "INVALID_INPUT",
      /source 'a\.\.b' is not a branch name git accepts/,
    ],
    [
      "a revision of a branch rather than the branch",
      { source: "feat/api~1" },
      "INVALID_INPUT",
      /source 'feat\/api~1' is not a branch name git accepts/,
    ],
    [
      "a target git would read as an option",
      { source: "feat/api", target: "--octopus" },
      "INVALID_INPUT",
      /target '--octopus' is not a branch name git accepts/,
    ],
    [
      "a target that is a revision",
      { source: "feat/api", target: "HEAD~3" },
      "INVALID_INPUT",
      /target 'HEAD~3' is not a branch name git accepts/,
    ],
    [
      "a target spelt with its remote",
      { source: "feat/api", target: "origin/main" },
      "PRECONDITION",
      /'origin\/main' is not a branch on 'origin'/,
    ],
    [
      "a pull request onto its own branch",
      { source: "feat/api", target: "feat/api" },
      "PRECONDITION",
      /cannot target its own branch/,
    ],
    [
      "a target that is nowhere",
      { source: "feat/api", target: "nowhere" },
      "PRECONDITION",
      /'nowhere' is not a branch on 'origin'/,
    ],
    ["an empty title", { source: "feat/api", title: "  " }, "INVALID_INPUT", /title/],
    ["an empty body", { source: "feat/api", body: "" }, "INVALID_INPUT", /body/],
    ["an empty source", { source: " " }, "INVALID_INPUT", /source/],
  ] as const) {
    it(`refuses ${what}, and leaves nothing behind`, async () => {
      const before = originSubjects(h.fixture.origin, "feat/api");
      const response = await h.gql(OPEN, {
        input: { title: "T", body: "B", ...input },
      });
      assert.equal(errorCode(response), code, JSON.stringify(response.errors));
      assert.match(response.errors[0]?.message ?? "", pattern);
      assert.deepEqual(originSubjects(h.fixture.origin, "feat/api"), before);
      assertTidy("feat/api", "never-pushed", "nowhere");
    });
  }

  /** Push an orphan branch: the tree as main has it, with no history in common. */
  function orphan(name: string, keepTracker: boolean): void {
    const peer = h.fixture.peer;
    must(peer.git(["checkout", "--quiet", "--orphan", name]));
    if (!keepTracker) must(peer.git(["rm", "-r", "--quiet", "--cached", "."]));
    peer.write(`${name}.txt`, "alone\n");
    must(peer.git(["add", `${name}.txt`]));
    must(peer.git(["commit", "--quiet", "-m", `alone on ${name}`]));
    must(peer.git(["push", "--quiet", "origin", `${name}:${name}`]));
    must(peer.git(["checkout", "--quiet", "-f", "main"]));
    must(peer.git(["clean", "-fdq"]));
  }

  it("refuses a branch that shares no history with its target", async () => {
    orphan("island", true);
    const response = await h.gql(OPEN, { input: { source: "island", title: "T", body: "B" } });
    assert.equal(errorCode(response), "PRECONDITION");
    assert.match(response.errors[0]?.message ?? "", /shares no history/);
    assertTidy("island");
  });

  it("refuses a branch that does not carry the tracker", async () => {
    orphan("bare", false);
    const response = await h.gql(OPEN, { input: { source: "bare", title: "T", body: "B" } });
    assert.equal(errorCode(response), "PRECONDITION");
    assert.match(
      response.errors[0]?.message ?? "",
      /'bare' has no \.navbook\/ to open a pull request in/,
    );
    assertTidy("bare");
  });

  it("opens pull requests on several branches sent at once, one worktree at a time", async () => {
    const names = ["many/a", "many/b", "many/c", "many/d", "many/e"];
    for (const name of names) pushed(name);
    const results = await Promise.all(
      names.map((name) =>
        h.gql<Opened>(OPEN, { input: { source: name, title: `On ${name}`, body: "x" } }),
      ),
    );
    for (const [index, response] of results.entries()) {
      const { pr, commit } = ok(response).openPr;
      assert.equal(pr.source, names[index]);
      assert.equal(commit.pushed, true);
      assert.equal(originSubjects(h.fixture.origin, names[index])[0], `docs(pr): open #${pr.id}`);
    }
    assertTidy(...names);
  });
});

describe("opening a pull request on a branch the clone already has a copy of", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ pullIntervalMs: 0 });
  });

  after(async () => {
    await h.stop();
  });

  /** The server's own copy of `name`, which is what a write there checks out. */
  const copyOf = (name: string): string => `nav-server/${name}`;

  /**
   * Run `edit` in a worktree of the server's clone on `branch`, made from the
   * remote's `name` if it does not exist yet, and commit what it leaves.
   */
  function commitOn(branch: string, name: string, message: string, edit: (dir: string) => void) {
    const server = h.fixture.server;
    must(server.git(["fetch", "--quiet", "origin"]));
    if (server.git(["branch", "--list", branch]).stdout === "") {
      must(server.git(["branch", "--quiet", branch, `origin/${name}`]));
    }
    const dir = join(h.fixture.home, `arrange-${branch.replaceAll("/", "-")}`);
    must(server.git(["worktree", "add", "--quiet", dir, branch]));
    try {
      edit(dir);
      must(server.git(["-C", dir, "add", "--all"]));
      must(server.git(["-C", dir, "commit", "--quiet", "--allow-empty", "-m", message]));
    } finally {
      must(server.git(["worktree", "remove", "--force", dir]));
    }
  }

  /**
   * Leave the server's copy of `name` one commit ahead of the remote — what a
   * refused or stopped push leaves behind.
   */
  function localCommitOn(name: string, file: string, content: string): void {
    commitOn(copyOf(name), name, `local work on ${name}`, (dir) => {
      writeFileSync(join(dir, file), content);
    });
  }

  function pushedByPeer(name: string): void {
    h.fixture.peer.branch(name);
    must(h.fixture.peer.git(["push", "--quiet", "origin", `${name}:${name}`]));
  }

  it("carries a commit its own copy has and the remote lacks", async () => {
    pushedByPeer("ahead");
    commitOn(copyOf("ahead"), "ahead", "unpushed", () => undefined);

    const { pr, commit } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "ahead", title: "Ahead", body: "x" } }),
    ).openPr;
    assert.equal(commit.pushed, true);
    assert.deepEqual(originSubjects(h.fixture.origin, "ahead").slice(0, 2), [
      `docs(pr): open #${pr.id}`,
      "unpushed",
    ]);
    // Everything reached the remote, so the copy went.
    assert.equal(h.fixture.server.git(["branch", "--list", copyOf("ahead")]).stdout, "");
  });

  it("leaves the clone's own branches alone: never pushed from, never deleted", async () => {
    // An operator's branch with work nobody meant to publish, and one that is
    // simply the remote's — the clone's original local branch, say.
    pushedByPeer("theirs");
    pushedByPeer("level");
    commitOn("theirs", "theirs", "not for publishing", () => undefined);
    const server = h.fixture.server;
    must(server.git(["branch", "--quiet", "level", "origin/level"]));
    const theirs = server.git(["rev-parse", "theirs"]).stdout.trim();
    const level = server.git(["rev-parse", "level"]).stdout.trim();

    for (const name of ["theirs", "level"]) {
      const { pr, commit } = ok<Opened>(
        await h.gql(OPEN, { input: { source: name, title: name, body: "x" } }),
      ).openPr;
      assert.equal(commit.pushed, true);
      assert.equal(originSubjects(h.fixture.origin, name)[0], `docs(pr): open #${pr.id}`);
    }
    assert.ok(!originSubjects(h.fixture.origin, "theirs").includes("not for publishing"));
    assert.equal(server.git(["rev-parse", "theirs"]).stdout.trim(), theirs);
    assert.equal(server.git(["rev-parse", "level"]).stdout.trim(), level);
    assert.equal(server.git(["branch", "--list", "nav-server/*"]).stdout, "");
  });

  it("merges a copy that diverged from the remote before writing", async () => {
    pushedByPeer("diverged");
    localCommitOn("diverged", "server-side.txt", "from the server\n");
    // Somebody pushes to the branch meanwhile, touching another file.
    const peer = h.fixture.peer;
    must(peer.git(["checkout", "--quiet", "diverged"]));
    peer.write("peer-side.txt", "from the peer\n");
    peer.commitAll("peer work on diverged");
    must(peer.git(["push", "--quiet", "origin", "diverged:diverged"]));
    must(peer.git(["checkout", "--quiet", "main"]));

    const { pr, commit } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "diverged", title: "Diverged", body: "x" } }),
    ).openPr;
    assert.equal(commit.pushed, true);
    const subjects = originSubjects(h.fixture.origin, "diverged");
    assert.equal(subjects[0], `docs(pr): open #${pr.id}`);
    assert.ok(
      subjects.includes("Merge remote-tracking branch 'origin/diverged'"),
      subjects.join("\n"),
    );
    assert.ok(subjects.includes("local work on diverged"));
    assert.ok(subjects.includes("peer work on diverged"));
    assert.deepEqual(worktrees(h.fixture.server.dir), [h.fixture.server.dir]);
  });

  it("reports a copy that conflicts with the remote, keeps it, and leaves no worktree", async () => {
    pushedByPeer("clash");
    localCommitOn("clash", "clash.txt", "the server's version\n");
    const peer = h.fixture.peer;
    must(peer.git(["checkout", "--quiet", "clash"]));
    peer.write("clash.txt", "the peer's version\n");
    peer.commitAll("peer version of clash");
    must(peer.git(["push", "--quiet", "origin", "clash:clash"]));
    must(peer.git(["checkout", "--quiet", "main"]));

    const originBefore = originSubjects(h.fixture.origin, "clash");
    const response = await h.gql(OPEN, { input: { source: "clash", title: "Clash", body: "x" } });
    assert.equal(errorCode(response), "SYNC_CONFLICT");
    assert.equal(response.errors[0]?.extensions?.keptLocalCommit, false);
    assert.deepEqual(originSubjects(h.fixture.origin, "clash"), originBefore);
    assert.deepEqual(worktrees(h.fixture.server.dir), [h.fixture.server.dir]);
    // The copy still carries the server's commit, for an operator to reconcile.
    assert.equal(
      h.fixture.server.git(["log", "-1", "--format=%s", copyOf("clash")]).stdout.trim(),
      "local work on clash",
    );
    assert.match(h.stderr(), /kept 'nav-server\/clash', the server's copy of 'clash'/);
    // And the served branch was never touched by the aborted merge.
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout, "");
  });

  it("refuses when somebody else's worktree holds its copy, and not when one holds theirs", async () => {
    pushedByPeer("held");
    const server = h.fixture.server;
    must(server.git(["fetch", "--quiet", "origin"]));
    const dir = join(h.fixture.home, "somebody-else");
    must(server.git(["worktree", "add", "--quiet", "-b", copyOf("held"), dir, "origin/held"]));
    try {
      const response = await h.gql(OPEN, { input: { source: "held", title: "Held", body: "x" } });
      assert.equal(errorCode(response), "PRECONDITION");
      assert.match(
        response.errors[0]?.message ?? "",
        /'nav-server\/held' is checked out in .*somebody-else/,
      );
      // Theirs is left exactly where it was.
      assert.ok(existsSync(dir));
    } finally {
      must(server.git(["worktree", "remove", "--force", dir]));
      must(server.git(["branch", "--quiet", "-D", copyOf("held")]));
    }

    // The operator's own checkout of the branch is no business of the server's.
    must(server.git(["worktree", "add", "--quiet", "-b", "held", dir, "origin/held"]));
    try {
      const { commit } = ok<Opened>(
        await h.gql(OPEN, { input: { source: "held", title: "Held", body: "x" } }),
      ).openPr;
      assert.equal(commit.pushed, true);
    } finally {
      must(server.git(["worktree", "remove", "--force", dir]));
    }
  });

  it("prunes a worktree that is registered but gone, and writes", async () => {
    pushedByPeer("vanished");
    const server = h.fixture.server;
    must(server.git(["fetch", "--quiet", "origin"]));
    const dir = join(h.fixture.home, "vanished");
    must(
      server.git(["worktree", "add", "--quiet", "-b", copyOf("vanished"), dir, "origin/vanished"]),
    );
    rmSync(dir, { recursive: true, force: true });

    const { commit } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "vanished", title: "Vanished", body: "x" } }),
    ).openPr;
    assert.equal(commit.pushed, true);
    assert.deepEqual(worktrees(server.dir), [server.dir]);
  });
});

describe("opening a pull request without a remote", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({
      noRemote: true,
      pullIntervalMs: 0,
      prepare: (fixture) => fixture.server.branch("feat/local"),
    });
  });

  after(async () => {
    await h.stop();
  });

  it("commits on the clone's own branch and says it was not pushed", async () => {
    const { pr, commit } = ok<Opened>(
      await h.gql(OPEN, { input: { source: "feat/local", title: "Local", body: "x" } }),
    ).openPr;
    assert.deepEqual(commit, {
      committed: true,
      subject: `docs(pr): open #${pr.id}`,
      pushed: false,
    });
    assert.equal(
      h.fixture.server.git(["log", "-1", "--format=%s", "feat/local"]).stdout.trim(),
      `docs(pr): open #${pr.id}`,
    );
    // The branch is the clone's own, so it stays; only the worktree goes.
    assert.deepEqual(worktrees(h.fixture.server.dir), [h.fixture.server.dir]);
  });

  it("refuses a branch the clone does not have", async () => {
    const response = await h.gql(OPEN, { input: { source: "absent", title: "T", body: "B" } });
    assert.equal(errorCode(response), "PRECONDITION");
    assert.match(response.errors[0]?.message ?? "", /no branch 'absent' in the server's clone/);
  });
});

describe("temporary worktrees an earlier run left", () => {
  let h: Harness;
  let leftover: string;
  let kept: string;

  before(async () => {
    h = await startHarness({
      pullIntervalMs: 0,
      prepare: (fixture) => {
        const scratch = join(fixture.home, "tmp");
        mkdirSync(scratch, { recursive: true });
        leftover = join(scratch, "nav-server-wt-feat-x-AbC123");
        kept = join(scratch, "someone-elses");
        must(fixture.server.git(["worktree", "add", "--quiet", "-b", "left", leftover, "main"]));
        must(fixture.server.git(["worktree", "add", "--quiet", "-b", "theirs", kept, "main"]));
      },
    });
  });

  after(async () => {
    await h.stop();
  });

  it("are removed at startup, and nothing else is", () => {
    assert.match(
      h.stderr(),
      /removed a temporary worktree an earlier run left at .*nav-server-wt-feat-x-AbC123/,
    );
    assert.equal(existsSync(leftover), false);
    assert.deepEqual(worktrees(h.fixture.server.dir), [h.fixture.server.dir, kept]);
    // The branch it had checked out is left: it may carry something unpushed.
    assert.notEqual(h.fixture.server.git(["branch", "--list", "left"]).stdout, "");
  });
});
