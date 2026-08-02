/**
 * CLI behavior that fixtures cannot express: editor flows, git index state,
 * identity handling, and interactions with a real working tree.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeNavRepo, makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

/** An "editor" that appends a body to whatever file it is handed. */
function editorAppending(repo: TempRepo, name: string, text: string): string {
  return repo.script(name, `printf '%s\\n' ${JSON.stringify(text)} >> "$1"`);
}

/** An "editor" that fails, as if the user aborted. */
function failingEditor(repo: TempRepo): string {
  return repo.script("editor-fail.sh", "exit 1");
}

/** An "editor" that changes nothing. */
const NOOP_EDITOR = "true";

describe("nav outside a repository", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTempRepo();
  });
  after(() => repo.cleanup());

  it("refuses to run without .navbook and points at nav init", () => {
    const result = repo.nav(["issue", "list"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not a Navbook repository/);
    assert.match(result.stderr, /nav init/);
  });
});

describe("nav init", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTempRepo();
  });
  after(() => repo.cleanup());

  it("stages the skeleton without committing when --commit is absent", () => {
    assert.equal(repo.nav(["init"]).code, 0);
    const staged = repo.git(["diff", "--cached", "--name-only"]).stdout;
    assert.match(staged, /\.navbook\/issues\/open\/\.gitkeep/);
    assert.equal(
      repo.git(["rev-parse", "--verify", "--quiet", "HEAD"]).code,
      1,
      "no commit was made",
    );
  });

  it("works from a subdirectory, creating .navbook at the repository root", () => {
    const nested = makeTempRepo();
    try {
      nested.write("src/deep/file.txt", "x\n");
      nested.commitAll("feat: code");
      const result = nested.nav(["init"], { PWD: join(nested.dir, "src", "deep") });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(readFileSync(join(nested.dir, ".navbook/issues/open/.gitkeep"), "utf8"), "");
    } finally {
      nested.cleanup();
    }
  });
});

