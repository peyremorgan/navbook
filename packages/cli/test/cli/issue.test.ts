/**
 * CLI behavior that fixtures cannot express: editor flows, git index state,
 * identity handling, and interactions with a real working tree.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * The default query is `status:open` (spec 04 §4.3), and it belongs to the CLI
 * alone: a query naming no status filters by none, which is what the GraphQL
 * API relies on. These assertions keep the CLI's half of that split honest.
 */
describe("nav issue list default query", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav(["issue", "open", "Still open", "-m", "Body."], { NAV_IDS: "opn11111" });
    repo.nav(["issue", "open", "All done", "-m", "Body."], { NAV_IDS: "cls22222" });
    repo.nav(["issue", "close", "cls2", "--resolution", "fixed"]);
    repo.commitAll("docs(issue): seed a closed issue");
  });
  after(() => repo.cleanup());

  it("lists open issues only when no status is named", () => {
    const out = repo.nav(["issue", "list"]).stdout;
    assert.match(out, /opn11111/);
    assert.equal(out.includes("cls22222"), false, "a closed issue is not in the default listing");
  });

  it("lists closed issues when the query names them", () => {
    const closed = repo.nav(["issue", "list", "status:closed"]).stdout;
    assert.match(closed, /cls22222/);
    assert.equal(closed.includes("opn11111"), false);

    const both = repo.nav(["issue", "list", "status:open", "status:closed"]).stdout;
    assert.match(both, /opn11111/);
    assert.match(both, /cls22222/);
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

describe("nav issue delete", () => {
  /** A repository holding one committed issue, `del11111`, with a comment. */
  function seeded(): TempRepo {
    const repo = makeNavRepo();
    repo.nav(["issue", "open", "Filed twice", "-m", "Body.", "--commit"], { NAV_IDS: "del11111" });
    repo.nav(["issue", "comment", "del1", "-m", "A note.", "--commit"], { NAV_IDS: "del22222" });
    return repo;
  }

  const dirOf = (repo: TempRepo, path = "issues/open/del11111-filed-twice"): string =>
    join(repo.dir, ".navbook", path);

  it("removes the directory and stages the deletion", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "delete", "del1"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /^Deleted #del11111 {2}\.navbook\/issues\/open\/del11111-/m);
      assert.equal(existsSync(dirOf(repo)), false, "the directory is gone");

      const staged = repo.git(["diff", "--cached", "--name-status"]).stdout;
      assert.match(staged, /^D\t\.navbook\/issues\/open\/del11111-filed-twice\/issue\.md$/m);
      assert.match(staged, /^D\t.*del11111-filed-twice\/comments\/.*-del22222\.md$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("leaves the status directory itself in place", () => {
    const repo = seeded();
    try {
      assert.equal(repo.nav(["issue", "delete", "del1"]).code, 0);
      assert.ok(existsSync(join(repo.dir, ".navbook/issues/open/.gitkeep")));
      assert.equal(repo.nav(["issue", "list"]).code, 0, "the tree is still a Navbook tree");
    } finally {
      repo.cleanup();
    }
  });

  it("commits under a delete subject with no trailer, leaving doctor quiet", () => {
    const repo = seeded();
    try {
      const result = repo.nav(["issue", "delete", "del1", "--commit"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Committed docs\(issue\): delete #del11111/);

      const message = repo.git(["log", "-1", "--format=%B"]).stdout;
      assert.equal(message.trim(), "docs(issue): delete #del11111");
      assert.equal(/^(Refs|Closes):/m.test(message), false, "no trailer to dangle");

      // The earlier open/comment commits still name #del11111; deleting on
      // purpose is not a fault, so D8 must not report them.
      const doctor = repo.nav(["doctor"]);
      assert.equal(doctor.code, 0, doctor.stderr);
      assert.equal(doctor.stdout.includes("D8"), false, doctor.stdout);
    } finally {
      repo.cleanup();
    }
  });

  it("deletes a closed issue, and an archived one, pruning the empty archive", () => {
    const repo = seeded();
    try {
      assert.equal(repo.nav(["issue", "close", "del1", "--commit"]).code, 0);
      assert.equal(repo.nav(["issue", "delete", "del1", "--commit"]).code, 0);
      assert.equal(existsSync(dirOf(repo, "issues/closed/del11111-filed-twice")), false);

      repo.write(
        ".navbook/archive/2019/issues/closed/arc11111-ancient/issue.md",
        "---\ntitle: Ancient\nauthor: a@b.co\ncreated: 2019-01-01T00:00:00Z\n---\n\nBody.\n",
      );
      repo.commitAll("chore: archive");
      assert.equal(repo.nav(["issue", "delete", "arc1", "--commit"]).code, 0);
      assert.equal(
        existsSync(join(repo.dir, ".navbook/archive")),
        false,
        "the emptied archive year is pruned rather than left behind",
      );
    } finally {
      repo.cleanup();
    }
  });

  describe("uncommitted changes", () => {
    /** The seeded issue, plus an edit and an untracked file inside its directory. */
    function dirty(): TempRepo {
      const repo = seeded();
      writeFileSync(join(dirOf(repo), "issue.md"), "---\ntitle: Edited\n---\n\nx\n", "utf8");
      writeFileSync(join(dirOf(repo), "notes.md"), "draft\n", "utf8");
      return repo;
    }

    it("refuses rather than guessing when nothing can answer the question", () => {
      const repo = dirty();
      try {
        const result = repo.nav(["issue", "delete", "del1"]);
        assert.equal(result.code, 1);
        assert.match(result.stdout, /has changes that are not committed/);
        assert.match(result.stdout, /notes\.md/);
        assert.match(result.stderr, /#del11111 was not deleted/);
        assert.ok(existsSync(dirOf(repo)), "nothing was removed");
        assert.equal(repo.git(["diff", "--cached", "--name-only"]).stdout, "");
      } finally {
        repo.cleanup();
      }
    });

    it("goes ahead when answered yes", () => {
      const repo = dirty();
      try {
        const result = repo.nav(["issue", "delete", "del1"], undefined, "y\n");
        assert.equal(result.code, 0, result.stderr);
        assert.equal(existsSync(dirOf(repo)), false);
      } finally {
        repo.cleanup();
      }
    });

    it("does not ask at all with --force", () => {
      const repo = dirty();
      try {
        const result = repo.nav(["issue", "delete", "del1", "--force"]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout.includes("not committed"), false, result.stdout);
        assert.equal(existsSync(dirOf(repo)), false);
      } finally {
        repo.cleanup();
      }
    });

    it("treats an issue that was never committed as unrecoverable, and says so", () => {
      const repo = makeNavRepo();
      try {
        repo.nav(["issue", "open", "Just filed", "-m", "Body."], { NAV_IDS: "new11111" });
        const head = repo.git(["rev-parse", "HEAD"]).stdout.trim();

        assert.equal(repo.nav(["issue", "delete", "new1"]).code, 1, "asks before losing it");

        const forced = repo.nav(["issue", "delete", "new1", "--commit", "--force"]);
        assert.equal(forced.code, 0, forced.stderr);
        assert.match(forced.stdout, /Nothing to commit/, "there was nothing in history to remove");
        assert.equal(repo.git(["rev-parse", "HEAD"]).stdout.trim(), head);
        assert.equal(existsSync(join(repo.dir, ".navbook/issues/open/new11111-just-filed")), false);
      } finally {
        repo.cleanup();
      }
    });
  });

  it("refuses --commit with unrelated staged work, before asking anything", () => {
    const repo = seeded();
    try {
      writeFileSync(join(dirOf(repo), "notes.md"), "draft\n", "utf8");
      repo.write("app.py", "print('hi')\n");
      repo.git(["add", "app.py"]);

      const result = repo.nav(["issue", "delete", "del1", "--commit"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /--commit refuses to run with unrelated changes/);
      assert.equal(result.stdout.includes("not committed"), false, "it never got as far as asking");
      assert.ok(existsSync(dirOf(repo)));
    } finally {
      repo.cleanup();
    }
  });

  it("reports an id that resolves to nothing, and one of the wrong kind", () => {
    const repo = seeded();
    try {
      assert.match(repo.nav(["issue", "delete", "zzzzzzzz"]).stderr, /no issue matches/);
      assert.match(repo.nav(["issue", "delete", "del"]).stderr, /too short/);
    } finally {
      repo.cleanup();
    }
  });
});
