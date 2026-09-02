/**
 * A repository whose Navbook directory is not called `.navbook`.
 *
 * The unit tests prove the name is resolved correctly; these prove the whole
 * CLI actually uses it — that no command still writes to, reads from, or
 * *prints* `.navbook/` once the repository says otherwise. Every assertion
 * here is end-to-end through the real binary, because a leak of the old
 * constant would typecheck perfectly and only show up in output.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { deterministicEnv, makeTempRepo, navCommand, type TempRepo } from "../helpers/temprepo.ts";

const NAV_ROOT = ".issues";
const RENAMED: NodeJS.ProcessEnv = { NAV_ROOT };

/** A repository initialized under a renamed root, with the marker committed. */
function makeRenamedRepo(): TempRepo {
  const repo = makeTempRepo();
  const result = repo.nav(["init", "--commit"], RENAMED);
  if (result.code !== 0) throw new Error(`nav init failed: ${result.stderr}`);
  return repo;
}

/** Everything `nav` printed, so one assertion can scan all of it. */
function output(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`;
}

describe("a renamed Navbook directory", () => {
  it("init creates the tree under the configured name, and nowhere else", () => {
    const repo = makeRenamedRepo();
    try {
      assert.ok(existsSync(join(repo.dir, ".issues", "issues", "open")));
      assert.ok(existsSync(join(repo.dir, ".issues", "navbook.json")));
      assert.ok(!existsSync(join(repo.dir, ".navbook")), "nothing may be left at the default");
    } finally {
      repo.cleanup();
    }
  });

  it("init writes a marker that is versioned JSON", () => {
    const repo = makeRenamedRepo();
    try {
      const marker = readFileSync(join(repo.dir, ".issues", "navbook.json"), "utf8");
      assert.deepEqual(JSON.parse(marker), { version: 1 });
    } finally {
      repo.cleanup();
    }
  });

  it("commits the marker, so a clone can find the directory", () => {
    const repo = makeRenamedRepo();
    try {
      const tracked = repo.git(["ls-files", "--", ".issues/navbook.json"]);
      assert.equal(tracked.stdout.trim(), ".issues/navbook.json");
    } finally {
      repo.cleanup();
    }
  });

  it("finds the directory afterwards with no environment set at all", () => {
    // The whole point of the marker: a contributor who never sets NAV_ROOT.
    const repo = makeRenamedRepo();
    try {
      const opened = repo.nav(["issue", "open", "Renamed", "-m", "Body.", "--commit"], {
        ...RENAMED,
        NAV_IDS: "ren11111",
      });
      assert.equal(opened.code, 0, opened.stderr);

      const listed = repo.nav(["issue", "list", "--json"]);
      assert.equal(listed.code, 0, listed.stderr);
      assert.match(listed.stdout, /"path":"\.issues\/issues\/open\/ren11111-renamed"/);
    } finally {
      repo.cleanup();
    }
  });

  it("never prints the default name anywhere across the whole lifecycle", () => {
    const repo = makeRenamedRepo();
    try {
      const runs = [
        repo.nav(["init"], RENAMED),
        repo.nav(["issue", "open", "Leaky", "-m", "Body.", "--commit"], {
          ...RENAMED,
          NAV_IDS: "lky11111",
        }),
        repo.nav(["issue", "comment", "lky1", "-m", "A note.", "--commit"], {
          ...RENAMED,
          NAV_IDS: "cmt11111",
        }),
        repo.nav(["issue", "show", "lky1"], RENAMED),
        repo.nav(["issue", "show", "lky1", "--json"], RENAMED),
        repo.nav(["issue", "list"], RENAMED),
        repo.nav(["issue", "list", "--json"], RENAMED),
        repo.nav(["issue", "close", "lky1", "--resolution", "fixed", "--commit"], RENAMED),
        repo.nav(["issue", "reopen", "lky1", "--commit"], RENAMED),
        repo.nav(["doctor"], RENAMED),
        repo.nav(["doctor", "--json"], RENAMED),
      ];
      for (const result of runs) {
        assert.ok(
          !output(result).includes(".navbook"),
          `a command still names the default root:\n${output(result)}`,
        );
      }
      // And the paths it does print are the configured ones, so the assertion
      // above is not passing merely because nothing printed a path at all.
      const shown = repo.nav(["issue", "show", "lky1"], RENAMED);
      assert.match(shown.stdout, /\.issues\/issues\/open\/lky11111-leaky\//);
    } finally {
      repo.cleanup();
    }
  });

  it("reports diagnostics against the configured name", () => {
    const repo = makeRenamedRepo();
    try {
      repo.write(
        ".issues/issues/open/bad11111-broken/issue.md",
        "---\ntitle: [unclosed\n---\n\nX.\n",
      );
      const result = repo.nav(["doctor", "--json"], RENAMED);
      assert.match(result.stdout, /"path":"\.issues\/issues\/open/);
      assert.ok(!result.stdout.includes(".navbook"));
    } finally {
      repo.cleanup();
    }
  });

  it("says which directory is missing, using the configured name", () => {
    const repo = makeTempRepo();
    try {
      const result = repo.nav(["issue", "list"], RENAMED);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no \.issues\/ at the repository root/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a second init at the configured name", () => {
    const repo = makeRenamedRepo();
    try {
      const result = repo.nav(["init"], RENAMED);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /\.issues\/ already exists/);
    } finally {
      repo.cleanup();
    }
  });

  it("keeps two roots in one repository apart", () => {
    // Not a supported arrangement, but it isolates the plumbing: if any path
    // were still built from a constant, these two would collide.
    const repo = makeTempRepo();
    try {
      repo.nav(["init", "--commit"]);
      repo.nav(["init", "--commit"], RENAMED);
      repo.nav(["issue", "open", "Default", "-m", "Body.", "--commit"], { NAV_IDS: "def11111" });
      repo.nav(["issue", "open", "Renamed", "-m", "Body.", "--commit"], {
        ...RENAMED,
        NAV_IDS: "ren22222",
      });

      const fromDefault = repo.nav(["issue", "list", "--json"], { NAV_ROOT: ".navbook" });
      assert.match(fromDefault.stdout, /def11111/);
      assert.ok(!fromDefault.stdout.includes("ren22222"));

      const fromRenamed = repo.nav(["issue", "list", "--json"], RENAMED);
      assert.match(fromRenamed.stdout, /ren22222/);
      assert.ok(!fromRenamed.stdout.includes("def11111"));
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to guess when two directories both claim to be the root", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init", "--commit"], { NAV_ROOT: ".issues" });
      repo.nav(["init", "--commit"], { NAV_ROOT: "tracker" });
      const result = repo.nav(["issue", "list"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /more than one Navbook directory found/);
      assert.match(result.stderr, /\.issues/);
      assert.match(result.stderr, /tracker/);
      assert.match(result.stderr, /NAV_ROOT/, "the message must say how to resolve it");
    } finally {
      repo.cleanup();
    }
  });

  it("rejects a NAV_ROOT that git would read as a pathspec", () => {
    const repo = makeTempRepo();
    try {
      const result = repo.nav(["init"], { NAV_ROOT: ".nav*" });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /NAV_ROOT/);
      assert.ok(!existsSync(join(repo.dir, ".nav*")), "nothing may be created from a bad value");
    } finally {
      repo.cleanup();
    }
  });

  it("rejects a NAV_ROOT that escapes the repository, creating nothing", () => {
    const repo = makeTempRepo();
    try {
      const result = repo.nav(["init"], { NAV_ROOT: "../escaped" });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /NAV_ROOT/);
      assert.ok(!existsSync(join(repo.dir, "..", "escaped")));
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a NAV_ROOT that names a plain file, rather than reading it as empty", () => {
    const repo = makeTempRepo();
    try {
      repo.write("notadir", "x\n");
      const listed = repo.nav(["issue", "list"], { NAV_ROOT: "notadir" });
      assert.equal(listed.code, 1, listed.stdout);
      assert.match(listed.stderr, /not a Navbook repository: no notadir\//);

      // And init says what is actually in the way, rather than creating it.
      const init = repo.nav(["init"], { NAV_ROOT: "notadir" });
      assert.equal(init.code, 1);
      assert.match(init.stderr, /notadir\/ already exists/);
    } finally {
      repo.cleanup();
    }
  });

  it("discovers the root from a subdirectory, not from the working directory", () => {
    // Discovery scans the *repository root*, which is not where the command was
    // run. The shared harness always spawns at the top, so this one runs the
    // binary itself to get a cwd deeper in the tree.
    const repo = makeRenamedRepo();
    try {
      repo.write("src/deep/file.txt", "x\n");
      const command = navCommand();
      const result = spawnSync(
        command[0] as string,
        [...command.slice(1), "issue", "list", "--json"],
        {
          cwd: join(repo.dir, "src", "deep"),
          encoding: "utf8",
          env: deterministicEnv(repo.home),
        },
      );
      assert.equal(result.status, 0, result.stderr);
      // Nothing to list yet, but resolving the root at all is the assertion:
      // a failure here exits 1 with "not a Navbook repository".
      assert.equal(result.stderr, "");
    } finally {
      repo.cleanup();
    }
  });
});

describe("pull requests under a renamed root", () => {
  /**
   * Pull requests are the paths that reach git with the directory's name in a
   * *pathspec* rather than in a message: `pr list --all-refs` runs `ls-tree`
   * against every branch, and `pr merge` checks the directory out of the
   * branch that carries it. Both were built from the old constant.
   */
  function withOpenPr(): TempRepo {
    const repo = makeTempRepo();
    repo.nav(["init", "--commit"], RENAMED);
    repo.write("app.txt", "original\n");
    repo.commitAll("feat: initial code");

    repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
    repo.write("auth.txt", "token handling\n");
    repo.commitAll("feat: rework auth tokens");

    const opened = repo.nav(["pr", "open", "--title", "Auth", "-m", "Body.", "--commit"], {
      ...RENAMED,
      NAV_IDS: "dk3mp2x9",
    });
    assert.equal(opened.code, 0, opened.stderr);
    repo.git(["checkout", "--quiet", "main"]);
    return repo;
  }

  it("scans other branches for open pull requests", () => {
    // The pull request is not in this working tree at all: it is found by
    // reading the branch, which needs the right path inside `git ls-tree`.
    const repo = withOpenPr();
    try {
      const result = repo.nav(["pr", "list", "--all-refs", "--json"], RENAMED);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /"path":"\.issues\/prs\/open\/dk3mp2x9-auth"/);
      assert.ok(!result.stdout.includes(".navbook"));
    } finally {
      repo.cleanup();
    }
  });

  it("declines from the default branch, checking the directory out first", () => {
    // `pr close` on a branch that does not hold the pull request has to
    // materialize it first — a `git checkout <ref> -- <path>` whose path is
    // built from the directory's name.
    const repo = withOpenPr();
    try {
      const result = repo.nav(["pr", "close", "dk3m", "--commit"], RENAMED);
      assert.equal(result.code, 0, result.stderr);
      assert.ok(!output(result).includes(".navbook"), output(result));
      assert.ok(existsSync(join(repo.dir, ".issues", "prs", "closed", "dk3mp2x9-auth")));
    } finally {
      repo.cleanup();
    }
  });

  it("merges, checking the directory out of the branch that carries it", () => {
    const repo = withOpenPr();
    try {
      const result = repo.nav(["pr", "merge", "dk3m"], RENAMED);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /\.issues\/prs\/merged\/dk3mp2x9-auth\//);
      assert.ok(!output(result).includes(".navbook"));
      assert.ok(existsSync(join(repo.dir, ".issues", "prs", "merged", "dk3mp2x9-auth")));
      assert.equal(repo.nav(["doctor"], RENAMED).code, 0);
    } finally {
      repo.cleanup();
    }
  });
});

describe("a nested root", () => {
  it("is created, used, and then found through the git index", () => {
    // Too deep for the one-level scan, so only the `git ls-files` pass can
    // find it — and only once the marker has been staged.
    const repo = makeTempRepo();
    const nested = { NAV_ROOT: ".github/navbook" };
    try {
      assert.equal(repo.nav(["init", "--commit"], nested).code, 0);
      assert.ok(existsSync(join(repo.dir, ".github", "navbook", "navbook.json")));

      const opened = repo.nav(["issue", "open", "Nested", "-m", "Body.", "--commit"], {
        ...nested,
        NAV_IDS: "nst11111",
      });
      assert.equal(opened.code, 0, opened.stderr);

      // No environment at all from here on.
      const listed = repo.nav(["issue", "list", "--json"]);
      assert.equal(listed.code, 0, listed.stderr);
      assert.match(listed.stdout, /"path":"\.github\/navbook\/issues\/open\/nst11111-nested"/);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });
});

describe("the default root", () => {
  it("still works with no marker present, as every existing repository is", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init", "--commit"]);
      // Remove the marker: this is byte-for-byte an older repository.
      repo.git(["rm", "--quiet", "--", ".navbook/navbook.json"]);
      repo.commitAll("chore: pretend this predates the marker");
      assert.ok(!existsSync(join(repo.dir, ".navbook", "navbook.json")));

      const opened = repo.nav(["issue", "open", "Legacy", "-m", "Body.", "--commit"], {
        NAV_IDS: "leg11111",
      });
      assert.equal(opened.code, 0, opened.stderr);

      const listed = repo.nav(["issue", "list", "--json"]);
      assert.match(listed.stdout, /"path":"\.navbook\/issues\/open\/leg11111-legacy"/);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("does not treat the marker as a tree problem", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init", "--commit"]);
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No problems found\./);
      assert.ok(!result.stdout.includes("navbook.json"));
    } finally {
      repo.cleanup();
    }
  });
});
