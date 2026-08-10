/**
 * Decomposition end to end: both sides of a link written in one commit, and
 * every way a person can break one put back.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeNavRepo, type TempRepo } from "../helpers/temprepo.ts";

/**
 * A repository holding a two-generation tree, each issue in its own commit:
 *
 *   #aaa11111 Root
 *     #bbb22222 Design      (which owns #ddd44444 Details)
 *     #ccc33333 Build
 */
function seeded(): TempRepo {
  const repo = makeNavRepo();
  open(repo, "aaa11111", "Root");
  open(repo, "bbb22222", "Design", "aaa11111");
  open(repo, "ccc33333", "Build", "aaa11111");
  open(repo, "ddd44444", "Details", "bbb22222");
  return repo;
}

function open(repo: TempRepo, id: string, title: string, parent?: string): void {
  const args = ["issue", "open", title, "-m", `${title}.`, "--commit"];
  if (parent) args.push("--parent", parent);
  const result = repo.nav(args, { NAV_IDS: id });
  if (result.code !== 0) throw new Error(`fixture open failed: ${result.stderr}`);
}

const SLUGS: Record<string, string> = {
  aaa11111: "aaa11111-root",
  bbb22222: "bbb22222-design",
  ccc33333: "ccc33333-build",
  ddd44444: "ddd44444-details",
};

const fileOf = (repo: TempRepo, id: string): string =>
  join(repo.dir, ".navbook", "issues", "open", SLUGS[id] as string, "issue.md");

const read = (repo: TempRepo, id: string): string => readFileSync(fileOf(repo, id), "utf8");

/** Rewrite one issue's frontmatter by hand, as a person editing the file would. */
function handEdit(repo: TempRepo, id: string, from: string | RegExp, to: string): void {
  const path = fileOf(repo, id);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  assert.notEqual(after, before, `hand edit of #${id} matched nothing`);
  writeFileSync(path, after, "utf8");
}

