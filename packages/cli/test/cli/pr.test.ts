/**
 * Pull-request behavior that needs a real repository with branches: merges in
 * all their shapes, cross-branch discovery, and the history-based checks.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  deterministicEnv,
  FIXTURE_IDENTITY,
  makeNavRepo,
  navCommand,
  type RunResult,
  type TempRepo,
} from "../helpers/temprepo.ts";

/** Run the CLI somewhere other than the repository root — a worktree, say. */
function navIn(cwd: string, home: string, args: string[]): RunResult {
  const command = navCommand();
  const result = spawnSync(command[0] as string, [...command.slice(1), ...args], {
    cwd,
    encoding: "utf8",
    env: deterministicEnv(home),
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface Scenario {
  repo: TempRepo;
  /** SHA of the feature branch tip that the PR pinned. */
  head: string;
}

/**
 * A repository with `main`, a `feat/auth` branch, and an open PR on it.
 * `advanceMain` makes the branches diverge so a merge cannot fast-forward.
 */
function withOpenPr(opts: { advanceMain?: boolean; commitPr?: boolean } = {}): Scenario {
  const repo = makeNavRepo();
  repo.write("app.txt", "original\n");
  repo.commitAll("feat: initial code");

  repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
  repo.write("auth.txt", "token handling\n");
  repo.commitAll("feat: rework auth tokens");
  const head = repo.git(["rev-parse", "HEAD"]).stdout.trim();

  const args = ["pr", "open", "--title", "Refactor auth", "-m", "Body."];
  if (opts.commitPr !== false) args.push("--commit");
  const opened = repo.nav(args, { NAV_IDS: "dk3mp2x9", NAV_NOW: "2026-08-04T16:40:00Z" });
  assert.equal(opened.code, 0, opened.stderr);

  repo.git(["checkout", "--quiet", "main"]);
  if (opts.advanceMain) {
    repo.write("other.txt", "unrelated\n");
    repo.commitAll("feat: unrelated work on main");
  }
  return { repo, head };
}

/** One comment file of the fixture pull request, by its `<stamp>-<id>` name. */
function commentFile(repo: TempRepo, name: string): string {
  return readFileSync(
    join(repo.dir, `.navbook/prs/open/dk3mp2x9-refactor-auth/comments/${name}.md`),
    "utf8",
  );
}

/** The fixture pull request's own file, as `repo.write` addresses it. */
const PR_PATH = ".navbook/prs/open/dk3mp2x9-refactor-auth/pr.md";

/** Declare a review policy in the marker, on the branch checked out now. */
function declarePolicy(repo: TempRepo, review: unknown): void {
  repo.write(".navbook/navbook.json", `${JSON.stringify({ version: 1, review }, null, 2)}\n`);
  repo.commitAll("chore: declare a review policy");
}

/** Approve the fixture pull request as somebody, from its own branch. */
function approveAs(repo: TempRepo, email: string, id: string): void {
  repo.git(["config", "user.email", email]);
  const result = repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Fine by me.", "--commit"], {
    NAV_IDS: id,
    NAV_NOW: "2026-08-06T10:00:00Z",
  });
  assert.equal(result.code, 0, result.stderr);
  repo.git(["config", "user.email", FIXTURE_IDENTITY.email]);
}

/** `git rev-list --left-right --count a...b`: commits only `a` has, then only `b`. */
function branchesApart(repo: TempRepo, a: string, b: string): string {
  return repo.git(["rev-list", "--left-right", "--count", `${a}...${b}`]).stdout.trim();
}

function prFile(repo: TempRepo, status: string): string {
  return readFileSync(
    join(repo.dir, `.navbook/prs/${status}/dk3mp2x9-refactor-auth/pr.md`),
    "utf8",
  );
}

describe("nav pr open", () => {
  it("pins the head and merge base, and names the source and target", () => {
    const { repo, head } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const text = prFile(repo, "open");
      assert.match(text, new RegExp(`head: ${head}`));
      assert.match(text, /target: main/);
      assert.match(text, /source: feat\/auth/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses on a detached HEAD, where there is no source branch to name", () => {
    const repo = makeNavRepo();
    try {
      repo.write("app.txt", "x\n");
      repo.commitAll("feat: code");
      repo.git(["checkout", "--quiet", "--detach", "HEAD"]);
      const result = repo.nav(["pr", "open", "--title", "T", "-m", "B."]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /detached/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a target branch that does not exist", () => {
    const repo = makeNavRepo();
    try {
      repo.write("app.txt", "x\n");
      repo.commitAll("feat: code");
      repo.git(["checkout", "--quiet", "-b", "feat/x"]);
      const result = repo.nav(["pr", "open", "--target", "nope", "--title", "T", "-m", "B."]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /does not exist/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr review", () => {
  it("binds to the latest revision, and an older one on request", () => {
    const { repo, head } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.write("auth.txt", "token handling\nfix\n");
      repo.commitAll("fix: address review");
      repo.nav(["pr", "update", "dk3m", "--commit"], { NAV_NOW: "2026-08-06T09:00:00Z" });
      const second = repo.git(["rev-parse", "HEAD~1"]).stdout.trim();

      repo.nav(["pr", "review", "dk3m", "--approve", "-m", "LGTM.", "--commit"], {
        NAV_IDS: "aaa11111",
        NAV_NOW: "2026-08-06T10:00:00Z",
      });
      const latest = readFileSync(
        join(
          repo.dir,
          ".navbook/prs/open/dk3mp2x9-refactor-auth/comments/2026-08-06T100000Z-aaa11111.md",
        ),
        "utf8",
      );
      assert.match(latest, new RegExp(`revision: ${second}`), "defaults to the newest revision");

      repo.nav(
        [
          "pr",
          "review",
          "dk3m",
          "--approve",
          "-m",
          "Old.",
          "--revision",
          head.slice(0, 8),
          "--commit",
        ],
        {
          NAV_IDS: "bbb22222",
          NAV_NOW: "2026-08-06T11:00:00Z",
        },
      );
      const older = readFileSync(
        join(
          repo.dir,
          ".navbook/prs/open/dk3mp2x9-refactor-auth/comments/2026-08-06T110000Z-bbb22222.md",
        ),
        "utf8",
      );
      assert.match(older, new RegExp(`revision: ${head}`));
      assert.equal(repo.nav(["doctor"]).code, 0, "both verdicts name recorded revisions");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a revision the pull request never recorded", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav([
        "pr",
        "review",
        "dk3m",
        "--approve",
        "-m",
        "x",
        "--revision",
        "deadbeef",
      ]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no recorded revision starting with/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses two verdicts at once", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav([
        "pr",
        "review",
        "dk3m",
        "--approve",
        "--request-changes",
        "-m",
        "x",
      ]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not several/);
    } finally {
      repo.cleanup();
    }
  });

  it("records the verdict that judges nothing when no flag names one", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav(["pr", "review", "dk3m", "-m", "Read it.", "--commit"], {
        NAV_IDS: "ccc33333",
        NAV_NOW: "2026-08-06T10:00:00Z",
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Reviewed \(comment\)/);
      assert.match(commentFile(repo, "2026-08-06T100000Z-ccc33333"), /^verdict: comment$/m);
      assert.equal(repo.nav(["doctor"]).code, 0, "the third verdict is well-formed");
    } finally {
      repo.cleanup();
    }
  });

  it("leaves an inline anchor unjudged, since it reads one line and not a revision", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(
        ["pr", "review", "dk3m", "--file", "auth.txt", "--line", "1", "-m", "> x", "--commit"],
        { NAV_IDS: "ddd44444", NAV_NOW: "2026-08-06T10:00:00Z" },
      );
      const text = commentFile(repo, "2026-08-06T100000Z-ddd44444");
      assert.equal(text.includes("verdict:"), false);
      assert.match(text, /^file: auth\.txt$/m, "but it is still anchored and bound");
      assert.match(text, /^revision: /m);
    } finally {
      repo.cleanup();
    }
  });

  it("judges an anchored comment when a flag says to", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(
        [
          "pr",
          "review",
          "dk3m",
          "--request-changes",
          "--file",
          "auth.txt",
          "--line",
          "1-2",
          "-m",
          "Off by one.",
          "--commit",
        ],
        { NAV_IDS: "eee55555", NAV_NOW: "2026-08-06T10:00:00Z" },
      );
      const text = commentFile(repo, "2026-08-06T100000Z-eee55555");
      assert.match(text, /^verdict: request-changes$/m);
      assert.match(text, /^line: 1-2$/m);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr request", () => {
  it("asks one person, and says so in the file and the commit", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Asked to review #dk3mp2x9: alice@example\.com/);
      assert.match(prFile(repo, "open"), /^reviewer: alice@example\.com$/m);
      assert.match(
        repo.git(["log", "-1", "--pretty=%s"]).stdout,
        /docs\(pr\): request review #dk3mp2x9/,
      );
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("asks several at once, and adds to a list that exists", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      const result = repo.nav([
        "pr",
        "request",
        "dk3m",
        "bo@example.com",
        "cy@example.com",
        "--commit",
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(
        prFile(repo, "open"),
        /^reviewer: \[alice@example\.com, bo@example\.com, cy@example\.com\]$/m,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("takes somebody off, naming the commit for what it did", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "bo@example.com", "--commit"]);
      const result = repo.nav([
        "pr",
        "request",
        "dk3m",
        "alice@example.com",
        "--remove",
        "--commit",
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No longer reviewing #dk3mp2x9: alice@example\.com/);
      assert.match(prFile(repo, "open"), /^reviewer: bo@example\.com$/m);
      assert.match(repo.git(["log", "-1", "--pretty=%s"]).stdout, /docs\(pr\): remove reviewer/);
    } finally {
      repo.cleanup();
    }
  });

  it("removes the key when the last reviewer goes", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--remove", "--commit"]);
      assert.equal(prFile(repo, "open").includes("reviewer"), false);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a reviewer who is not a person, rather than writing a file doctor rejects", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav(["pr", "request", "dk3m", "the-auth-team"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is not a person/);
      assert.equal(prFile(repo, "open").includes("reviewer"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("still takes off a name somebody wrote by hand, whatever it says", () => {
    // Removing is how a hand-written mistake is undone, so it must not be
    // refused for being the very thing that needs removing.
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      repo.write(
        PR_PATH,
        prFile(repo, "open").replace(
          "reviewer: alice@example.com",
          "reviewer: [the-auth-team, alice@example.com]",
        ),
      );

      const result = repo.nav(["pr", "request", "dk3m", "the-auth-team", "--remove"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(prFile(repo, "open"), /^reviewer: alice@example\.com$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to ask the pull request's own author", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const author = repo.git(["config", "user.email"]).stdout.trim();
      const result = repo.nav(["pr", "request", "dk3m", author]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /own pull request/);
      assert.equal(prFile(repo, "open").includes("reviewer"), false, "and writes nothing");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a request that would change nothing, without committing", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      const before = repo.git(["rev-parse", "HEAD"]).stdout.trim();

      const again = repo.nav(["pr", "request", "dk3m", "ALICE@example.com", "--commit"]);
      assert.equal(again.code, 1);
      assert.match(again.stderr, /is already asked to review/);

      const absent = repo.nav(["pr", "request", "dk3m", "zoe@example.com", "--remove", "--commit"]);
      assert.equal(absent.code, 1);
      assert.match(absent.stderr, /is not asked to review/);

      assert.equal(repo.git(["rev-parse", "HEAD"]).stdout.trim(), before, "nothing was committed");
    } finally {
      repo.cleanup();
    }
  });

  it("adds only the people who were missing, naming the rest", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "request", "dk3m", "alice@example.com", "--commit"]);
      const result = repo.nav(["pr", "request", "dk3m", "alice@example.com", "bo@example.com"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Asked to review #dk3mp2x9: bo@example\.com/);
      assert.match(result.stdout, /already listed: alice@example\.com/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses an issue, naming the right noun", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["issue", "open", "An issue", "-m", "Body."], { NAV_IDS: "bqlybac0" });
      const result = repo.nav(["pr", "request", "bqly", "alice@example.com"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is an issue/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("the derived review state", () => {
  /** A pull request with two reviewers asked, on its own branch. */
  function withReviewers(): TempRepo {
    const { repo } = withOpenPr();
    repo.git(["checkout", "--quiet", "feat/auth"]);
    repo.nav(["pr", "request", "dk3m", "alice@example.com", "bo@example.com", "--commit"]);
    return repo;
  }

  /** Review as somebody else: the author is excluded from the state by design. */
  function reviewAs(repo: TempRepo, who: string, args: string[], ids: string): void {
    repo.git(["config", "user.email", who]);
    const result = repo.nav(["pr", "review", "dk3m", ...args, "--commit"], {
      NAV_IDS: ids,
      NAV_NOW: "2026-08-06T10:00:00Z",
    });
    assert.equal(result.code, 0, result.stderr);
    repo.git(["config", "user.email", "nav@test.invalid"]);
  }

  it("shows everyone asked, and what each of them said", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "alice@example.com", ["--approve", "-m", "Good."], "aaa11111");
      const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
      assert.match(shown, /review: +approved/);
      assert.match(shown, /reviewers: +alice@example\.com +\[approve\]/);
      assert.match(shown, /bo@example\.com +\[pending\]/);
    } finally {
      repo.cleanup();
    }
  });

  it("lets a block outrank an approval", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "alice@example.com", ["--approve", "-m", "Good."], "aaa11111");
      reviewAs(repo, "bo@example.com", ["--request-changes", "-m", "No."], "bbb22222");
      assert.match(repo.nav(["pr", "show", "dk3m"]).stdout, /review: +changes-requested/);
    } finally {
      repo.cleanup();
    }
  });

  it("marks a review nobody asked for", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "zoe@example.com", ["--approve", "-m", "Passing by."], "zzz11111");
      assert.match(repo.nav(["pr", "show", "dk3m"]).stdout, /zoe@example\.com.*\(not asked\)/);
    } finally {
      repo.cleanup();
    }
  });

  it("ignores the author's own verdict", () => {
    const repo = withReviewers();
    try {
      // The author is `nav@test.invalid`, which `reviewAs` restores.
      repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Mine."], { NAV_IDS: "sss11111" });
      const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
      assert.match(shown, /review: +pending/);
      assert.equal(shown.includes("nav@test.invalid  ["), false);
    } finally {
      repo.cleanup();
    }
  });

  it("returns everybody to pending when a revision is appended", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "alice@example.com", ["--approve", "-m", "Good."], "aaa11111");
      assert.match(repo.nav(["pr", "show", "dk3m"]).stdout, /review: +approved/);

      repo.write("auth.txt", "token handling\nmore\n");
      repo.commitAll("fix: more work");
      repo.nav(["pr", "update", "dk3m", "--commit"], { NAV_NOW: "2026-08-07T09:00:00Z" });

      const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
      assert.match(shown, /review: +pending/);
      assert.match(shown, /alice@example\.com +\[pending\]/);
    } finally {
      repo.cleanup();
    }
  });

  it("filters a listing by who was asked, by decision, and by what is owed", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "alice@example.com", ["--approve", "-m", "Good."], "aaa11111");
      const has = (...terms: string[]): boolean =>
        repo.nav(["pr", "list", ...terms]).stdout.includes("#dk3mp2x9");

      assert.equal(has("reviewer:alice@example.com"), true);
      assert.equal(has("reviewer:nobody@example.com"), false);
      assert.equal(has("review:approved"), true);
      assert.equal(has("review:pending"), false);
      assert.equal(has("awaiting:bo@example.com"), true);
      assert.equal(has("awaiting:alice@example.com"), false, "she has answered");
    } finally {
      repo.cleanup();
    }
  });

  it("carries the derived state into show --json, where the comments are read", () => {
    const repo = withReviewers();
    try {
      reviewAs(repo, "alice@example.com", ["--approve", "-m", "Good."], "aaa11111");
      const shown = JSON.parse(repo.nav(["pr", "show", "dk3m", "--json"]).stdout) as {
        reviewer: string[];
        review: { decision: string; reviewers: { person: string; state: string }[] };
      };
      assert.deepEqual(shown.reviewer, ["alice@example.com", "bo@example.com"]);
      assert.equal(shown.review.decision, "approved");
      assert.deepEqual(
        shown.review.reviewers.map((entry) => `${entry.person} ${entry.state}`),
        ["alice@example.com approve", "bo@example.com pending"],
      );
    } finally {
      repo.cleanup();
    }
  });

  it("says nothing about reviews for a pull request that has none", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
      assert.equal(shown.includes("reviewers:"), false);
      assert.equal(shown.includes("review:"), false);
      assert.equal(repo.nav(["pr", "list"]).stdout.includes("REVIEW"), false);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr list --all-refs", () => {
  it("finds a pull request on a branch that is not checked out", () => {
    const { repo } = withOpenPr();
    try {
      assert.match(repo.nav(["pr", "list"]).stdout, /No pull requests match/);
      const all = repo.nav(["pr", "list", "--all-refs"]);
      assert.equal(all.code, 0, all.stderr);
      assert.match(all.stdout, /#dk3mp2x9/);
      assert.match(all.stdout, /feat\/auth/);
    } finally {
      repo.cleanup();
    }
  });

  it("reports each PR once, listing every ref it was found on", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["branch", "backup/auth", "feat/auth"]);
      const listed = repo.nav(["pr", "list", "--all-refs", "--json"]).stdout.trim().split("\n");
      assert.equal(listed.length, 1, "deduplicated by id");
      const entry = JSON.parse(listed[0] as string) as { refs: string[] };
      assert.deepEqual([...entry.refs].sort(), ["backup/auth", "feat/auth"]);
    } finally {
      repo.cleanup();
    }
  });

  it("drops a pull request the target branch has merged, stale source branch and all", () => {
    const { repo } = withOpenPr({ advanceMain: true });
    try {
      // A branch left behind after the merge: it still carries the copy of the
      // pull request that was current when it was open.
      repo.git(["branch", "backup/auth", "feat/auth"]);
      repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.match(repo.git(["ls-tree", "-r", "--name-only", "feat/auth"]).stdout, /prs\/open/);

      const all = repo.nav(["pr", "list", "--all-refs"]);
      assert.equal(all.code, 0, all.stderr);
      assert.equal(all.stdout.includes("dk3mp2x9"), false, "main files it as merged");
      assert.match(all.stdout, /No pull requests match/);
    } finally {
      repo.cleanup();
    }
  });

  it("drops one the target branch has closed", () => {
    const { repo } = withOpenPr();
    try {
      // Declining from the target branch brings the directory over and files it
      // under prs/closed/ there, while feat/auth keeps its open copy.
      const closed = repo.nav(["pr", "close", "dk3m", "--resolution", "declined", "--commit"], {
        NAV_NOW: "2026-08-07T12:00:00Z",
      });
      assert.equal(closed.code, 0, closed.stderr);
      assert.match(repo.git(["ls-tree", "-r", "--name-only", "feat/auth"]).stdout, /prs\/open/);

      assert.equal(repo.nav(["pr", "list", "--all-refs"]).stdout.includes("dk3mp2x9"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("keeps a pull request the target branch says nothing about", () => {
    const { repo } = withOpenPr();
    try {
      // The guard reads the target branch only; an unrelated branch filing some
      // other pull request as merged must not settle this one.
      assert.match(repo.nav(["pr", "list", "--all-refs"]).stdout, /#dk3mp2x9/);
    } finally {
      repo.cleanup();
    }
  });

  it("still lists one whose merge was never archived on the target", () => {
    const { repo } = withOpenPr();
    try {
      // Merged by hand, so the directory never moved: doctor's "merged but not
      // archived" case (spec 03 §3.5), and still in flight as far as the
      // tracker is concerned.
      repo.git(["merge", "--quiet", "--no-ff", "-m", "land it", "feat/auth"]);
      assert.match(repo.nav(["pr", "list", "--all-refs"]).stdout, /#dk3mp2x9/);
    } finally {
      repo.cleanup();
    }
  });

  it("ignores branches that have no .navbook at all", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "--orphan", "unrelated"]);
      repo.git(["rm", "-rf", "-q", "--cached", "."]);
      repo.write("readme.txt", "nothing to do with navbook\n");
      repo.commitAll("chore: unrelated root");
      repo.git(["checkout", "--quiet", "main"]);
      const all = repo.nav(["pr", "list", "--all-refs"]);
      assert.equal(all.code, 0, all.stderr);
      assert.match(all.stdout, /#dk3mp2x9/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr list points at --all-refs", () => {
  /** Open a second pull request on a new branch, and stay on that branch. */
  function secondPrOnItsOwnBranch(repo: TempRepo): void {
    repo.git(["checkout", "--quiet", "-b", "feat/search", "main"]);
    repo.write("search.txt", "indexing\n");
    repo.commitAll("feat: add search");
    const opened = repo.nav(["pr", "open", "--title", "Add search", "-m", "Body.", "--commit"], {
      NAV_IDS: "qq77ww88",
      NAV_NOW: "2026-08-05T09:00:00Z",
    });
    assert.equal(opened.code, 0, opened.stderr);
  }

  it("names the count and the flag when this branch has nothing to show", () => {
    const { repo } = withOpenPr();
    try {
      const listed = repo.nav(["pr", "list"]);
      assert.equal(listed.code, 0, listed.stderr);
      // The listing itself still reports the checked-out tree and no more.
      assert.match(listed.stdout, /No pull requests match/);
      assert.equal(listed.stdout.includes("dk3mp2x9"), false);
      assert.match(listed.stderr, /1 open pull request on other branches/);
      assert.match(listed.stderr, /--all-refs/);
    } finally {
      repo.cleanup();
    }
  });

  it("counts each pull request once however many branches carry it", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["branch", "backup/auth", "feat/auth"]);
      assert.match(repo.nav(["pr", "list"]).stderr, /1 open pull request on other branches/);
    } finally {
      repo.cleanup();
    }
  });

  it("does not count a pull request that lives on the branch checked out", () => {
    const { repo } = withOpenPr();
    try {
      secondPrOnItsOwnBranch(repo);
      // Standing on feat/search, whose own PR simply does not match the query:
      // only the one on feat/auth is somewhere `--all-refs` would reach.
      const listed = repo.nav(["pr", "list", "label:no-such-label"]);
      assert.match(listed.stdout, /No pull requests match/);
      assert.match(listed.stderr, /1 open pull request on other branches/);
    } finally {
      repo.cleanup();
    }
  });

  it("does not count one its own target has merged, where --all-refs would not list it", () => {
    const repo = makeNavRepo();
    try {
      // The target is not the default branch: main has never heard of the pull
      // request, and only dev files it as merged.
      repo.write("app.txt", "original\n");
      repo.commitAll("feat: initial code");
      repo.git(["branch", "dev"]);
      repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
      repo.write("auth.txt", "token handling\n");
      repo.commitAll("feat: rework auth tokens");
      const opened = repo.nav(
        ["pr", "open", "--target", "dev", "--title", "Refactor auth", "-m", "Body.", "--commit"],
        {
          NAV_IDS: "dk3mp2x9",
          NAV_NOW: "2026-08-04T16:40:00Z",
        },
      );
      assert.equal(opened.code, 0, opened.stderr);
      repo.git(["checkout", "--quiet", "dev"]);
      const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(merged.code, 0, merged.stderr);
      repo.git(["checkout", "--quiet", "main"]);

      assert.match(repo.nav(["pr", "list", "--all-refs"]).stdout, /No pull requests match/);
      const listed = repo.nav(["pr", "list"]);
      assert.match(listed.stdout, /No pull requests match/);
      assert.equal(listed.stderr.trim(), "", "the hint and the listing agree");
    } finally {
      repo.cleanup();
    }
  });

  it("does not count a pull request the detached HEAD holds", () => {
    const { repo } = withOpenPr();
    try {
      // No branch is checked out, but the tree is feat/auth's: its pull request
      // is here, not somewhere --all-refs would have to reach.
      repo.git(["checkout", "--quiet", "--detach", "feat/auth"]);
      const listed = repo.nav(["pr", "list", "label:no-such-label"]);
      assert.match(listed.stdout, /No pull requests match/);
      assert.equal(listed.stderr.trim(), "");
    } finally {
      repo.cleanup();
    }
  });

  it("says nothing when there is no pull request anywhere", () => {
    const repo = makeNavRepo();
    try {
      const listed = repo.nav(["pr", "list"]);
      assert.match(listed.stdout, /No pull requests match/);
      assert.equal(listed.stderr.trim(), "");
    } finally {
      repo.cleanup();
    }
  });

  it("stays out of --json, which a pipeline reads as an empty result", () => {
    const { repo } = withOpenPr();
    try {
      const listed = repo.nav(["pr", "list", "--json"]);
      assert.equal(listed.code, 0, listed.stderr);
      assert.equal(listed.stdout, "");
      assert.equal(listed.stderr.trim(), "");
    } finally {
      repo.cleanup();
    }
  });

  it("reaches a pull request opened in another worktree", () => {
    const { repo } = withOpenPr();
    const tree = join(repo.dir, "..", "worktree-auth");
    try {
      // The shape that prompted this: the branch carrying the PR is checked
      // out somewhere else, so the main checkout can never see it in its tree.
      repo.git(["worktree", "add", "--quiet", tree, "feat/auth"]);

      const fromMain = repo.nav(["pr", "list"]);
      assert.match(fromMain.stdout, /No pull requests match/);
      assert.match(fromMain.stderr, /1 open pull request on other branches/);

      // The worktree is an ordinary checkout of that branch: it lists its own
      // pull request outright, and has nothing to point elsewhere for.
      const fromTree = navIn(tree, repo.home, ["pr", "list"]);
      assert.equal(fromTree.code, 0, fromTree.stderr);
      assert.match(fromTree.stdout, /#dk3mp2x9/);
      assert.equal(fromTree.stderr.trim(), "");

      const all = navIn(tree, repo.home, ["pr", "list", "--all-refs"]);
      assert.match(all.stdout, /#dk3mp2x9/);
    } finally {
      repo.git(["worktree", "remove", "--force", tree]);
      repo.cleanup();
    }
  });
});

describe("a pull request that only another branch holds", () => {
  /** What `nav pr list --all-refs --json` hands a script to act on. */
  function listedAcrossRefs(repo: TempRepo): Array<{ id: string; path: string }> {
    const listed = repo.nav(["pr", "list", "--all-refs", "--json"]);
    assert.equal(listed.code, 0, listed.stderr);
    return listed.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("shows every pull request the cross-ref listing returns, by any form it prints", () => {
    const { repo } = withOpenPr();
    try {
      const listed = listedAcrossRefs(repo);
      assert.equal(listed.length, 1);
      const { id, path } = listed[0] as { id: string; path: string };

      // The bare ID, the `#<id>` the table prints, and the `path` from --json.
      for (const form of [id, `#${id}`, path, `${path}/`]) {
        const shown = repo.nav(["pr", "show", form]);
        assert.equal(shown.code, 0, `${form}: ${shown.stderr}`);
        assert.match(shown.stdout, /Refactor auth/);
        assert.match(shown.stderr, /read from 'feat\/auth'/);
      }

      const json = JSON.parse(repo.nav(["pr", "show", id, "--json"]).stdout);
      assert.equal(json.id, id);
      assert.deepEqual(json.refs, ["feat/auth"]);
    } finally {
      repo.cleanup();
    }
  });

  it("carries its reviews across, so show reports the decision the branch holds", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      approveAs(repo, "rev@example.com", "rv11aa22");
      repo.git(["checkout", "--quiet", "main"]);

      const json = JSON.parse(repo.nav(["pr", "show", "dk3m", "--json"]).stdout);
      assert.equal(json.comments.length, 1);
      assert.equal(json.review.approvals.given, 1);
      assert.equal(json.review.decision, "approved");
    } finally {
      repo.cleanup();
    }
  });

  it("does not show one from the tree it is not in when a copy is here", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const shown = repo.nav(["pr", "show", "dk3m", "--json"]);
      assert.equal(shown.code, 0, shown.stderr);
      assert.equal(JSON.parse(shown.stdout).refs, undefined);
      assert.equal(shown.stderr.includes("read from"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("still says an unknown ID matches nothing", () => {
    const { repo } = withOpenPr();
    try {
      const shown = repo.nav(["pr", "show", "zzzz9999"]);
      assert.equal(shown.code, 1);
      assert.match(shown.stderr, /no open pull request matches 'zzzz9999'/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to review it here, naming the branch to review it on", () => {
    const { repo, head } = withOpenPr();
    try {
      const reviewed = repo.nav([
        "pr",
        "review",
        "dk3mp2x9",
        "--revision",
        head,
        "--request-changes",
        "-m",
        "Not yet.",
      ]);
      assert.equal(reviewed.code, 1);
      assert.match(reviewed.stderr, /#dk3mp2x9 is on 'feat\/auth', which is not checked out here/);
      assert.match(reviewed.stderr, /git switch feat\/auth/);
      // Nothing written: a review here would sit beside no pr.md.
      assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses every verb that writes into its directory", () => {
    const { repo } = withOpenPr();
    try {
      for (const args of [
        ["pr", "comment", "dk3m", "-m", "A thought."],
        ["pr", "update", "dk3m"],
        ["pr", "request", "dk3m", "rev@example.com"],
        ["pr", "edit", "dk3m"],
      ]) {
        const result = repo.nav(args, { EDITOR: "true", VISUAL: "true" });
        assert.equal(result.code, 1, `${args[1]}: ${result.stdout}`);
        assert.match(result.stderr, /is on 'feat\/auth'/, `${args[1]}: ${result.stderr}`);
      }
      assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
    } finally {
      repo.cleanup();
    }
  });

  it("points at the worktree that has the branch, and reviews from there", () => {
    const { repo } = withOpenPr();
    const tree = join(repo.dir, "..", "worktree-review");
    try {
      repo.git(["worktree", "add", "--quiet", tree, "feat/auth"]);

      const { id } = listedAcrossRefs(repo)[0] as { id: string };
      const refused = repo.nav(["pr", "review", id, "--comment", "-m", "Read it."]);
      assert.equal(refused.code, 1);
      assert.match(
        refused.stderr,
        /'feat\/auth' is checked out in .*worktree-review; run the command there/,
      );

      const shown = JSON.parse(navIn(tree, repo.home, ["pr", "show", id, "--json"]).stdout);
      const revision = shown.revisions.at(-1).head;
      const reviewed = navIn(tree, repo.home, [
        "pr",
        "review",
        id,
        "--revision",
        revision,
        "--comment",
        "-m",
        "test review",
        "--commit",
      ]);
      assert.equal(reviewed.code, 0, reviewed.stderr);
      assert.match(reviewed.stdout, /Reviewed \(comment\) #dk3mp2x9/);
    } finally {
      repo.git(["worktree", "remove", "--force", tree]);
      repo.cleanup();
    }
  });

  it("names the local branch to make when only a remote-tracking one carries it", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["update-ref", "refs/remotes/origin/feat/auth", "feat/auth"]);
      repo.git(["branch", "--quiet", "-D", "feat/auth"]);

      assert.equal(repo.nav(["pr", "show", "dk3m"]).code, 0);
      const reviewed = repo.nav(["pr", "review", "dk3m", "-m", "Read it."]);
      assert.equal(reviewed.code, 1);
      assert.match(reviewed.stderr, /is on 'origin\/feat\/auth'/);
      assert.match(reviewed.stderr, /git switch feat\/auth/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("--commit on a detached HEAD", () => {
  /** Detach at the pull request's branch, as a reviewer barred from it would. */
  function detachAtFeature(repo: TempRepo): string {
    repo.git(["checkout", "--quiet", "--detach", "feat/auth"]);
    return repo.git(["rev-parse", "HEAD"]).stdout.trim();
  }

  it("refuses to commit a review there, naming the worktree that has the branch", () => {
    const { repo } = withOpenPr();
    const tree = join(repo.dir, "..", "worktree-detached");
    try {
      repo.git(["worktree", "add", "--quiet", tree, "feat/auth"]);
      const head = detachAtFeature(repo);

      const reviewed = repo.nav([
        "pr",
        "review",
        "dk3m",
        "--comment",
        "-m",
        "Read it.",
        "--commit",
      ]);
      assert.equal(reviewed.code, 1);
      assert.match(reviewed.stderr, /HEAD is detached/);
      assert.match(
        reviewed.stderr,
        /HEAD is at 'feat\/auth', which is checked out in .*worktree-detached; run the command there/,
      );
      // Refused before anything was written, let alone committed.
      assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
      assert.equal(repo.git(["rev-parse", "HEAD"]).stdout.trim(), head);
    } finally {
      repo.git(["worktree", "remove", "--force", tree]);
      repo.cleanup();
    }
  });

  it("names the branch to check out when no worktree has it", () => {
    const { repo } = withOpenPr();
    try {
      detachAtFeature(repo);
      const reviewed = repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Fine.", "--commit"]);
      assert.equal(reviewed.code, 1);
      assert.match(reviewed.stderr, /git switch feat\/auth/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses on a commit no branch points at, and for an issue too", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "--detach", "main~1"]);
      const opened = repo.nav(["issue", "open", "Stray", "-m", "Body.", "--commit"]);
      assert.equal(opened.code, 1);
      assert.match(opened.stderr, /HEAD is detached/);
      assert.match(opened.stderr, /check out a branch first/);
      assert.equal(repo.git(["status", "--porcelain"]).stdout, "");
    } finally {
      repo.cleanup();
    }
  });

  it("still writes and stages without --commit, leaving the commit to be placed", () => {
    const { repo } = withOpenPr();
    try {
      detachAtFeature(repo);
      const reviewed = repo.nav(["pr", "review", "dk3m", "--comment", "-m", "Read it."], {
        NAV_IDS: "dtc11111",
      });
      assert.equal(reviewed.code, 0, reviewed.stderr);
      assert.match(repo.git(["diff", "--cached", "--name-only"]).stdout, /dtc11111\.md/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr merge", () => {
  it("fast-forwards without a merge commit, and records no commit SHA", () => {
    const { repo } = withOpenPr();
    try {
      const result = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.includes("Merge commit"), false);
      assert.match(result.stdout, /^Fast-forwarded feat\/auth to main$/m);

      const text = prFile(repo, "merged");
      assert.match(text, /^merged:$/m);
      assert.equal(/^ {2}commit:/m.test(text), false, "a fast-forward has no merge commit to name");
      assert.equal(repo.git(["log", "--merges", "--oneline"]).stdout.trim(), "");
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("creates a merge commit when the branches diverged, and records it", () => {
    const { repo } = withOpenPr({ advanceMain: true });
    try {
      const result = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(result.code, 0, result.stderr);

      const merges = repo.git(["log", "--merges", "--format=%s"]).stdout.trim();
      assert.equal(merges, "Merge #dk3mp2x9: Refactor auth");
      const sha = repo.git(["rev-list", "--merges", "-1", "HEAD"]).stdout.trim();
      assert.match(prFile(repo, "merged"), new RegExp(`commit: ${sha}`));
      assert.match(result.stdout, /^Fast-forwarded feat\/auth to main$/m);
      assert.equal(branchesApart(repo, "main", "feat/auth"), "0\t0");
    } finally {
      repo.cleanup();
    }
  });

  it("brings the source branch up to the target, so both read the PR as merged", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(branchesApart(repo, "main", "feat/auth"), "0\t0");
      // The cross-branch scan is what would otherwise report the pull request
      // as still open on its own branch.
      const everywhere = repo.nav(["pr", "list", "--all-refs"]);
      assert.equal(everywhere.code, 0, everywhere.stderr);
      assert.doesNotMatch(everywhere.stdout, /dk3mp2x9/);
      assert.match(
        repo.git(["reflog", "show", "-1", "feat/auth"]).stdout,
        /nav pr merge #dk3mp2x9: to main/,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("--no-sync-source leaves the source branch where it was", () => {
    const { repo } = withOpenPr();
    try {
      const result = repo.nav(["pr", "merge", "dk3m", "--no-sync-source"], {
        NAV_NOW: "2026-08-07T12:00:00Z",
      });
      assert.equal(result.code, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /Fast-forwarded/);
      assert.equal(result.stderr, "");
      assert.equal(branchesApart(repo, "main", "feat/auth"), "1\t0");
      // The source branch keeps its open copy. `--all-refs` no longer lists it,
      // because `main` files the pull request as merged.
      assert.match(
        repo.git(["ls-tree", "-r", "--name-only", "feat/auth"]).stdout,
        /prs\/open\/dk3mp2x9-[^/]+\/pr\.md/,
      );
      assert.doesNotMatch(repo.nav(["pr", "list", "--all-refs"]).stdout, /dk3mp2x9/);
    } finally {
      repo.cleanup();
    }
  });

  it("warns instead of moving a source branch checked out in another worktree", () => {
    const { repo } = withOpenPr();
    const elsewhere = join(repo.home, "elsewhere");
    try {
      repo.git(["worktree", "add", "--quiet", elsewhere, "feat/auth"]);
      const result = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Merged #dk3mp2x9/m);
      assert.doesNotMatch(result.stdout, /Fast-forwarded/);
      assert.match(result.stderr, /warning: feat\/auth was not moved: it is checked out at /);
      assert.match(result.stderr, /git merge --ff-only main/);
      assert.equal(branchesApart(repo, "main", "feat/auth"), "1\t0");
      assert.equal(repo.git(["-C", elsewhere, "status", "--porcelain"]).stdout.trim(), "");
    } finally {
      repo.git(["worktree", "remove", "--force", elsewhere]);
      repo.cleanup();
    }
  });

  it("honours --no-ff even when a fast-forward was possible", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["pr", "merge", "dk3m", "--no-ff"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.match(repo.git(["log", "--merges", "--format=%s"]).stdout, /Merge #dk3mp2x9/);
    } finally {
      repo.cleanup();
    }
  });

  it("carries the whole discussion into the target's history", () => {
    const { repo } = withOpenPr({ advanceMain: true });
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Looks good.", "--commit"], {
        NAV_IDS: "aaa11111",
        NAV_NOW: "2026-08-06T10:00:00Z",
      });
      repo.git(["checkout", "--quiet", "main"]);
      repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });

      const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
      assert.match(shown, /Looks good\./);
      assert.match(shown, /status: *merged/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses when the working tree is dirty", () => {
    const { repo } = withOpenPr();
    try {
      repo.write("app.txt", "uncommitted edit\n");
      const result = repo.nav(["pr", "merge", "dk3m"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /working tree has changes/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to merge the same pull request twice", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      // The source branch was brought up to main, so no branch carries the
      // pull request under prs/open/ any more and there is nothing to merge.
      const gone = repo.nav(["pr", "merge", "dk3m"]);
      assert.equal(gone.code, 1);
      assert.match(gone.stderr, /no open pull request matches 'dk3m'/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to merge a pull request its stale source branch still shows open", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["pr", "merge", "dk3m", "--no-sync-source"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      // The stale source branch still carries the PR under prs/open/, so it is
      // still discoverable; what stops a second merge is the ancestry check.
      const again = repo.nav(["pr", "merge", "dk3m"]);
      assert.equal(again.code, 1);
      assert.match(again.stderr, /already contained in main/);
      assert.match(again.stderr, /doctor --fix/);
    } finally {
      repo.cleanup();
    }
  });

  it("stops on conflict, keeps the resolution, and finishes with --continue", () => {
    const repo = makeNavRepo();
    try {
      repo.write("app.txt", "original\n");
      repo.commitAll("feat: initial code");
      repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
      repo.write("app.txt", "from the branch\n");
      repo.commitAll("feat: change app");
      repo.nav(["pr", "open", "--title", "Conflicting", "-m", "Body.", "--commit"], {
        NAV_IDS: "dk3mp2x9",
        NAV_NOW: "2026-08-04T16:40:00Z",
      });
      repo.git(["checkout", "--quiet", "main"]);
      repo.write("app.txt", "from main\n");
      repo.commitAll("feat: conflicting change on main");

      const stopped = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(stopped.code, 1);
      assert.match(stopped.stderr, /produced conflicts/);
      assert.match(stopped.stderr, /--continue/);
      assert.match(repo.git(["status", "--porcelain"]).stdout, /^UU app\.txt$/m);

      const tooEarly = repo.nav(["pr", "merge", "--continue"]);
      assert.equal(tooEarly.code, 1);
      assert.match(tooEarly.stderr, /unresolved conflicts/);

      repo.write("app.txt", "resolved by hand\n");
      repo.git(["add", "app.txt"]);
      const finished = repo.nav(["pr", "merge", "--continue"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(finished.code, 0, finished.stderr);

      assert.equal(readFileSync(join(repo.dir, "app.txt"), "utf8"), "resolved by hand\n");
      assert.ok(existsSync(join(repo.dir, ".navbook/prs/merged/dk3mp2x9-conflicting/pr.md")));
      assert.match(repo.git(["log", "--merges", "--format=%s"]).stdout, /Merge #dk3mp2x9/);
      assert.equal(repo.nav(["doctor"]).code, 0);
      // --continue finishes everything the uninterrupted merge would have done,
      // the source branch included.
      assert.match(finished.stdout, /^Fast-forwarded feat\/auth to main$/m);
      assert.equal(branchesApart(repo, "main", "feat/auth"), "0\t0");
    } finally {
      repo.cleanup();
    }
  });

  it("warns instead of moving a source branch that took commits during the merge", () => {
    const repo = makeNavRepo();
    try {
      repo.write("app.txt", "original\n");
      repo.commitAll("feat: initial code");
      repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
      repo.write("app.txt", "from the branch\n");
      repo.commitAll("feat: change app");
      repo.nav(["pr", "open", "--title", "Conflicting", "-m", "Body.", "--commit"], {
        NAV_IDS: "dk3mp2x9",
        NAV_NOW: "2026-08-04T16:40:00Z",
      });
      repo.git(["checkout", "--quiet", "main"]);
      repo.write("app.txt", "from main\n");
      repo.commitAll("feat: conflicting change on main");
      assert.equal(repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" }).code, 1);

      // While the conflict sits unresolved, somebody pushes feat/auth on: the
      // merge in progress brings in the tip that was, not the tip that is.
      const moved = repo
        .git([
          "commit-tree",
          "feat/auth^{tree}",
          "-p",
          "feat/auth",
          "-m",
          "feat: more on the branch",
        ])
        .stdout.trim();
      repo.git(["update-ref", "refs/heads/feat/auth", moved]);

      repo.write("app.txt", "resolved by hand\n");
      repo.git(["add", "app.txt"]);
      const finished = repo.nav(["pr", "merge", "--continue"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(finished.code, 0, finished.stderr);
      assert.doesNotMatch(finished.stdout, /Fast-forwarded/);
      assert.match(
        finished.stderr,
        /warning: feat\/auth was not moved: it has commits main does not/,
      );
      assert.equal(repo.git(["rev-parse", "feat/auth"]).stdout.trim(), moved, "left untouched");
      assert.equal(repo.git(["log", "--merges", "--oneline"]).stdout.trim().split("\n").length, 1);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses unless the pull request's own target branch is checked out", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav(["pr", "merge", "dk3m"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /targets 'main'/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr close", () => {
  it("brings a pull request from its source branch to record the decline", () => {
    const { repo } = withOpenPr();
    try {
      const result = repo.nav(["pr", "close", "dk3m", "--resolution", "declined"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Brought #dk3mp2x9 onto this branch/);
      assert.match(prFile(repo, "closed"), /resolution: declined/);
    } finally {
      repo.cleanup();
    }
  });

  it("will not reopen a merged pull request", () => {
    const { repo } = withOpenPr();
    try {
      repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      const result = repo.nav(["pr", "reopen", "dk3m"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /merged/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr delete", () => {
  it("removes the directory on the branch that holds it", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const result = repo.nav(["pr", "delete", "dk3m", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Deleted #dk3mp2x9 {2}\.navbook\/prs\/open\/dk3mp2x9-/);
      assert.equal(
        repo.git(["log", "-1", "--format=%s"]).stdout.trim(),
        "docs(pr): delete #dk3mp2x9",
      );
      assert.equal(existsSync(join(repo.dir, ".navbook/prs/open/dk3mp2x9-refactor-auth")), false);
    } finally {
      repo.cleanup();
    }
  });

  it("acts on the checked-out tree only, never fetching the directory from a branch", () => {
    // `nav pr close` deliberately reaches onto the source branch to record a
    // decision. Deleting must not: removing a copy it had to fetch first would
    // leave the original in place on the branch it came from.
    const { repo } = withOpenPr();
    try {
      const result = repo.nav(["pr", "delete", "dk3m", "--force"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no pull request matches 'dk3m'/);
      assert.equal(result.stdout.includes("Brought"), false, result.stdout);
    } finally {
      repo.cleanup();
    }
  });
});

describe("history-based doctor checks", () => {
  it("D9 reports a merged but unarchived pull request only on its target branch", () => {
    const { repo } = withOpenPr({ advanceMain: true });
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      assert.equal(repo.nav(["doctor"]).stdout.includes("D9"), false, "not on the source branch");

      repo.git(["checkout", "--quiet", "main"]);
      repo.git(["merge", "--no-ff", "--no-edit", "--quiet", "feat/auth"]);
      const flagged = repo.nav(["doctor"]);
      assert.equal(flagged.code, 0, "a warning must not fail the check");
      assert.match(flagged.stdout, /D9/);
      assert.match(flagged.stdout, /merged into this branch/);

      const fixed = repo.nav(["doctor", "--fix"]);
      assert.match(fixed.stdout, /prs\/merged\/dk3mp2x9-refactor-auth/);
      assert.equal(repo.nav(["doctor"]).stdout.includes("D9"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("D7 catches a revision entry that was edited after being recorded", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const path = ".navbook/prs/open/dk3mp2x9-refactor-auth/pr.md";
      const text = readFileSync(join(repo.dir, path), "utf8");
      repo.write(path, text.replace(/head: [0-9a-f]{40}/, `head: ${"a".repeat(40)}`));
      repo.commitAll("chore: tamper with a recorded revision");

      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 2);
      assert.match(result.stdout, /D7/);
      assert.match(result.stdout, /only be appended/);
    } finally {
      repo.cleanup();
    }
  });

  it("D7 accepts an honest append", () => {
    const { repo } = withOpenPr();
    try {
      repo.git(["checkout", "--quiet", "feat/auth"]);
      repo.write("auth.txt", "token handling\nmore\n");
      repo.commitAll("fix: more work");
      repo.nav(["pr", "update", "dk3m", "--commit"], { NAV_NOW: "2026-08-06T09:00:00Z" });
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("D10 warns about a timestamp far from the commit that introduced it", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Odd", "-m", "Body."], { NAV_IDS: "odd11111" });
      const path = ".navbook/issues/open/odd11111-odd/issue.md";
      const text = readFileSync(join(repo.dir, path), "utf8");
      repo.write(path, text.replace(/^created: .*/m, "created: 2019-01-01T00:00:00Z"));
      repo.commitAll("docs(issue): open #odd11111");

      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0, "D10 is a warning");
      assert.match(result.stdout, /D10/);
    } finally {
      repo.cleanup();
    }
  });

  it("D10 leaves imported and archived entities alone", () => {
    const repo = makeNavRepo();
    try {
      repo.write(
        ".navbook/issues/open/imp11111-imported/issue.md",
        "---\ntitle: Imported\nauthor: a@b.co\ncreated: 2019-01-01T00:00:00Z\nimported-from: github:acme/repo#42\n---\n\nBody.\n",
      );
      repo.write(
        ".navbook/archive/2019/issues/closed/arc11111-archived/issue.md",
        "---\ntitle: Archived\nauthor: a@b.co\ncreated: 2019-01-01T00:00:00Z\n---\n\nBody.\n",
      );
      repo.commitAll("chore: import and archive");
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0);
      assert.equal(result.stdout.includes("D10"), false, result.stdout);
    } finally {
      repo.cleanup();
    }
  });
});

describe("the review policy", () => {
  describe("nav pr show", () => {
    it("says nothing extra where no policy is declared", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        const shown = repo.nav(["pr", "show", "dk3m"]);
        assert.equal(shown.code, 0, shown.stderr);
        assert.equal(shown.stdout.includes("policy:"), false, shown.stdout);
        assert.equal(shown.stdout.includes("approvals"), false, shown.stdout);
      } finally {
        repo.cleanup();
      }
    });

    it("names the policy even before anybody has reviewed", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { selfReview: false, minApprovals: 2 });
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.match(shown, /policy: +2 approvals required, self-review off/);
      } finally {
        repo.cleanup();
      }
    });

    it("counts the approvals it has against the ones it needs", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 2 });
        approveAs(repo, "alice@example.com", "aaa11111");
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.match(shown, /review: +pending {2}\(1 of 2 approvals\)/);
      } finally {
        repo.cleanup();
      }
    });

    it("shows the shortfall before anybody has been asked, since the policy is the ask", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 2 });
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.match(shown, /review: +pending {2}\(0 of 2 approvals\)/);
        assert.equal(
          shown.includes("reviewers:"),
          false,
          "and nobody is listed, because nobody is",
        );
      } finally {
        repo.cleanup();
      }
    });

    it("still says nothing about a pull request nobody asked and one approval suits", () => {
      // The rule the count is an exception to: a decision of `pending` where
      // nothing is outstanding is noise, and stays hidden.
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 1 });
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.equal(shown.includes("review:"), false, shown);
        assert.match(shown, /policy: +1 approval required/);
      } finally {
        repo.cleanup();
      }
    });

    it("leaves the count off when one approval is what is wanted", () => {
      // "1 of 1" beside every decision is a fact nobody was missing.
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 1 });
        approveAs(repo, "alice@example.com", "aaa11111");
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.match(shown, /review: +approved/);
        assert.equal(shown.includes("1 of 1"), false, shown);
      } finally {
        repo.cleanup();
      }
    });

    it("counts the author's own approval when self-review is allowed", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { selfReview: true });
        const filed = repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Mine.", "--commit"], {
          NAV_IDS: "aaa11111",
          NAV_NOW: "2026-08-06T10:00:00Z",
        });
        assert.equal(filed.code, 0, filed.stderr);
        assert.equal(filed.stderr.includes("will not count"), false, "and says nothing about it");
        const shown = repo.nav(["pr", "show", "dk3m"]).stdout;
        assert.match(shown, /review: +approved/);
        assert.match(shown, /policy: +1 approval required, self-review on/);
      } finally {
        repo.cleanup();
      }
    });

    it("carries the policy and the count into --json", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 2 });
        approveAs(repo, "alice@example.com", "aaa11111");
        const shown = JSON.parse(repo.nav(["pr", "show", "dk3m", "--json"]).stdout);
        assert.deepEqual(shown.review.approvals, { given: 1, required: 2 });
        assert.deepEqual(shown.reviewPolicy, {
          selfReview: false,
          minApprovals: 2,
          declared: true,
        });
      } finally {
        repo.cleanup();
      }
    });

    it("reports the defaults as undeclared, so a script can tell them apart", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        const shown = JSON.parse(repo.nav(["pr", "show", "dk3m", "--json"]).stdout);
        assert.deepEqual(shown.reviewPolicy, {
          selfReview: false,
          minApprovals: 1,
          declared: false,
        });
      } finally {
        repo.cleanup();
      }
    });
  });

  describe("nav pr review", () => {
    it("warns an author that their own approval will not count", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        const filed = repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Mine.", "--commit"], {
          NAV_IDS: "aaa11111",
          NAV_NOW: "2026-08-06T10:00:00Z",
        });
        assert.equal(filed.code, 0, "the review is filed all the same");
        assert.match(filed.stderr, /your own pull request/);
        assert.match(filed.stderr, /this approve will not count/);
        assert.match(repo.nav(["pr", "show", "dk3m"]).stdout, /Mine\./, "and it is on the record");
      } finally {
        repo.cleanup();
      }
    });

    it("says nothing about a verdict that judges nothing", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        const filed = repo.nav(["pr", "review", "dk3m", "-m", "Read it."], {
          NAV_IDS: "aaa11111",
          NAV_NOW: "2026-08-06T10:00:00Z",
        });
        assert.equal(filed.stderr.includes("will not count"), false, filed.stderr);
      } finally {
        repo.cleanup();
      }
    });

    it("says nothing to somebody reviewing a pull request that is not theirs", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        repo.git(["config", "user.email", "alice@example.com"]);
        const filed = repo.nav(["pr", "review", "dk3m", "--approve", "-m", "Fine."], {
          NAV_IDS: "aaa11111",
          NAV_NOW: "2026-08-06T10:00:00Z",
        });
        assert.equal(filed.stderr.includes("will not count"), false, filed.stderr);
      } finally {
        repo.cleanup();
      }
    });
  });

  describe("nav pr merge", () => {
    it("merges in silence where no policy is declared", () => {
      const { repo } = withOpenPr();
      try {
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.equal(merged.stdout.includes("required approval"), false, merged.stdout);
        assert.equal(merged.stderr, "");
      } finally {
        repo.cleanup();
      }
    });

    it("says what is missing and merges anyway with no terminal to ask", () => {
      // A pipeline that stopped for a question nobody can answer would be the
      // gate spec 02 §2.7 forbids, arrived at by accident.
      const { repo } = withOpenPr();
      try {
        declarePolicy(repo, { minApprovals: 2 });
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.match(merged.stdout, /#dk3mp2x9 has 0 of 2 required approvals/);
        assert.match(merged.stderr, /merging #dk3mp2x9 anyway; pass --yes/);
        assert.match(merged.stdout, /Merged #dk3mp2x9/);
      } finally {
        repo.cleanup();
      }
    });

    it("says what is missing without the warning when --yes answered in advance", () => {
      const { repo } = withOpenPr();
      try {
        declarePolicy(repo, { minApprovals: 2 });
        const merged = repo.nav(["pr", "merge", "dk3m", "--yes"], {
          NAV_NOW: "2026-08-07T12:00:00Z",
        });
        assert.equal(merged.code, 0, merged.stderr);
        assert.match(merged.stdout, /#dk3mp2x9 has 0 of 2 required approvals/);
        assert.equal(merged.stderr, "", "nothing is left to warn about");
      } finally {
        repo.cleanup();
      }
    });

    it("names who is blocking rather than counting approvals", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        repo.git(["config", "user.email", "alice@example.com"]);
        repo.nav(["pr", "review", "dk3m", "--request-changes", "-m", "Not yet.", "--commit"], {
          NAV_IDS: "aaa11111",
          NAV_NOW: "2026-08-06T10:00:00Z",
        });
        repo.git(["config", "user.email", FIXTURE_IDENTITY.email]);
        repo.git(["checkout", "--quiet", "main"]);
        declarePolicy(repo, { minApprovals: 1 });
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.match(merged.stdout, /has changes requested by .*alice@example\.com/);
      } finally {
        repo.cleanup();
      }
    });

    it("merges in silence once the policy is met", () => {
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        approveAs(repo, "alice@example.com", "aaa11111");
        repo.git(["checkout", "--quiet", "main"]);
        declarePolicy(repo, { minApprovals: 1 });
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.equal(merged.stdout.includes("required approval"), false, merged.stdout);
        assert.equal(merged.stderr, "");
      } finally {
        repo.cleanup();
      }
    });

    it("counts by the target branch's policy, since that is the tree being merged into", () => {
      const { repo } = withOpenPr();
      try {
        declarePolicy(repo, { minApprovals: 2 });
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.match(merged.stdout, /0 of 2 required approvals/);
      } finally {
        repo.cleanup();
      }
    });

    it("does not count by a policy the source branch alone declares", () => {
      // The branch asking to be merged does not get to say how the branch
      // receiving it counts. Only the source declares one here, so a message
      // mentioning it at all would be the wrong marker being read.
      const { repo } = withOpenPr();
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 9 });
        repo.git(["checkout", "--quiet", "main"]);
        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.equal(merged.stdout.includes("required approval"), false, merged.stdout);
        assert.equal(merged.stderr, "");
      } finally {
        repo.cleanup();
      }
    });

    it("warns rather than asks when finishing a merge that stopped for conflicts", () => {
      // Two branches editing the marker is an ordinary conflict, and it is the
      // shortest route to one. By `--continue` the merge is under way, so the
      // moment to have asked has passed and the shortfall is only reported.
      const { repo } = withOpenPr({ advanceMain: true });
      try {
        repo.git(["checkout", "--quiet", "feat/auth"]);
        declarePolicy(repo, { minApprovals: 9 });
        repo.git(["checkout", "--quiet", "main"]);
        declarePolicy(repo, { minApprovals: 2 });

        const stopped = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(stopped.code, 1);
        assert.match(stopped.stderr, /produced conflicts/);

        repo.write(
          ".navbook/navbook.json",
          '{\n  "version": 1,\n  "review": {"minApprovals": 2}\n}\n',
        );
        repo.git(["add", ".navbook/navbook.json"]);
        const finished = repo.nav(["pr", "merge", "--continue", "dk3m"], {
          NAV_NOW: "2026-08-07T12:00:00Z",
        });
        assert.equal(finished.code, 0, finished.stderr);
        assert.match(finished.stderr, /#dk3mp2x9 was merged with 0 of 2 required approvals/);
        assert.match(finished.stdout, /Merged #dk3mp2x9/);
      } finally {
        repo.cleanup();
      }
    });
  });

  describe("a marker nobody can read", () => {
    it("is a doctor error, so the pre-commit hook stops it", () => {
      const repo = makeNavRepo();
      try {
        repo.write(".navbook/navbook.json", '{"version": 1, "review": {"minApprovals": 0}}');
        repo.commitAll("chore: a policy with a typo in it");
        const doctor = repo.nav(["doctor"]);
        assert.equal(doctor.code, 2);
        assert.match(doctor.stdout, /D15 +\.navbook\/navbook\.json: 'review\.minApprovals'/);
      } finally {
        repo.cleanup();
      }
    });

    it("is caught by --staged, before the commit that would carry it", () => {
      const repo = makeNavRepo();
      try {
        repo.write(".navbook/navbook.json", "{ not json at all");
        repo.git(["add", "-A"]);
        const doctor = repo.nav(["doctor", "--staged"]);
        assert.equal(doctor.code, 2);
        assert.match(doctor.stdout, /D15/);
      } finally {
        repo.cleanup();
      }
    });

    it("stops no command: every reader falls back and says what it found", () => {
      const { repo } = withOpenPr();
      try {
        repo.write(".navbook/navbook.json", '{"version": 1, "review": {"selfReview": "yes"}}');
        repo.commitAll("chore: a policy with a typo in it");

        const listed = repo.nav(["pr", "list", "--all-refs"]);
        assert.equal(listed.code, 0, listed.stderr);
        assert.match(listed.stdout, /#dk3mp2x9/);
        assert.match(
          listed.stderr,
          /'review\.selfReview' must be true or false; using the default/,
        );

        const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
        assert.equal(merged.code, 0, merged.stderr);
        assert.match(merged.stderr, /using the default/);
      } finally {
        repo.cleanup();
      }
    });
  });
});