describe("identity", () => {
  it("fails clearly when git has no user.email configured", () => {
    const repo = makeNavRepo();
    try {
      repo.git(["config", "--unset", "user.email"]);
      const result = repo.nav(["issue", "open", "T", "-m", "b"], {
        GIT_AUTHOR_EMAIL: "",
        GIT_COMMITTER_EMAIL: "",
      });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /user\.email/);
    } finally {
      repo.cleanup();
    }
  });

  it("writes the configured name and address as the author", () => {
    const repo = makeNavRepo();
    try {
      repo.git(["config", "user.name", "Alice Smith"]);
      repo.git(["config", "user.email", "alice@example.com"]);
      repo.nav(["issue", "open", "T", "-m", "b"], { NAV_IDS: "aaaaaaa1" });
      const text = readFileSync(join(repo.dir, ".navbook/issues/open/aaaaaaa1-t/issue.md"), "utf8");
      assert.match(text, /author: Alice Smith <alice@example\.com>/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("$EDITOR flows", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
  });
  after(() => repo.cleanup());

  it("opens an editor when -m is omitted and uses what was written", () => {
    const result = repo.nav(["issue", "open", "Editor flow"], {
      NAV_IDS: "eee11111",
      EDITOR: editorAppending(repo, "editor-append.sh", "Written in the editor."),
    });
    assert.equal(result.code, 0, result.stderr);
    const text = readFileSync(
      join(repo.dir, ".navbook/issues/open/eee11111-editor-flow/issue.md"),
      "utf8",
    );
    assert.match(text, /Written in the editor\./);
  });

  it("lets a title edited in the buffer decide the slug", () => {
    const rewrite = repo.script(
      "editor-retitle.sh",
      'sed "s/^title: .*/title: Renamed in buffer/" "$1" > "$1.tmp" && mv "$1.tmp" "$1" && printf "Body text.\\n" >> "$1"',
    );
    const result = repo.nav(["issue", "open", "Original title"], {
      NAV_IDS: "eee22222",
      EDITOR: rewrite,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /eee22222-renamed-in-buffer/);
  });

  it("creates nothing when the editor leaves the body empty", () => {
    const result = repo.nav(["issue", "open", "Aborted"], {
      NAV_IDS: "eee33333",
      EDITOR: NOOP_EDITOR,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /empty body/);
    assert.equal(repo.nav(["issue", "list", "eee33333"]).stdout.includes("eee33333"), false);
    assert.equal(repo.git(["status", "--porcelain"]).stdout.includes("eee33333"), false);
  });

  it("creates nothing when the editor exits non-zero", () => {
    const result = repo.nav(["issue", "open", "Aborted"], {
      NAV_IDS: "eee44444",
      EDITOR: failingEditor(repo),
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /exited with status 1/);
    assert.equal(repo.git(["status", "--porcelain"]).stdout.includes("eee44444"), false);
  });

  it("explains what to do when no editor is configured", () => {
    const result = repo.nav(["issue", "open", "No editor"], { EDITOR: "", VISUAL: "" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no editor configured/);
    assert.match(result.stderr, /-m/);
  });

  it("prefers $VISUAL over $EDITOR", () => {
    const result = repo.nav(["issue", "open", "Visual wins"], {
      NAV_IDS: "eee55555",
      VISUAL: editorAppending(repo, "editor-visual.sh", "From VISUAL."),
      EDITOR: failingEditor(repo),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      readFileSync(join(repo.dir, ".navbook/issues/open/eee55555-visual-wins/issue.md"), "utf8"),
      /From VISUAL\./,
    );
  });

  it("leaves no scratch buffer behind in the git directory", () => {
    repo.nav(["issue", "open", "Buffer check"], {
      NAV_IDS: "eee66666",
      EDITOR: editorAppending(repo, "editor-buffer.sh", "Body."),
    });
    const listing = repo.git(["rev-parse", "--absolute-git-dir"]).stdout.trim();
    assert.equal(repo.git(["status", "--porcelain"]).code, 0);
    assert.throws(() => readFileSync(join(listing, "NAVBOOK_ISSUE.md"), "utf8"));
  });
});

describe("nav issue edit", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav(["issue", "open", "Editable", "-m", "Body."], { NAV_IDS: "edt11111" });
    repo.commitAll("docs(issue): open #edt11111");
  });
  after(() => repo.cleanup());

  it("stages the edited file", () => {
    const result = repo.nav(["issue", "edit", "edt1"], {
      EDITOR: editorAppending(repo, "editor-detail.sh", "More detail."),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      repo.git(["diff", "--cached", "--name-only"]).stdout,
      /edt11111-editable\/issue\.md/,
    );
  });

  it("warns but does not fail when an edit breaks the schema", () => {
    const path = join(repo.dir, ".navbook/issues/open/edt11111-editable/issue.md");
    writeFileSync(path, "---\nauthor: a@b.co\n---\n\nno title\n", "utf8");
    const result = repo.nav(["issue", "edit", "edt1"], { EDITOR: NOOP_EDITOR });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /warning:/);
    assert.match(result.stderr, /missing required key 'title'/);
  });
});

describe("staging without --commit", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav(["issue", "open", "Stageable", "-m", "Body."], { NAV_IDS: "stg11111" });
    repo.commitAll("docs(issue): open #stg11111");
  });
  after(() => repo.cleanup());

  it("stages both sides of a move so the rename is recorded", () => {
    assert.equal(repo.nav(["issue", "close", "stg1", "--resolution", "fixed"]).code, 0);
    const staged = repo.git(["diff", "--cached", "--name-status", "-M"]).stdout;
    assert.match(staged, /^R/m, "git sees a rename");
    assert.match(staged, /issues\/closed\/stg11111-stageable\/issue\.md/);
    assert.equal(
      repo.git(["log", "--oneline"]).stdout.includes("docs(issue): close"),
      false,
      "nothing committed",
    );
  });

  it("leaves an unrelated staged change untouched when --commit is not used", () => {
    repo.write("other.txt", "x\n");
    repo.git(["add", "other.txt"]);
    assert.equal(repo.nav(["issue", "reopen", "stg1"]).code, 0);
    assert.match(repo.git(["diff", "--cached", "--name-only"]).stdout, /other\.txt/);
  });
});

describe("--commit", () => {
  it("commits only the tracker change, leaving unstaged work alone", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Committed", "-m", "Body."], { NAV_IDS: "cmt11111" });
      repo.commitAll("docs(issue): open #cmt11111");
      repo.write("app.py", "print('hi')\n");

      const result = repo.nav(["issue", "close", "cmt1", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      const committed = repo.git(["show", "--name-only", "--format=", "HEAD"]).stdout;
      assert.equal(committed.includes("app.py"), false, "unstaged work is not swept in");
      assert.match(committed, /issues\/closed\/cmt11111-committed\/issue\.md/);
      assert.match(repo.git(["status", "--porcelain"]).stdout, /\?\? app\.py/);
    } finally {
      repo.cleanup();
    }
  });

  it("writes the Closes trailer for a close and Refs for a comment", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Trailers", "-m", "Body.", "--commit"], { NAV_IDS: "trl11111" });
      repo.nav(["issue", "comment", "trl1", "-m", "A note.", "--commit"], { NAV_IDS: "trl22222" });
      repo.nav(["issue", "close", "trl1", "--commit"]);
      const log = repo.git(["log", "--format=%B%x00"]).stdout;
      assert.match(log, /docs\(issue\): close #trl11111\n\nCloses: trl11111/);
      assert.match(log, /docs\(issue\): comment on #trl11111\n\nRefs: trl11111/);
    } finally {
      repo.cleanup();
    }
  });

  it("says so instead of failing when the change turned out to be a no-op", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Unchanged", "-m", "Body.", "--commit"], { NAV_IDS: "noc11111" });
      const before = repo.git(["rev-parse", "HEAD"]).stdout.trim();

      const result = repo.nav(["issue", "edit", "noc1", "--commit"], { EDITOR: NOOP_EDITOR });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Nothing to commit/);
      assert.equal(repo.git(["rev-parse", "HEAD"]).stdout.trim(), before, "no commit was made");
    } finally {
      repo.cleanup();
    }
  });
});