describe("nav issue open --parent", () => {
  it("writes both sides of the link in one commit", () => {
    const repo = seeded();
    try {
      assert.match(read(repo, "bbb22222"), /^parent: aaa11111$/m);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[bbb22222, ccc33333\]$/m);

      // HEAD is #ddd44444's own commit; #ccc33333 was the one before it.
      const commit = repo.git(["log", "--format=%B", "-1", "HEAD~1"]).stdout;
      assert.equal(commit.trim(), "docs(issue): open #ccc33333\n\nRefs: aaa11111");
      assert.equal(
        repo.git(["show", "--name-only", "--format=", "HEAD~1"]).stdout.trim().split("\n").length,
        2,
        "one commit wrote both files",
      );
    } finally {
      repo.cleanup();
    }
  });

  it("says what it was filed under", () => {
    const repo = makeNavRepo();
    try {
      open(repo, "aaa11111", "Root");
      const result = repo.nav(["issue", "open", "Sub", "-m", "S.", "--parent", "aaa1"], {
        NAV_IDS: "bbb22222",
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Filed under #aaa11111 {2}Root$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses an unknown parent before anything is written", () => {
    const repo = makeNavRepo();
    try {
      const result = repo.nav(["issue", "open", "Sub", "-m", "S.", "--parent", "zzzz9999"], {
        NAV_IDS: "bbb22222",
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no issue matches 'zzzz9999'/);
      assert.equal(repo.nav(["issue", "list"]).stdout.includes("bbb22222"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("takes the parent from the composed file, so an editor has the last word", () => {
    const repo = seeded();
    try {
      // The author is given `parent: aaa11111` to edit and rewrites it.
      const editor = repo.script(
        "editor-reparent.sh",
        `sed -i 's/^parent: aaa11111$/parent: ccc33333/' "$1"; printf 'A body.\\n' >> "$1"`,
      );
      const result = repo.nav(["issue", "open", "Sub", "--parent", "aaa1"], {
        NAV_IDS: "eee55555",
        EDITOR: editor,
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Filed under #ccc33333 {2}Build$/m);
      assert.match(read(repo, "ccc33333"), /^subtasks: \[eee55555\]$/m);
      assert.equal(read(repo, "aaa11111").includes("eee55555"), false);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves no half-link when the author deletes the parent key outright", () => {
    const repo = seeded();
    try {
      const editor = repo.script(
        "editor-unparent.sh",
        `sed -i '/^parent: /d' "$1"; printf 'A body.\\n' >> "$1"`,
      );
      const result = repo.nav(["issue", "open", "Sub", "--parent", "aaa1"], {
        NAV_IDS: "eee55555",
        EDITOR: editor,
      });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.includes("Filed under"), false);
      assert.equal(read(repo, "aaa11111").includes("eee55555"), false);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("reads the parent's file as it stands after the editor, not before", () => {
    const repo = seeded();
    try {
      // Something else retitles the parent while the editor session is open.
      const editor = repo.script(
        "editor-meddle.sh",
        `sed -i 's/^title: Root$/title: Root, retitled/' ${JSON.stringify(fileOf(repo, "aaa11111"))}; printf 'A body.\\n' >> "$1"`,
      );
      const result = repo.nav(["issue", "open", "Sub", "--parent", "aaa1"], {
        NAV_IDS: "eee55555",
        EDITOR: editor,
      });
      assert.equal(result.code, 0, result.stderr);
      assert.match(read(repo, "aaa11111"), /^title: Root, retitled$/m);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[bbb22222, ccc33333, eee55555\]$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("names the parent's own file when its links cannot be read", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [bbb22222, 42]");
      const result = repo.nav(["issue", "open", "Sub", "-m", "S.", "--parent", "aaa1"], {
        NAV_IDS: "eee55555",
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /aaa11111-root\/issue\.md: 'subtasks' is not a list/);
      assert.match(result.stderr, /nav doctor/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a pull request as a parent", () => {
    const repo = makeNavRepo();
    try {
      repo.write("src/a.txt", "a\n");
      repo.commitAll("feat: something to review");
      repo.git(["checkout", "--quiet", "-b", "feat/x"]);
      repo.write("src/b.txt", "b\n");
      repo.commitAll("feat: more");
      const pr = repo.nav(["pr", "open", "--title", "Auth", "-m", "Body."], {
        NAV_IDS: "prr11111",
      });
      assert.equal(pr.code, 0, pr.stderr);

      const result = repo.nav(["issue", "open", "Sub", "-m", "S.", "--parent", "prr11111"], {
        NAV_IDS: "bbb22222",
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is a pull request/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav issue link", () => {
  it("files an unlinked issue and refers to both ends", () => {
    const repo = makeNavRepo();
    try {
      open(repo, "aaa11111", "Root");
      open(repo, "bbb22222", "Design");
      const result = repo.nav(["issue", "link", "bbb2", "--parent", "aaa1", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Filed #bbb22222 under #aaa11111 {2}Root$/m);

      assert.match(read(repo, "bbb22222"), /^parent: aaa11111$/m);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[bbb22222\]$/m);
      const message = repo.git(["log", "-1", "--format=%B"]).stdout;
      assert.equal(message.trim(), "docs(issue): link #bbb22222\n\nRefs: bbb22222\nRefs: aaa11111");
    } finally {
      repo.cleanup();
    }
  });

  it("asks before moving a subtask that already has a parent", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "link", "ddd4", "--parent", "ccc3"], undefined, "y\n");
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /#ddd44444 is already a subtask of #bbb22222 {2}Design/);
      assert.match(read(repo, "ddd44444"), /^parent: ccc33333$/m);
      assert.equal(read(repo, "bbb22222").includes("subtasks"), false);
      assert.match(read(repo, "ccc33333"), /^subtasks: \[ddd44444\]$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves the tree untouched when the question goes unanswered", () => {
    const repo = seeded();
    try {
      const before = read(repo, "ddd44444");
      const result = repo.nav(["issue", "link", "ddd4", "--parent", "ccc3"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /#ddd44444 was not moved/);
      assert.equal(read(repo, "ddd44444"), before);
      assert.match(read(repo, "bbb22222"), /^subtasks: \[ddd44444\]$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("moves it without asking under --force", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "link", "ddd4", "--parent", "ccc3", "--force"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.includes("already a subtask"), false);
      assert.match(read(repo, "ddd44444"), /^parent: ccc33333$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to make an issue its own parent, or to close a loop", () => {
    const repo = seeded();
    try {
      const self = repo.nav(["issue", "link", "aaa1", "--parent", "aaa1"]);
      assert.equal(self.code, 1);
      assert.match(self.stderr, /cannot be a subtask of itself/);

      const loop = repo.nav(["issue", "link", "aaa1", "--parent", "ddd4"]);
      assert.equal(loop.code, 1);
      assert.match(loop.stderr, /would form a loop/);
      assert.match(loop.stderr, /#ddd44444 -> #bbb22222 -> #aaa11111/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses only when there is genuinely nothing left to do", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "link", "bbb2", "--parent", "aaa1"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is already a subtask of #aaa11111/);
    } finally {
      repo.cleanup();
    }
  });

  it("settles the dispute doctor sends the user here to settle", () => {
    const repo = seeded();
    try {
      // #ccc33333 claims #bbb22222 as well, so doctor reports a conflict and
      // names this verb. Refusing "already a subtask" would be a dead end.
      handEdit(repo, "ccc33333", /^created: (.*)$/m, "created: $1\nsubtasks: [bbb22222]");
      const found = repo.nav(["doctor", "--fix"]);
      assert.equal(found.code, 2, found.stdout);
      assert.match(found.stdout, /settle it with 'nav issue link'/);

      const result = repo.nav(["issue", "link", "bbb2", "--parent", "aaa1"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Removed #bbb22222 from the subtasks of #ccc33333 {2}Build$/m);
      assert.equal(read(repo, "ccc33333").includes("subtasks"), false);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("mends a link a person wrote on one side only", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      assert.equal(repo.nav(["doctor"]).code, 2, "the halves disagree");

      const result = repo.nav(["issue", "link", "bbb2", "--parent", "aaa1"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[ccc33333, bbb22222\]$/m);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("drops the child's own claim on the issue it is being filed under", () => {
    const repo = seeded();
    try {
      // #ddd44444 lists its prospective parent as a subtask of its own. One of
      // the two has to go, and the command has just been told which way round.
      handEdit(repo, "ddd44444", /^created: (.*)$/m, "created: $1\nsubtasks: [ccc33333]");
      const result = repo.nav(["issue", "link", "ddd4", "--parent", "ccc3", "--force"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(read(repo, "ddd44444"), /^parent: ccc33333$/m);
      assert.equal(read(repo, "ddd44444").includes("subtasks"), false);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("takes the subtask off every list that still claims it", () => {
    const repo = seeded();
    try {
      handEdit(repo, "ccc33333", /^created: (.*)$/m, "created: $1\nsubtasks: [ddd44444]");
      const result = repo.nav(["issue", "link", "ddd4", "--parent", "aaa1", "--force"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(read(repo, "ccc33333").includes("subtasks"), false);
      assert.equal(read(repo, "bbb22222").includes("subtasks"), false);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[bbb22222, ccc33333, ddd44444\]$/m);
      // The old parent is named by the question that precedes the move; a
      // third issue nobody mentioned is not, so the command says so itself.
      assert.match(result.stdout, /^Removed #ddd44444 from the subtasks of #ccc33333 {2}Build$/m);
      assert.equal(result.stdout.includes("of #bbb22222"), false);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("links across status, since a closed parent is still where the work belongs", () => {
    const repo = makeNavRepo();
    try {
      open(repo, "aaa11111", "Root");
      open(repo, "bbb22222", "Design");
      assert.equal(repo.nav(["issue", "close", "aaa1", "--commit"]).code, 0);
      const result = repo.nav(["issue", "link", "bbb2", "--parent", "aaa1"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav issue unlink", () => {
  it("clears both sides", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "unlink", "ddd4", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Unlinked #ddd44444 from #bbb22222$/m);
      assert.equal(read(repo, "ddd44444").includes("parent"), false);
      assert.equal(read(repo, "bbb22222").includes("subtasks"), false);
      assert.match(
        repo.git(["log", "-1", "--format=%s"]).stdout,
        /docs\(issue\): unlink #ddd44444/,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("refuses an issue nothing claims", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "unlink", "aaa1"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is not a subtask of any issue/);
    } finally {
      repo.cleanup();
    }
  });

  it("is the way out of a half-link a person left behind", () => {
    const repo = seeded();
    try {
      handEdit(repo, "ddd44444", /^parent: .*$/m, "parent: zzzz9999");
      const result = repo.nav(["issue", "unlink", "ddd4"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(read(repo, "ddd44444").includes("parent"), false);
      assert.equal(read(repo, "bbb22222").includes("subtasks"), false);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav issue show, with links", () => {
  it("renders the parent and one level of subtasks by default", () => {
    const repo = seeded();
    try {
      const root = repo.nav(["issue", "show", "aaa1"]);
      assert.match(root.stdout, /^subtasks: {2}#bbb22222 Design \(open\)$/m);
      assert.match(root.stdout, /^ {11}#ccc33333 Build \(open\)$/m);
      assert.equal(root.stdout.includes("ddd44444"), false, "one level only");

      const middle = repo.nav(["issue", "show", "bbb2"]);
      assert.match(middle.stdout, /^parent: {4}#aaa11111 Root \(open\)$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("descends as far as --depth asks", () => {
    const repo = seeded();
    try {
      const deep = repo.nav(["issue", "show", "aaa1", "--depth", "2"]);
      assert.match(deep.stdout, /^ {13}#ddd44444 Details \(open\)$/m);
      const none = repo.nav(["issue", "show", "aaa1", "--depth", "0"]);
      assert.equal(none.stdout.includes("subtasks"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("rejects a depth that is not a whole number of levels", () => {
    const repo = seeded();
    try {
      // Rounding '2.5' down to something valid would answer a question the
      // user did not ask, so each of these is refused rather than coerced.
      for (const depth of ["-1", "2.5", "many", ""]) {
        const result = repo.nav(["issue", "show", "aaa1", "--depth", depth]);
        assert.equal(result.code, 1, `--depth ${JSON.stringify(depth)}`);
        assert.match(result.stderr, /--depth takes a whole number/);
      }
    } finally {
      repo.cleanup();
    }
  });

  it("shows a subtask no file backs as written, rather than dropping it", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [bbb22222, zzzz9999]");
      const result = repo.nav(["issue", "show", "aaa1"]);
      assert.match(result.stdout, /#zzzz9999 \(not in this tree\)/);
    } finally {
      repo.cleanup();
    }
  });

  it("tells a link naming a pull request apart from one naming nothing", () => {
    const repo = seeded();
    try {
      repo.write("src/a.txt", "a\n");
      repo.commitAll("feat: something to review");
      repo.git(["checkout", "--quiet", "-b", "feat/x"]);
      repo.write("src/b.txt", "b\n");
      repo.commitAll("feat: more");
      assert.equal(
        repo.nav(["pr", "open", "--title", "Auth", "-m", "Body."], { NAV_IDS: "prr11111" }).code,
        0,
      );
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [prr11111]");
      handEdit(repo, "bbb22222", /^parent: .*$/m, "parent: prr11111");

      const parent = repo.nav(["issue", "show", "aaa1"]);
      assert.match(parent.stdout, /#prr11111 \(a pull request, not a subtask\)/);
      const child = repo.nav(["issue", "show", "bbb2"]);
      assert.match(child.stdout, /^parent: {4}#prr11111 \(a pull request, not a subtask\)$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("carries the raw ids into --json, unresolved", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "show", "bbb2", "--json"]);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(parsed.parent, "aaa11111");
      assert.deepEqual(parsed.subtasks, ["ddd44444"]);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves pull requests alone: they have no --depth and no link rows", () => {
    const repo = seeded();
    try {
      const help = repo.nav(["pr", "show", "--help"]);
      assert.equal(help.stdout.includes("--depth"), false);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav issue delete, with links", () => {
  it("detaches the subtasks it keeps and names them", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "delete", "bbb2", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^1 subtask\(s\) are now top-level issues:$/m);
      assert.match(result.stdout, /^ {2}#ddd44444 {2}Details$/m);

      assert.equal(read(repo, "ddd44444").includes("parent"), false);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[ccc33333\]$/m);
      assert.equal(repo.nav(["doctor"]).code, 0, repo.nav(["doctor"]).stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("takes the whole subtree with --recursive, in one commit", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "delete", "bbb2", "--recursive", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Deleted #bbb22222 /m);
      assert.match(result.stdout, /^Deleted #ddd44444 /m);
      assert.equal(result.stdout.includes("top-level"), false);

      assert.equal(existsSync(fileOf(repo, "ddd44444")), false);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[ccc33333\]$/m);

      const message = repo.git(["log", "-1", "--format=%B"]).stdout;
      assert.equal(message.trim(), "docs(issue): delete #bbb22222\n\nDeletes: ddd44444");
      const doctor = repo.nav(["doctor"]);
      assert.equal(doctor.code, 0, doctor.stdout);
      assert.equal(doctor.stdout.includes("D8"), false, doctor.stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves an issue a stray list names, since only 'parent' makes a subtask", () => {
    const repo = seeded();
    try {
      handEdit(repo, "bbb22222", /^subtasks: .*$/m, "subtasks: [ddd44444, ccc33333]");
      const result = repo.nav(["issue", "delete", "bbb2", "--recursive", "--force"]);
      assert.equal(result.code, 0, result.stderr);
      assert.ok(existsSync(fileOf(repo, "ccc33333")), "#ccc33333 is filed under the root");
      assert.equal(existsSync(fileOf(repo, "ddd44444")), false);
    } finally {
      repo.cleanup();
    }
  });

  it("asks about uncommitted work anywhere in the subtree it would remove", () => {
    const repo = seeded();
    try {
      writeFileSync(join(repo.dir, ".navbook/issues/open/ddd44444-details/notes.txt"), "wip\n");
      const result = repo.nav(["issue", "delete", "bbb2", "--recursive"]);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /#bbb22222 and its 1 subtask\(s\) have changes/);
      assert.match(result.stdout, /notes\.txt/);
      assert.ok(existsSync(fileOf(repo, "ddd44444")), "nothing was removed");
    } finally {
      repo.cleanup();
    }
  });

  it("has no --recursive on pull requests, which do not decompose", () => {
    const repo = seeded();
    try {
      assert.equal(repo.nav(["pr", "delete", "--help"]).stdout.includes("--recursive"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("deleting a pull request never rewrites an issue file", () => {
    const repo = seeded();
    try {
      repo.write("src/a.txt", "a\n");
      repo.commitAll("feat: something to review");
      repo.git(["checkout", "--quiet", "-b", "feat/x"]);
      repo.write("src/b.txt", "b\n");
      repo.commitAll("feat: more");
      assert.equal(
        repo.nav(["pr", "open", "--title", "Auth", "-m", "Body."], { NAV_IDS: "prr11111" }).code,
        0,
      );
      repo.commitAll("docs(pr): open #prr11111");
      // A hand-written link naming the pull request: already a fault, and not
      // one that deleting the pull request gets to resolve by editing an issue.
      handEdit(repo, "ddd44444", /^parent: .*$/m, "parent: prr11111");
      repo.commitAll("docs(issue): a link that should not have been written");

      const result = repo.nav(["pr", "delete", "prr1", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(read(repo, "ddd44444"), /^parent: prr11111$/m);
      assert.equal(
        repo.git(["show", "--name-only", "--format=", "HEAD"]).stdout.includes("ddd44444"),
        false,
        "the delete commit touched no issue file",
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav doctor, on broken links", () => {
  it("errors when the two sides disagree, and mends the half that is missing", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      const found = repo.nav(["doctor"]);
      assert.equal(found.code, 2);
      assert.match(found.stdout, /^error {2}D11 {2}.*aaa11111-root\/issue\.md/m);

      const fixed = repo.nav(["doctor", "--fix"]);
      assert.equal(fixed.code, 0, fixed.stdout);
      assert.match(fixed.stdout, /^fixed {2}wrote .*aaa11111-root\/issue\.md$/m);
      assert.match(read(repo, "aaa11111"), /^subtasks: \[ccc33333, bbb22222\]$/m);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("stages what it repaired, so the fix can go straight into a commit", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      assert.equal(repo.nav(["doctor", "--fix"]).code, 0);
      const staged = repo.git(["diff", "--cached", "--name-only"]).stdout;
      assert.match(staged, /aaa11111-root\/issue\.md/);
    } finally {
      repo.cleanup();
    }
  });

  it("settles a disputed subtask in favour of the claim made last", () => {
    const repo = seeded();
    try {
      // #ccc33333 claims #ddd44444 too, and says so in a later commit than the
      // one that filed it under #bbb22222.
      handEdit(repo, "ccc33333", /^created: (.*)$/m, "created: $1\nsubtasks: [ddd44444]");
      repo.commitAll("docs(issue): claim by hand", "2026-08-09T10:00:00Z");

      const found = repo.nav(["doctor"]);
      assert.equal(found.code, 2);
      assert.match(found.stdout, /disagree about the parent of #ddd44444/);
      assert.match(found.stdout, /'nav doctor --fix' settles it from git history/);

      const fixed = repo.nav(["doctor", "--fix"]);
      assert.equal(fixed.code, 0, fixed.stdout);
      assert.match(read(repo, "ddd44444"), /^parent: ccc33333$/m);
      assert.equal(read(repo, "bbb22222").includes("subtasks"), false);
      assert.match(read(repo, "ccc33333"), /^subtasks: \[ddd44444\]$/m);
      assert.equal(repo.nav(["doctor"]).code, 0);
    } finally {
      repo.cleanup();
    }
  });

  it("will not settle a dispute against an issue that is not in this tree", () => {
    const repo = seeded();
    try {
      // #ddd44444 belongs to an issue on a branch nobody here has fetched, and
      // #ccc33333 claims it locally, later. Preferring the local claim would
      // delete the only record that the other issue exists.
      handEdit(repo, "ddd44444", /^parent: .*$/m, "parent: zzzz9999");
      handEdit(repo, "bbb22222", /^subtasks: .*$/m, "");
      repo.commitAll("docs(issue): file it under an issue from another branch");
      handEdit(repo, "ccc33333", /^created: (.*)$/m, "created: $1\nsubtasks: [ddd44444]");
      repo.commitAll("docs(issue): claim it locally", "2026-08-09T10:00:00Z");

      const result = repo.nav(["doctor", "--fix"]);
      assert.equal(result.code, 2);
      assert.match(result.stdout, /one claim names an issue this tree does not hold/);
      assert.match(read(repo, "ddd44444"), /^parent: zzzz9999$/m);
      assert.equal(result.stdout.includes("fixed"), false, result.stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("declines an uncommitted dispute rather than guessing, and says so", () => {
    const repo = seeded();
    try {
      handEdit(repo, "ccc33333", /^created: (.*)$/m, "created: $1\nsubtasks: [ddd44444]");
      const result = repo.nav(["doctor", "--fix"]);
      assert.equal(result.code, 2);
      assert.match(result.stdout, /git history does not say which claim came last/);
      assert.match(read(repo, "ddd44444"), /^parent: bbb22222$/m, "nothing was rewritten");
    } finally {
      repo.cleanup();
    }
  });

  it("never leaves behind a loop its own repairs would have made", () => {
    const repo = seeded();
    try {
      // A ring of claims, none of which records a parent: each is answerable
      // on its own, and answering them together files everything in a circle.
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [bbb22222]");
      handEdit(repo, "bbb22222", /^parent: .*$/m, "");
      handEdit(repo, "bbb22222", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      handEdit(repo, "ccc33333", /^parent: .*$/m, "subtasks: [aaa11111]");
      handEdit(repo, "ddd44444", /^parent: .*$/m, "");

      const fixed = repo.nav(["doctor", "--fix"]);
      assert.equal(fixed.code, 2, fixed.stdout);
      assert.match(fixed.stdout, /would close a loop/);
      assert.equal(fixed.stdout.includes("fixed"), false, fixed.stdout);
      for (const id of ["aaa11111", "bbb22222", "ccc33333"]) {
        assert.equal(read(repo, id).includes("parent:"), false, `#${id} gained a parent`);
      }
      // And the tree is no worse than it was: still D11, never D12.
      assert.equal(repo.nav(["doctor"]).stdout.includes("D12"), false);
    } finally {
      repo.cleanup();
    }
  });

  it("errors on a loop and never offers to break it", () => {
    const repo = seeded();
    try {
      // #aaa11111 is filed under its own great-grandchild.
      handEdit(repo, "aaa11111", /^created: (.*)$/m, "created: $1\nparent: ddd44444");
      handEdit(repo, "ddd44444", /^created: (.*)$/m, "created: $1\nsubtasks: [aaa11111]");

      const result = repo.nav(["doctor", "--fix"]);
      assert.equal(result.code, 2);
      assert.match(result.stdout, /^error {2}D12 /m);
      assert.match(result.stdout, /the 'parent' chain loops/);
      assert.match(read(repo, "aaa11111"), /^parent: ddd44444$/m, "no repair was applied");
    } finally {
      repo.cleanup();
    }
  });

  it("judges the index under --staged, so the hook catches a broken link", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      repo.git(["add", "-A"]);
      const result = repo.nav(["doctor", "--staged"]);
      assert.equal(result.code, 2);
      assert.match(result.stdout, /^error {2}D11 /m);
    } finally {
      repo.cleanup();
    }
  });

  it("does not repair from the index, which would discard unstaged work", () => {
    const repo = seeded();
    try {
      handEdit(repo, "aaa11111", /^subtasks: .*$/m, "subtasks: [ccc33333]");
      repo.git(["add", "-A"]);
      // Staged and working-tree content now differ; a repair built from the
      // index would write the staged bytes over this line.
      handEdit(repo, "aaa11111", /^Root\.$/m, "Root, with a thought not yet staged.");

      const result = repo.nav(["doctor", "--staged", "--fix"]);
      assert.equal(result.code, 2, result.stdout);
      assert.equal(result.stdout.includes("fixed"), false, result.stdout);
      assert.match(read(repo, "aaa11111"), /not yet staged/);
    } finally {
      repo.cleanup();
    }
  });

  it("only warns about a link whose target may be on another branch", () => {
    const repo = seeded();
    try {
      handEdit(repo, "ddd44444", /^parent: .*$/m, "parent: zzzz9999");
      handEdit(repo, "bbb22222", /^subtasks: .*$/m, "subtasks: [zzzz8888]");
      const result = repo.nav(["doctor"]);
      assert.equal(result.code, 0, result.stdout);
      assert.match(result.stdout, /^warning {2}D8 .*parent: zzzz9999/m);
      assert.match(result.stdout, /^warning {2}D8 .*subtasks' entry zzzz8888/m);
    } finally {
      repo.cleanup();
    }
  });
});
