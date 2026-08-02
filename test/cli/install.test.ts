/**
 * `nav install` / `nav uninstall` and the pre-commit hook.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { makeNavRepo, makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

const HOOK = ".git/hooks/pre-commit";

/** A PATH on which `nav` resolves to this working copy, as a real install would. */
function pathWithNav(repo: TempRepo): string {
  const script = repo.script(
    "nav",
    `exec ${process.execPath} ${join(process.cwd(), "src/cli/main.ts")} "$@"`,
  );
  return `${dirname(script)}:${process.env.PATH}`;
}

function hookText(repo: TempRepo): string {
  return readFileSync(join(repo.dir, HOOK), "utf8");
}

describe("nav install", () => {
  it("prints every action before doing anything and aborts on a no", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["install", "--hooks"]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /nav install will:/);
      assert.match(result.stdout, /append the navbook block to .*pre-commit/);
      assert.match(result.stdout, /Aborted\./, "no answer on a closed stdin means no");
      assert.equal(existsSync(join(repo.dir, HOOK)), false, "nothing was written");
    } finally {
      repo.cleanup();
    }
  });

  it("installs the alias, merge config, hook and completions with --yes", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["install", "-y"]);
      assert.equal(result.code, 0, result.stderr);

      assert.equal(repo.git(["config", "--global", "--get", "alias.nav"]).stdout.trim(), "!nav");
      assert.equal(
        repo.git(["config", "--local", "--get", "merge.directoryRenames"]).stdout.trim(),
        "true",
      );
      assert.match(hookText(repo), /nav doctor --staged/);
      assert.ok(existsSync(join(repo.home, ".local/share/bash-completion/completions/nav")));
    } finally {
      repo.cleanup();
    }
  });

  it("honours a custom alias name", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "--alias=issue", "-y"]);
      assert.equal(repo.git(["config", "--global", "--get", "alias.issue"]).stdout.trim(), "!nav");
    } finally {
      repo.cleanup();
    }
  });

  it("never overwrites an alias the user already defined", () => {
    const repo = makeNavRepo();
    try {
      repo.git(["config", "--global", "alias.nav", "!echo mine"]);
      const result = repo.nav(["install", "--alias", "-y"]);
      assert.match(result.stdout, /already exists/);
      assert.equal(
        repo.git(["config", "--global", "--get", "alias.nav"]).stdout.trim(),
        "!echo mine",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("is idempotent", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "-y"]);
      const second = repo.nav(["install", "-y"]);
      assert.equal(second.code, 0);
      assert.match(second.stdout, /already/);
      const occurrences = hookText(repo).match(/>>> navbook >>>/g) ?? [];
      assert.equal(occurrences.length, 1, "the hook block is not appended twice");
    } finally {
      repo.cleanup();
    }
  });

  it("prints a completion script to stdout without touching anything", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["install", "--completions=fish"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /complete -c nav/);
      assert.equal(
        result.stdout.includes("nav install will:"),
        false,
        "no prompt for a pure print",
      );
      assert.equal(existsSync(join(repo.home, ".config/fish/completions/nav.fish")), false);
    } finally {
      repo.cleanup();
    }
  });

  it("rejects an unknown shell", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["install", "--completions=tcsh"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /unknown shell 'tcsh'/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("the pre-commit hook", () => {
  it("appends to an existing hook and leaves it intact on removal", () => {
    const repo = makeNavRepo();
    try {
      writeFileSync(join(repo.dir, HOOK), "#!/bin/sh\necho mine\n", { mode: 0o755 });
      repo.nav(["install", "--hooks", "-y"]);
      assert.match(hookText(repo), /echo mine/);
      assert.match(hookText(repo), />>> navbook >>>/);

      repo.nav(["uninstall", "--hooks", "-y"]);
      const after = hookText(repo);
      assert.match(after, /echo mine/);
      assert.equal(after.includes("navbook"), false, "exactly the marked block was removed");
    } finally {
      repo.cleanup();
    }
  });

  it("deletes a hook it created outright", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "--hooks", "-y"]);
      repo.nav(["uninstall", "--hooks", "-y"]);
      assert.equal(existsSync(join(repo.dir, HOOK)), false);
    } finally {
      repo.cleanup();
    }
  });

  it("blocks a commit that would stage a format violation", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "--hooks", "-y"]);
      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      repo.git(["add", "-A"]);

      const result = repo.git(["commit", "-m", "should be blocked"], { PATH: pathWithNav(repo) });
      assert.equal(
        result.code,
        1,
        `commit should have been blocked:\n${result.stdout}${result.stderr}`,
      );
      assert.match(result.stdout + result.stderr, /D1/);
    } finally {
      repo.cleanup();
    }
  });

  it("lets a clean commit through, and warnings never block", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "--hooks", "-y"]);
      repo.nav(["issue", "open", "Dangling ref", "-m", "See #zzzz9999 which does not exist."], {
        NAV_IDS: "hok11111",
      });

      const result = repo.git(["commit", "-m", "nb: open #hok11111"], { PATH: pathWithNav(repo) });
      assert.equal(result.code, 0, `warnings must not block:\n${result.stdout}${result.stderr}`);
    } finally {
      repo.cleanup();
    }
  });

  it("does not break commits in a clone where nav is not installed", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "--hooks", "-y"]);
      repo.write("app.txt", "x\n");
      repo.git(["add", "-A"]);
      // The default PATH has no `nav` on it, which is exactly the situation in
      // a clone by someone who has not installed the tool.
      const result = repo.git(["commit", "-m", "feat: work"]);
      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav uninstall", () => {
  it("removes the alias and merge config it set", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["install", "-y"]);
      repo.nav(["uninstall", "-y"]);
      assert.equal(repo.git(["config", "--global", "--get", "alias.nav"]).code, 1);
      assert.equal(repo.git(["config", "--local", "--get", "merge.directoryRenames"]).code, 1);
    } finally {
      repo.cleanup();
    }
  });

  it("reports that there is nothing to do on a clean environment", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["uninstall", "--alias", "--hooks", "--merge-config", "-y"]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Nothing to do\./);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves a completions file navbook did not write alone", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init"]);
      const path = join(repo.home, ".config/fish/completions/nav.fish");
      repo.write("../home/.config/fish/completions/nav.fish", "# hand written\n");
      writeFileSync(path, "# hand written\n");
      repo.nav(["uninstall", "--completions=fish", "-y"]);
      assert.equal(readFileSync(path, "utf8"), "# hand written\n");
    } finally {
      repo.cleanup();
    }
  });
});