describe("concurrent comments never conflict", () => {
  it("merges two branches that each added a comment to the same issue", () => {
    const repo = makeNavRepo();
    try {
      repo.nav(["issue", "open", "Shared", "-m", "Body.", "--commit"], { NAV_IDS: "shr11111" });
      const base = repo.git(["rev-parse", "HEAD"]).stdout.trim();

      repo.git(["checkout", "--quiet", "-b", "alice", base]);
      repo.nav(["issue", "comment", "shr1", "-m", "From Alice.", "--commit"], {
        NAV_IDS: "aaa11111",
        NAV_NOW: "2026-08-05T10:00:00Z",
      });

      repo.git(["checkout", "--quiet", "-b", "bob", base]);
      repo.nav(["issue", "comment", "shr1", "-m", "From Bob.", "--commit"], {
        NAV_IDS: "bbb22222",
        NAV_NOW: "2026-08-05T11:00:00Z",
      });

      const merge = repo.git(["merge", "--no-edit", "alice"]);
      assert.equal(merge.code, 0, `merge should be clean:\n${merge.stdout}${merge.stderr}`);
      const shown = repo.nav(["issue", "show", "shr1"]).stdout;
      assert.match(shown, /From Alice\./);
      assert.match(shown, /From Bob\./);
      assert.match(shown, /comments \(2\)/);
    } finally {
      repo.cleanup();
    }
  });

  /** Set up a close on `main` racing a new comment on a branch (spec 03 §3.3). */
  function raceCommentAgainstClose(
    seedComment: boolean,
    directoryRenames?: string,
  ): { repo: TempRepo; listing: string; mergeCode: number; mergeOutput: string } {
    const repo = makeNavRepo();
    if (directoryRenames) repo.git(["config", "merge.directoryRenames", directoryRenames]);
    repo.nav(["issue", "open", "Raced", "-m", "Body.", "--commit"], { NAV_IDS: "rce11111" });
    if (seedComment) {
      repo.nav(["issue", "comment", "rce1", "-m", "Earlier comment.", "--commit"], {
        NAV_IDS: "ppp00000",
        NAV_NOW: "2026-08-04T10:00:00Z",
      });
    }
    const base = repo.git(["rev-parse", "HEAD"]).stdout.trim();

    repo.git(["checkout", "--quiet", "-b", "commenter", base]);
    repo.nav(["issue", "comment", "rce1", "-m", "Late comment.", "--commit"], {
      NAV_IDS: "ccc11111",
      NAV_NOW: "2026-08-05T10:00:00Z",
    });

    repo.git(["checkout", "--quiet", "main"]);
    repo.nav(["issue", "close", "rce1", "--resolution", "fixed", "--commit"]);

    const merge = repo.git(["merge", "--no-edit", "commenter"]);
    return {
      repo,
      listing: repo.git(["ls-files", ".navbook"]).stdout,
      mergeCode: merge.code,
      mergeOutput: merge.stdout + merge.stderr,
    };
  }

  it("merges a comment into a directory the other side moved, cleanly, when configured", () => {
    const { repo, listing, mergeCode, mergeOutput } = raceCommentAgainstClose(true, "true");
    try {
      assert.equal(mergeCode, 0, `merge should be clean:\n${mergeOutput}`);
      assert.match(listing, /issues\/closed\/rce11111-raced\/comments\/.*-ccc11111\.md/);
      assert.equal(listing.includes("issues/open/rce11111"), false, "nothing left behind in open/");
    } finally {
      repo.cleanup();
    }
  });

  it("places the comment correctly but stops to confirm under git's default setting", () => {
    // merge.directoryRenames defaults to 'conflict': git resolves the location
    // and then asks the author to confirm it (spec 03 §3.3.1). The content is
    // already right, which is why `nav install` offers to set it to 'true'.
    const { repo, listing, mergeCode, mergeOutput } = raceCommentAgainstClose(true, "conflict");
    try {
      assert.equal(mergeCode, 1);
      assert.match(mergeOutput, /file location/);
      assert.match(listing, /issues\/closed\/rce11111-raced\/comments\/.*-ccc11111\.md/);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves the entity's very first comment behind, which doctor can then repair", () => {
    // Git infers directory renames from the files inside them. When the racing
    // comment is the first one, comments/ exists on one side only, so there is
    // no rename to follow (spec 03 §3.3.1). The result is detectable, not silent.
    const { repo, listing, mergeCode } = raceCommentAgainstClose(false);
    try {
      assert.equal(mergeCode, 0, "git merges without complaint; only doctor can see the problem");
      assert.match(listing, /issues\/closed\/rce11111-raced\/issue\.md/);
      assert.match(listing, /issues\/open\/rce11111-raced\/comments\/.*-ccc11111\.md/);
      assert.equal(
        listing.includes("issues/open/rce11111-raced/issue.md"),
        false,
        "the orphan holds comments but no issue.md, which is what makes it detectable",
      );
    } finally {
      repo.cleanup();
    }
  });
});
