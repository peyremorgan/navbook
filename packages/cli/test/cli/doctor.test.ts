/**
 * `nav doctor` behavior that needs a real repository: the index, `--fix`, and
 * the interaction with git history.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeNavRepo, makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

/** Put an issue in `closed/` with a comment stranded under `open/`. */
function strandedComment(repo: TempRepo): void {
  repo.nav(["issue", "open", "Raced", "-m", "Body.", "--commit"], { NAV_IDS: "rce11111" });
  repo.nav(["issue", "close", "rce1", "--resolution", "fixed", "--commit"]);
  repo.write(
    ".navbook/issues/open/rce11111-raced/comments/2026-08-05T100000Z-ccc11111.md",
    "---\nauthor: bob@example.com\n---\n\nStranded by a merge.\n",
  );
  repo.commitAll("chore: simulate the merge outcome");
}

describe("nav doctor", () => {
  it("reports a clean tree and exits zero", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Fine", "-m", "Body.", "--commit"], { NAV_IDS: "fff11111" });
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No problems found\./);
    } finally {
      repo.cleanup();
    }
  });

  it("exits 2 on a format violation and 0 when only warnings are present", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Warns", "-m", "See #zzzz9999 for context."], {
        NAV_IDS: "wrn11111",
      });
      const warned = repo.nav(["doctor"]);
      assert.equal(warned.code, 0);
      assert.match(warned.stdout, /warning {2}D8/);

      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      const failed = repo.nav(["doctor"]);
      assert.equal(failed.code, 2);
      assert.match(failed.stdout, /error {2}D1/);
    } finally {
      repo.cleanup();
    }
  });

  it("--staged judges the index, not the working tree", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Fine", "-m", "Body.", "--commit"], { NAV_IDS: "stg11111" });
      // Broken on disk, but never staged: --staged must not see it.
      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      assert.equal(repo.nav(["doctor", "--staged"]).code, 0);
      assert.equal(repo.nav(["doctor"]).code, 2);

      repo.git(["add", "-A"]);
      assert.equal(repo.nav(["doctor", "--staged"]).code, 2, "staging it makes it visible");
    } finally {
      repo.cleanup();
    }
  });

  it("--fix repairs a comment stranded by a merge and prunes the empty directory", () => {
    const repo = makeNavRepo();
    try {
      strandedComment(repo);
      const before = repo.nav(["doctor"]);
      assert.equal(before.code, 2);
      assert.match(before.stdout, /stray comment file/);

      const fixed = repo.nav(["doctor", "--fix"]);
      assert.equal(fixed.code, 0, fixed.stderr);
      assert.match(fixed.stdout, /fixed {2}moved/);

      assert.ok(
        existsSync(
          join(
            repo.dir,
            ".navbook/issues/closed/rce11111-raced/comments/2026-08-05T100000Z-ccc11111.md",
          ),
        ),
      );
      assert.equal(
        existsSync(join(repo.dir, ".navbook/issues/open/rce11111-raced")),
        false,
        "the emptied directory is gone, matching what a fresh clone would hold",
      );
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("stages what --fix changed, so the repair can be committed directly", () => {
    const repo = makeNavRepo();
    try {
      strandedComment(repo);
      repo.nav(["doctor", "--fix"]);
      const staged = repo.git(["diff", "--cached", "--name-only"]).stdout;
      assert.match(staged, /issues\/closed\/rce11111-raced\/comments\//);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves a violation it cannot repair alone", () => {
    const repo = makeNavRepo();
    try {
      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      const result = repo.nav(["doctor", "--fix"]);
      assert.equal(result.code, 2);
      assert.ok(existsSync(join(repo.dir, ".navbook/issues/open/Bad_Name/issue.md")));
    } finally {
      repo.cleanup();
    }
  });

  it("warns about a commit trailer naming an entity that is not in the tree", () => {
    const repo = makeNavRepo();
    try {
      repo.write("app.txt", "x\n");
      repo.git(["add", "-A"]);
      repo.git(["commit", "-m", "fix: something\n\nCloses: zzzz9999\n"]);
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /commit trailer references #zzzz9999/);
    } finally {
      repo.cleanup();
    }
  });

  it("does not warn about a trailer that resolves", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Real", "-m", "Body.", "--commit"], { NAV_IDS: "rea11111" });
      repo.write("app.txt", "x\n");
      repo.git(["add", "-A"]);
      repo.git(["commit", "-m", "fix: something\n\nCloses: rea11111\n"]);
      assert.equal(repo.nav(["doctor"]).stdout.includes("trailer"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("emits newline-delimited JSON whose messages are separate from the codes", () => {
    const repo = makeNavRepo();
    try {
      repo.write(".navbook/issues/open/Bad_Name/issue.md", "---\ntitle: t\n---\n\nbody\n");
      const result = repo.nav(["doctor", "--json"]);
      assert.equal(result.code, 2);
      const objects = result.stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(objects.length, 1);
      assert.equal(objects[0]?.check, "D1");
      assert.equal(objects[0]?.level, "error");
      assert.equal(objects[0]?.path, ".navbook/issues/open/Bad_Name/issue.md");
      assert.equal(typeof objects[0]?.message, "string");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to run in a repository that has no .navbook/", () => {
    const repo = makeTempRepo();
    try {
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 1, "an operational error, not a format violation");
      assert.match(result.stderr, /not a Navbook repository/);
    } finally {
      repo.cleanup();
    }
  });
});
