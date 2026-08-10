/**
 * `nav __complete`, the backend the shell completion scripts call.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeNavRepo, makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

function complete(repo: TempRepo, words: string[]): string[] {
  const result = repo.nav(["__complete", ...words]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.split("\n").filter((line) => line !== "");
}

function seeded(): TempRepo {
  const repo = makeNavRepo();
  repo.nav(["issue", "open", "Login times out", "-m", "Body.", "--label", "bug", "--commit"], {
    NAV_IDS: "bqlybac0",
  });
  repo.write("app.txt", "x\n");
  repo.commitAll("feat: code");
  repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
  repo.write("auth.txt", "y\n");
  repo.commitAll("feat: auth");
  repo.nav(["pr", "open", "--title", "Auth refactor", "-m", "Body.", "--commit"], {
    NAV_IDS: "dk3mp2x9",
  });
  return repo;
}

describe("nav __complete", () => {
  it("offers the root commands when nothing has been typed", () => {
    const repo = makeNavRepo();
    try {
      const candidates = complete(repo, []);
      for (const command of ["issue", "pr", "init", "id", "doctor", "install"]) {
        assert.ok(candidates.includes(command), `expected ${command}`);
      }
      assert.equal(candidates.includes("help"), false, "there is no help subcommand to offer");
    } finally {
      repo.cleanup();
    }
  });

  it("offers each noun the shared verbs plus the ones only it has", () => {
    const repo = makeNavRepo();
    try {
      const issueVerbs = complete(repo, ["issue"]);
      const prVerbs = complete(repo, ["pr"]);
      assert.deepEqual(issueVerbs, [
        "open",
        "list",
        "show",
        "edit",
        "comment",
        "close",
        "reopen",
        "delete",
        "link",
        "unlink",
      ]);
      for (const verb of ["update", "review", "merge"]) {
        assert.ok(prVerbs.includes(verb), `pr should offer ${verb}`);
        assert.equal(issueVerbs.includes(verb), false, `issues should not offer ${verb}`);
      }
      for (const verb of ["link", "unlink"]) {
        assert.equal(prVerbs.includes(verb), false, `pull requests should not offer ${verb}`);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("offers IDs and directory names for verbs that take one, of the right kind only", () => {
    const repo = seeded();
    try {
      const forIssue = complete(repo, ["issue", "show"]);
      assert.ok(forIssue.includes("bqlybac0"));
      assert.ok(
        forIssue.some((c) => c.startsWith("bqlybac0-")),
        "the readable directory name too",
      );
      assert.equal(forIssue.includes("dk3mp2x9"), false, "not the pull request");

      const forPr = complete(repo, ["pr", "show"]);
      assert.ok(forPr.includes("dk3mp2x9"));
      assert.equal(forPr.includes("bqlybac0"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("completes a directory name into something the CLI actually accepts", () => {
    const repo = seeded();
    try {
      const name = complete(repo, ["issue", "show"]).find((c) => c.startsWith("bqlybac0-"));
      assert.ok(name);
      const shown = repo.nav(["issue", "show", name]);
      assert.equal(shown.code, 0, shown.stderr);
      assert.match(shown.stdout, /#bqlybac0/);
    } finally {
      repo.cleanup();
    }
  });

  it("offers query keys and the labels actually in use for list", () => {
    const repo = seeded();
    try {
      const candidates = complete(repo, ["issue", "list"]);
      assert.ok(candidates.includes("status:"));
      assert.ok(candidates.includes("label:bug"));
    } finally {
      repo.cleanup();
    }
  });

  it("offers nothing once an ID has been supplied", () => {
    const repo = seeded();
    try {
      assert.deepEqual(complete(repo, ["issue", "show", "bqlybac0"]), []);
      assert.deepEqual(complete(repo, ["issue", "open"]), []);
    } finally {
      repo.cleanup();
    }
  });

  it("stays silent, and successful, outside a Navbook repository", () => {
    const repo = makeTempRepo();
    try {
      assert.deepEqual(complete(repo, ["issue", "show"]), [], "no candidates, but no error either");
      assert.ok(complete(repo, []).includes("init"));
    } finally {
      repo.cleanup();
    }
  });

  it("ignores an unknown noun rather than failing", () => {
    const repo = makeNavRepo();
    try {
      assert.deepEqual(complete(repo, ["nonsense", "verb"]), []);
    } finally {
      repo.cleanup();
    }
  });
});

describe("generated completion scripts", () => {
  it("call back into nav __complete for every shell", () => {
    const repo = makeNavRepo();
    try {
      for (const shell of ["bash", "zsh", "fish"]) {
        const result = repo.nav(["install", `--completions=${shell}`]);
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /nav __complete/, `${shell} script should delegate`);
      }
    } finally {
      repo.cleanup();
    }
  });
});
