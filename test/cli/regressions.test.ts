/**
 * Regression tests for bugs found by review, each of which had no coverage.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scanAllIds } from "../../src/cli/workspace.ts";
import { makeNavRepo, type TempRepo } from "../helpers/temprepo.ts";

function withIssue(): TempRepo {
  const repo = makeNavRepo();
  repo.nav(["issue", "open", "Editable", "-m", "Body.", "--commit"], { NAV_IDS: "edt11111" });
  return repo;
}

function withOpenPr(): TempRepo {
  const repo = makeNavRepo();
  repo.write("app.txt", "original\n");
  repo.commitAll("feat: initial code");
  repo.git(["checkout", "--quiet", "-b", "feat/auth"]);
  repo.write("auth.txt", "token handling\n");
  repo.commitAll("feat: rework auth tokens");
  repo.nav(["pr", "open", "--title", "Refactor auth", "-m", "Body.", "--commit"], {
    NAV_IDS: "dk3mp2x9",
    NAV_NOW: "2026-08-04T16:40:00Z",
  });
  repo.git(["checkout", "--quiet", "main"]);
  repo.write("other.txt", "unrelated\n");
  repo.commitAll("feat: unrelated work on main");
  return repo;
}

describe("edit --commit", () => {
  it("commits the file it just edited instead of calling it unrelated", () => {
    const repo = withIssue();
    try {
      const editor = repo.script("editor.sh", 'printf "More detail.\\n" >> "$1"');
      const result = repo.nav(["issue", "edit", "edt1", "--commit"], { EDITOR: editor });
      assert.equal(result.code, 0, result.stderr);

      const committed = repo.git(["show", "--name-only", "--format=%s", "HEAD"]).stdout;
      assert.match(committed, /nb: edit #edt11111/);
      assert.match(committed, /edt11111-editable\/issue\.md/);
      assert.equal(repo.git(["status", "--porcelain"]).stdout.trim(), "", "nothing left staged");
    } finally {
      repo.cleanup();
    }
  });

  it("still refuses when something genuinely unrelated is staged", () => {
    const repo = withIssue();
    try {
      repo.write("app.py", "print('hi')\n");
      repo.git(["add", "app.py"]);
      const editor = repo.script("editor.sh", 'printf "More.\\n" >> "$1"');
      const result = repo.nav(["issue", "edit", "edt1", "--commit"], { EDITOR: editor });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /unrelated changes already staged/);
      assert.match(result.stderr, /app\.py/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("pull-request ID resolution", () => {
  it("accepts a full directory name, as completion offers it", () => {
    const repo = withOpenPr();
    try {
      const result = repo.nav([
        "pr",
        "close",
        "dk3mp2x9-refactor-auth",
        "--resolution",
        "declined",
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.ok(existsSync(join(repo.dir, ".navbook/prs/closed/dk3mp2x9-refactor-auth/pr.md")));
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a prefix shorter than four characters, even for merge", () => {
    const repo = withOpenPr();
    try {
      const result = repo.nav(["pr", "merge", "d"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /at least 4 characters/);
      assert.equal(repo.git(["log", "--merges", "--oneline"]).stdout.trim(), "", "nothing merged");
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav pr merge", () => {
  it("archives the pull request inside the merge commit itself", () => {
    const repo = withOpenPr();
    try {
      const result = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(result.code, 0, result.stderr);

      const mergeSha = repo.git(["rev-list", "--merges", "-1", "HEAD"]).stdout.trim();
      assert.notEqual(mergeSha, "", "a merge commit exists");
      const atMerge = repo.git(["ls-tree", "-r", "--name-only", mergeSha, ".navbook"]).stdout;
      assert.match(atMerge, /prs\/merged\/dk3mp2x9-refactor-auth\/pr\.md/);
      assert.equal(
        atMerge.includes("prs/open/dk3mp2x9"),
        false,
        "spec 04 §4.3: the move happens inside the merge, not only after it",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("prefers a local branch over a remote one when source is absent", () => {
    const repo = withOpenPr();
    try {
      // Drop `source:`, which is only a SHOULD, and give the PR a second home.
      repo.git(["checkout", "--quiet", "feat/auth"]);
      const path = ".navbook/prs/open/dk3mp2x9-refactor-auth/pr.md";
      repo.write(path, readFileSync(join(repo.dir, path), "utf8").replace(/^source: .*\n/m, ""));
      repo.commitAll("nb: edit #dk3mp2x9");
      repo.git(["update-ref", "refs/remotes/origin/feat/auth", "HEAD"]);
      repo.git(["checkout", "--quiet", "main"]);

      const listed = repo.nav(["pr", "list", "--all-refs", "--json"]).stdout.trim();
      const entry = JSON.parse(listed) as { refs: string[] };
      assert.ok(entry.refs.includes("feat/auth"), entry.refs.join(","));

      const merged = repo.nav(["pr", "merge", "dk3m"], { NAV_NOW: "2026-08-07T12:00:00Z" });
      assert.equal(merged.code, 0, merged.stderr);
    } finally {
      repo.cleanup();
    }
  });
});

describe("malformed frontmatter", () => {
  it("reports the file instead of surfacing a YAML library message", () => {
    const repo = withIssue();
    try {
      const path = ".navbook/issues/open/edt11111-editable/issue.md";
      repo.write(
        path,
        "---\ntitle: [unclosed\nauthor: a@b.co\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n",
      );
      repo.commitAll("chore: break the frontmatter by hand");

      const result = repo.nav(["issue", "close", "edt1", "--resolution", "fixed"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /issue\.md/, "the message names the file");
      assert.match(result.stderr, /not valid YAML/);
      assert.match(result.stderr, /nav doctor/, "and says how to find out more");
    } finally {
      repo.cleanup();
    }
  });

  it("still lets a move with no rewrite through", () => {
    const repo = withIssue();
    try {
      const path = ".navbook/issues/open/edt11111-editable/issue.md";
      repo.write(path, "---\ntitle: [unclosed\nauthor: a@b.co\n---\n\nBody.\n");
      repo.commitAll("chore: break the frontmatter by hand");
      assert.equal(repo.nav(["issue", "close", "edt1"]).code, 0, "a plain move rewrites nothing");
    } finally {
      repo.cleanup();
    }
  });
});

describe("ID minting", () => {
  it("counts comment IDs as taken, not just entity IDs", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Host", "-m", "Body.", "--commit"], { NAV_IDS: "hst11111" });
      repo.nav(["issue", "comment", "hst1", "-m", "A comment.", "--commit"], {
        NAV_IDS: "cmt22222",
        NAV_NOW: "2026-08-03T14:12:07Z",
      });

      // §2.2 requires uniqueness across entity *and* comment IDs, so the set a
      // new entity avoids must include both.
      const taken = scanAllIds(join(repo.dir, ".navbook"));
      assert.ok(taken.has("hst11111"), "the entity");
      assert.ok(taken.has("cmt22222"), "and the comment, whose id is only in a filename");
    } finally {
      repo.cleanup();
    }
  });

  it("reads IDs from names alone, without opening the files", () => {
    const repo = makeNavRepo();
    try {
      // Unreadable as YAML, but its identity is still in the path.
      repo.write(".navbook/issues/closed/brk11111-broken/issue.md", "not even frontmatter\n");
      assert.ok(scanAllIds(join(repo.dir, ".navbook")).has("brk11111"));
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav install --completions", () => {
  it("prints the script for the detected shell when given no value", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["install", "--completions"], { SHELL: "/usr/bin/fish" });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /complete -c nav/, "fish script printed");
      assert.equal(result.stdout.includes("nav install will:"), false, "and nothing was changed");
      assert.equal(existsSync(join(repo.home, ".config/fish/completions/nav.fish")), false);
    } finally {
      repo.cleanup();
    }
  });
});
