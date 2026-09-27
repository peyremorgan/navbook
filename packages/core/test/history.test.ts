/**
 * Reading who wrote a history.
 *
 * A real repository rather than a fixture tree: what is under test is what git
 * does with `.mailmap` and with an address spelled two ways, and neither is
 * something a stub could be wrong about in the same way git is right about it.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { git } from "../src/git/exec.ts";
import { commitAuthors, fileVersions } from "../src/git/history.ts";

/** A repository nobody has committed to, and a way to write its history. */
function inRepo(use: (dir: string, commit: Commit) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-history-"));
  try {
    git(["init", "--quiet", "-b", "main"], { cwd: dir });
    git(["config", "user.name", "Committer"], { cwd: dir });
    git(["config", "user.email", "committer@test.invalid"], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });
    use(dir, (name, email, message = "chore: something") => {
      git(["commit", "--quiet", "--allow-empty", "-m", message], {
        cwd: dir,
        env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email },
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Commit = (name: string, email: string, message?: string) => void;

const shown = (dir: string, rev?: string): string[] =>
  commitAuthors(dir, rev).map((person) =>
    person.name ? `${person.name} <${person.email}>` : person.email,
  );

describe("commitAuthors", () => {
  it("names everyone who authored a commit, newest first", () => {
    inRepo((dir, commit) => {
      commit("Alice", "alice@example.com");
      commit("Bob", "bob@example.com");
      commit("Carol", "carol@example.com");
      assert.deepEqual(shown(dir), [
        "Carol <carol@example.com>",
        "Bob <bob@example.com>",
        "Alice <alice@example.com>",
      ]);
    });
  });

  it("says a person once however they spelled their address", () => {
    inRepo((dir, commit) => {
      commit("Alice", "alice@example.com");
      commit("Alice", "ALICE@example.com");
      assert.deepEqual(shown(dir), ["Alice <ALICE@example.com>"]);
    });
  });

  it("takes the name from the commit they made last", () => {
    inRepo((dir, commit) => {
      commit("Alice Old", "alice@example.com");
      commit("Alice New", "alice@example.com");
      assert.deepEqual(shown(dir), ["Alice New <alice@example.com>"]);
    });
  });

  it("honours a .mailmap, which is what makes two spellings one person", () => {
    inRepo((dir, commit) => {
      commit("Alice At Home", "old@example.com");
      writeFileSync(
        join(dir, ".mailmap"),
        "Alice Proper <proper@example.com> <old@example.com>\n",
        "utf8",
      );
      git(["add", ".mailmap"], { cwd: dir });
      commit("Someone", "someone@example.com", "chore: add a mailmap");

      assert.deepEqual(shown(dir), [
        "Someone <someone@example.com>",
        "Alice Proper <proper@example.com>",
      ]);
    });
  });

  it("counts the two addresses a mailmap joins as the one person", () => {
    inRepo((dir, commit) => {
      commit("Alice", "old@example.com");
      commit("Alice", "proper@example.com");
      writeFileSync(
        join(dir, ".mailmap"),
        "Alice Proper <proper@example.com> <old@example.com>\n",
        "utf8",
      );
      git(["add", ".mailmap"], { cwd: dir });
      commit("Someone", "someone@example.com", "chore: add a mailmap");

      // Two commits, one person: without the mailmap this would be two entries,
      // and the name is the newer commit's because that is the newer commit.
      assert.deepEqual(shown(dir), ["Someone <someone@example.com>", "Alice <proper@example.com>"]);
    });
  });

  it("maps a name the mailmap knows even where the address is untouched", () => {
    inRepo((dir, commit) => {
      commit("alice", "alice@example.com");
      writeFileSync(join(dir, ".mailmap"), "Alice Proper <alice@example.com>\n", "utf8");
      git(["add", ".mailmap"], { cwd: dir });
      commit("Someone", "someone@example.com", "chore: add a mailmap");
      assert.deepEqual(shown(dir).sort(), [
        "Alice Proper <alice@example.com>",
        "Someone <someone@example.com>",
      ]);
    });
  });

  it("skips an author the format's grammar would refuse", () => {
    inRepo((dir, commit) => {
      commit("Root", "root@localhost");
      commit("Alice", "alice@example.com");
      assert.deepEqual(shown(dir), ["Alice <alice@example.com>"]);
    });
  });

  it("reads a name that carries the separators the listings above use", () => {
    inRepo((dir, commit) => {
      // git strips angle brackets and newlines out of an identity and truncates
      // it at a NUL, but a control character like these survives — so a name
      // holding one must not be able to split a record.
      commit("A\u0001B\u0002C", "control@example.com");
      assert.deepEqual(shown(dir), ["A\u0001B\u0002C <control@example.com>"]);
    });
  });

  it("is not fooled by a name that looks like the rest of an address", () => {
    inRepo((dir, commit) => {
      // Angle brackets are git's to strip, and it does; what arrives is a name
      // that can only be read as a name.
      commit("Mallory <root@example.com>", "mallory@example.com");
      assert.deepEqual(shown(dir), ["Mallory root@example.com <mallory@example.com>"]);
    });
  });

  it("is empty where the branch is unborn, and where the rev is not there", () => {
    inRepo((dir, commit) => {
      assert.deepEqual(shown(dir), []);
      commit("Alice", "alice@example.com");
      assert.deepEqual(shown(dir, "no-such-branch"), []);
    });
  });

  it("reads the revision it is given rather than the one checked out", () => {
    inRepo((dir, commit) => {
      commit("Alice", "alice@example.com");
      git(["checkout", "--quiet", "-b", "side"], { cwd: dir });
      commit("Bob", "bob@example.com");
      assert.deepEqual(shown(dir, "main"), ["Alice <alice@example.com>"]);
      assert.deepEqual(shown(dir, "side"), ["Bob <bob@example.com>", "Alice <alice@example.com>"]);
    });
  });
});

describe("fileVersions", () => {
  const open = ".navbook/prs/open/ab12cd34-x/pr.md";
  const merged = ".navbook/prs/merged/ab12cd34-x/pr.md";
  const body =
    "---\ntitle: X\nauthor: Alice <alice@example.com>\n---\n\nA body long enough to be similar.\n";

  const head = (dir: string): string => git(["rev-parse", "HEAD"], { cwd: dir }).trim();
  const write = (dir: string, path: string, text: string): void => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text, "utf8");
    git(["add", path], { cwd: dir });
  };
  const shas = (dir: string, path: string): [string, string][] =>
    fileVersions(dir, path).map((version) => [version.sha, version.path]);

  /** Open a pull request on `feature` and merge it the way `nav pr merge` does. */
  function openAndMerge(dir: string, commit: Commit): { opened: string; merge: string } {
    commit("Alice", "alice@example.com", "chore: root");
    git(["checkout", "--quiet", "-b", "feature"], { cwd: dir });
    write(dir, open, body);
    commit("Alice", "alice@example.com", "docs(pr): open #ab12cd34");
    const opened = head(dir);

    // The move happens inside the merge commit, and the first parent never
    // held the file at all.
    git(["checkout", "--quiet", "main"], { cwd: dir });
    git(["merge", "--quiet", "--no-ff", "--no-commit", "feature"], { cwd: dir });
    mkdirSync(join(dir, ".navbook/prs/merged"), { recursive: true });
    git(["mv", ".navbook/prs/open/ab12cd34-x", ".navbook/prs/merged/ab12cd34-x"], { cwd: dir });
    commit("Alice", "alice@example.com", "Merge #ab12cd34");
    return { opened, merge: head(dir) };
  }

  it("follows a file through the merge that moved it", () => {
    inRepo((dir, commit) => {
      const { opened, merge } = openAndMerge(dir, commit);
      assert.deepEqual(shas(dir, merged), [
        [opened, open],
        [merge, merged],
      ]);
    });
  });

  it("follows it there when later commits edited it", () => {
    inRepo((dir, commit) => {
      const { opened, merge } = openAndMerge(dir, commit);
      write(dir, merged, `${body}merged: yes\n`);
      commit("Alice", "alice@example.com", "docs(pr): merge #ab12cd34");
      assert.deepEqual(shas(dir, merged), [
        [opened, open],
        [merge, merged],
        [head(dir), merged],
      ]);
    });
  });

  it("is not led off by a later merge whose other side holds a similar file", () => {
    inRepo((dir, commit) => {
      commit("Alice", "alice@example.com", "chore: root");
      git(["checkout", "--quiet", "-b", "other"], { cwd: dir });
      write(dir, ".navbook/prs/open/zz98yy76-y/pr.md", body.replace("X", "Y"));
      commit("Bob", "bob@example.com", "docs(pr): open #zz98yy76");

      git(["checkout", "--quiet", "main"], { cwd: dir });
      write(dir, merged, body);
      commit("Alice", "alice@example.com", "docs(pr): merge #ab12cd34");
      const added = head(dir);
      git(["merge", "--quiet", "--no-ff", "-m", "Merge other", "other"], { cwd: dir });

      assert.deepEqual(shas(dir, merged), [[added, merged]]);
    });
  });

  it("takes the file from the parent that held it, not a lookalike the merge deleted", () => {
    inRepo((dir, commit) => {
      // The first parent holds a similar file that the branch deletes, so
      // diffed against it the merge reads as renaming that one.
      const old = ".navbook/prs/open/zz98yy76-y/pr.md";
      commit("Alice", "alice@example.com", "chore: root");
      write(dir, old, body.replace("title: X", "title: Y"));
      commit("Bob", "bob@example.com", "docs(pr): open #zz98yy76");
      git(["checkout", "--quiet", "-b", "feature"], { cwd: dir });
      git(["rm", "--quiet", old], { cwd: dir });
      commit("Bob", "bob@example.com", "docs(pr): delete #zz98yy76");
      write(dir, open, body);
      commit("Alice", "alice@example.com", "docs(pr): open #ab12cd34");
      const opened = head(dir);

      git(["checkout", "--quiet", "main"], { cwd: dir });
      git(["merge", "--quiet", "--no-ff", "--no-commit", "feature"], { cwd: dir });
      mkdirSync(join(dir, ".navbook/prs/merged"), { recursive: true });
      git(["mv", ".navbook/prs/open/ab12cd34-x", ".navbook/prs/merged/ab12cd34-x"], { cwd: dir });
      commit("Alice", "alice@example.com", "Merge #ab12cd34");
      const merge = head(dir);

      assert.deepEqual(shas(dir, merged), [
        [opened, open],
        [merge, merged],
      ]);
    });
  });

  it("follows it back through the merge after a later rename", () => {
    inRepo((dir, commit) => {
      const { opened, merge } = openAndMerge(dir, commit);
      const renamed = ".navbook/prs/merged/ab12cd34-renamed/pr.md";
      git(["mv", ".navbook/prs/merged/ab12cd34-x", ".navbook/prs/merged/ab12cd34-renamed"], {
        cwd: dir,
      });
      commit("Alice", "alice@example.com", "chore: rename");
      assert.deepEqual(shas(dir, renamed), [
        [opened, open],
        [merge, merged],
        [head(dir), renamed],
      ]);
    });
  });

  it("follows it through one merge-time move after another", () => {
    inRepo((dir, commit) => {
      const { opened, merge } = openAndMerge(dir, commit);
      const archived = ".navbook/prs/archived/ab12cd34-x/pr.md";
      git(["checkout", "--quiet", "-b", "archive"], { cwd: dir });
      commit("Bob", "bob@example.com", "chore: something on the side");
      git(["checkout", "--quiet", "main"], { cwd: dir });
      git(["merge", "--quiet", "--no-ff", "--no-commit", "archive"], { cwd: dir });
      mkdirSync(join(dir, ".navbook/prs/archived"), { recursive: true });
      git(["mv", ".navbook/prs/merged/ab12cd34-x", ".navbook/prs/archived/ab12cd34-x"], {
        cwd: dir,
      });
      commit("Alice", "alice@example.com", "Merge archive");
      assert.deepEqual(shas(dir, archived), [
        [opened, open],
        [merge, merged],
        [head(dir), archived],
      ]);
    });
  });

  it("begins a file where git reads it as a copy of a similar one", () => {
    inRepo((dir, commit) => {
      const earlier = ".navbook/issues/open/zz98yy76-y/comments/a.md";
      const later = ".navbook/issues/open/ab12cd34-x/comments/b.md";
      commit("Alice", "alice@example.com", "chore: root");
      write(dir, earlier, body);
      commit("Alice", "alice@example.com", "docs(issue): comment on #zz98yy76");
      write(dir, later, `${body}One line more.\n`);
      commit("Bob", "bob@example.com", "docs(issue): comment on #ab12cd34");
      assert.deepEqual(shas(dir, later), [[head(dir), later]]);
    });
  });

  it("is empty for a path no commit has held", () => {
    inRepo((dir, commit) => {
      commit("Alice", "alice@example.com");
      assert.deepEqual(shas(dir, merged), []);
    });
  });
});
