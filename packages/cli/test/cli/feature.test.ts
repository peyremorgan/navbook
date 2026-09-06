/**
 * `nav feature` at the terminal: the editor flows, the listings, and the
 * completion vocabulary — the parts a conformance fixture cannot express.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { makeNavRepo, type TempRepo } from "../helpers/temprepo.ts";

const read = (repo: TempRepo, path: string): string =>
  readFileSync(join(repo.dir, ...path.split("/")), "utf8");

/** An "editor" that appends a body to whatever file it is handed. */
const editorAppending = (repo: TempRepo, name: string, text: string): string =>
  repo.script(name, `printf '%s\\n' ${JSON.stringify(text)} >> "$1"`);

/** An "editor" that replaces the file it is handed, escapes and all. */
const editorReplacing = (repo: TempRepo, name: string, text: string): string =>
  repo.script(name, `printf '%b' ${JSON.stringify(text)} > "$1"`);

describe("nav feature open", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
  });
  after(() => repo.cleanup());

  it("creates specs/ on the way, without nav init having made it", () => {
    assert.equal(read(repo, ".navbook/navbook.json").includes("version"), true);
    const result = repo.nav([
      "feature",
      "open",
      "Authentication",
      "--slug",
      "auth",
      "-m",
      "Signing in.",
      "--commit",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created \.navbook\/specs\/auth\/ {2}\(auth\)/);
    assert.match(result.stdout, /Committed docs\(feature\): create auth/);
    assert.match(read(repo, ".navbook/specs/auth/feature.md"), /^title: Authentication$/m);
    assert.equal(repo.git(["status", "--porcelain"]).stdout.trim(), "");
  });

  it("takes the slug from the title when none is given", () => {
    assert.equal(repo.nav(["feature", "open", "Billing & Invoices", "-m", "x"]).code, 0);
    assert.match(read(repo, ".navbook/specs/billing-invoices/feature.md"), /^title: Billing/m);
    repo.git(["reset", "--hard", "HEAD"]);
    repo.git(["clean", "-fd"]);
  });

  it("accepts a feature with no summary at all", () => {
    const result = repo.nav(["feature", "open", "Reporting", "-m", "", "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(read(repo, ".navbook/specs/reporting/feature.md"), /^title: Reporting$/m);
    assert.equal(repo.nav(["doctor"]).code, 0);
  });

  it("refuses a title that is only whitespace, and a slug that is not one", () => {
    assert.equal(repo.nav(["feature", "open", "   ", "-m", "x"]).code, 1);
    const bad = repo.nav(["feature", "open", "X", "--slug", "Not A Slug", "-m", "x"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /not a feature slug/);
  });

  it("refuses a slug that already names a feature, leaving it alone", () => {
    const result = repo.nav(["feature", "open", "Another", "--slug", "auth", "-m", "x"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already exists/);
    assert.match(read(repo, ".navbook/specs/auth/feature.md"), /^title: Authentication$/m);
  });

  it("opens $EDITOR when no message is given", () => {
    const editor = editorAppending(repo, "editor-feature.sh", "Written in the editor.");
    const result = repo.nav(["feature", "open", "Search", "--commit"], { EDITOR: editor });
    assert.equal(result.code, 0, result.stderr);
    assert.match(read(repo, ".navbook/specs/search/feature.md"), /Written in the editor\./);
  });
});

describe("nav feature spec", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav([
      "feature",
      "open",
      "Authentication",
      "--slug",
      "auth",
      "-m",
      "Signing in.",
      "--commit",
    ]);
  });
  after(() => repo.cleanup());

  it("adds a document named after its title", () => {
    const result = repo.nav([
      "feature",
      "spec",
      "add",
      "auth",
      "Login flow",
      "-m",
      "## Requirements",
      "--commit",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created \.navbook\/specs\/auth\/login-flow\.md/);
    assert.match(result.stdout, /Committed docs\(feature\): add auth\/login-flow\.md/);
    assert.match(read(repo, ".navbook/specs/auth/login-flow.md"), /^title: Login flow$/m);
  });

  it("takes an explicit file name, and refuses one it must not create", () => {
    assert.equal(
      repo.nav([
        "feature",
        "spec",
        "add",
        "auth",
        "Sessions",
        "--file",
        "session-policy.md",
        "-m",
        "x",
        "--commit",
      ]).code,
      0,
    );
    assert.match(read(repo, ".navbook/specs/auth/session-policy.md"), /^title: Sessions$/m);

    for (const name of ["feature.md", "../escape.md", "Notes.md", "notes.txt"]) {
      const result = repo.nav(["feature", "spec", "add", "auth", "X", "--file", name, "-m", "x"]);
      assert.equal(result.code, 1, name);
      assert.match(result.stderr, /is not a document name this tool will create/);
    }
  });

  it("refuses before opening an editor when the feature does not exist", () => {
    const editor = repo.script("editor-never.sh", "exit 1");
    const result = repo.nav(["feature", "spec", "add", "nope", "X"], { EDITOR: editor });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no feature named 'nope'/);
  });

  it("refuses a document the feature already has", () => {
    const result = repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "x"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already has a 'login-flow\.md'/);
  });

  it("lists documents, as a table and as JSON", () => {
    const table = repo.nav(["feature", "spec", "list", "auth"]);
    assert.match(table.stdout, /FILE\s+TITLE/);
    assert.match(table.stdout, /login-flow\.md\s+Login flow/);

    const json = repo.nav(["feature", "spec", "list", "auth", "--json"]);
    const rows = json.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((row) => row.file),
      ["login-flow.md", "session-policy.md"],
    );
    assert.equal(rows[0].feature, "auth");
    assert.equal(rows[0].path, ".navbook/specs/auth/login-flow.md");
  });

  it("edits a document in $EDITOR and records what was saved", () => {
    const editor = editorReplacing(
      repo,
      "editor-spec.sh",
      "---\ntitle: Login flow\n---\n\nRewritten.\n",
    );
    const result = repo.nav(["feature", "spec", "edit", "auth", "login-flow.md", "--commit"], {
      EDITOR: editor,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Committed docs\(feature\): edit auth\/login-flow\.md/);
    assert.match(read(repo, ".navbook/specs/auth/login-flow.md"), /Rewritten\./);
  });

  it("keeps an edit that broke the schema, and says what is wrong", () => {
    const editor = editorReplacing(repo, "editor-bad.sh", "---\nauthor: a@b.invalid\n---\n\nX\n");
    const result = repo.nav(["feature", "spec", "edit", "auth", "login-flow.md"], {
      EDITOR: editor,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no longer valid/);
    assert.match(result.stderr, /missing required key 'title'/);
    // Left as saved: the work is the author's, not the tool's to discard.
    assert.match(read(repo, ".navbook/specs/auth/login-flow.md"), /^author: a@b\.invalid$/m);
    repo.git(["checkout", "--", ".navbook"]);
  });

  it("edits the identity card too", () => {
    const editor = editorReplacing(
      repo,
      "editor-card.sh",
      "---\ntitle: Authentication\nauthor: a@b.invalid\ncreated: 2026-09-01T10:00:00Z\n---\n\nNew summary.\n",
    );
    const result = repo.nav(["feature", "edit", "auth", "--commit"], { EDITOR: editor });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Committed docs\(feature\): edit auth/);
    assert.match(read(repo, ".navbook/specs/auth/feature.md"), /New summary\./);
  });
});

describe("attaching work to a feature", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav([
      "feature",
      "open",
      "Authentication",
      "--slug",
      "auth",
      "-m",
      "Signing in.",
      "--commit",
    ]);
    repo.nav(["feature", "open", "Billing", "--slug", "billing", "-m", "Money.", "--commit"]);
  });
  after(() => repo.cleanup());

  it("writes one feature as a scalar and several as a list", () => {
    assert.equal(
      repo.nav(["issue", "open", "Add TOTP", "--feature", "auth", "-m", "Body.", "--commit"]).code,
      0,
    );
    const one = repo.nav(["issue", "list", "--json"]).stdout.trim();
    assert.equal(JSON.parse(one).feature, "auth");

    assert.equal(
      repo.nav([
        "issue",
        "open",
        "Bill by seat",
        "--feature",
        "auth",
        "--feature",
        "billing",
        "-m",
        "Body.",
        "--commit",
      ]).code,
      0,
    );
    const both = repo
      .nav(["issue", "list", "--json"])
      .stdout.trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((issue) => issue.title === "Bill by seat");
    assert.deepEqual(both.feature, ["auth", "billing"]);
  });

  it("filters a listing by feature, and ANDs two terms", () => {
    const titles = (...terms: string[]) =>
      repo
        .nav(["issue", "list", ...terms, "--json"])
        .stdout.trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line).title)
        .sort();

    assert.deepEqual(titles("feature:auth"), ["Add TOTP", "Bill by seat"]);
    assert.deepEqual(titles("feature:auth", "feature:billing"), ["Bill by seat"]);
    assert.deepEqual(titles("feature:nothing"), []);
  });

  it("attaches a pull request the same way", () => {
    repo.write("code.txt", "x\n");
    repo.commitAll("feat: something");
    repo.git(["checkout", "-q", "-b", "feat/x"]);
    repo.write("code.txt", "y\n");
    repo.commitAll("feat: more");
    const result = repo.nav([
      "pr",
      "open",
      "--title",
      "A change",
      "--feature",
      "auth",
      "-m",
      "Body.",
      "--commit",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const pr = JSON.parse(repo.nav(["pr", "list", "--json"]).stdout.trim());
    assert.equal(pr.feature, "auth");
    repo.git(["checkout", "-q", "main"]);
  });
});

describe("nav feature list and show", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav([
      "feature",
      "open",
      "Authentication",
      "--slug",
      "auth",
      "-m",
      "Signing in.",
      "--commit",
    ]);
    repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "## Requirements", "--commit"]);
    repo.nav(["issue", "open", "Add TOTP", "--feature", "auth", "-m", "Body.", "--commit"]);
    repo.nav(["issue", "open", "Old thing", "--feature", "auth", "-m", "Body.", "--commit"]);
  });
  after(() => repo.cleanup());

  it("counts what is attached", () => {
    const id = JSON.parse(
      repo
        .nav(["issue", "list", "--json"])
        .stdout.trim()
        .split("\n")
        .find((line) => line.includes("Old thing")) as string,
    ).id;
    repo.nav(["issue", "close", id, "--commit"]);

    const table = repo.nav(["feature", "list"]);
    assert.match(table.stdout, /SLUG\s+TITLE\s+SPECS\s+OPEN\s+CLOSED/);
    assert.match(table.stdout, /auth\s+Authentication\s+1\s+1\s+1/);
  });

  it("gives list and show the same shape for the same key", () => {
    const listed = JSON.parse(repo.nav(["feature", "list", "--json"]).stdout.trim());
    const shown = JSON.parse(repo.nav(["feature", "show", "auth", "--json"]).stdout.trim());
    assert.deepEqual(listed, shown);
    assert.equal(Array.isArray(shown.issues), true);
    assert.equal(shown.issues.length, 2);
    assert.deepEqual(shown.prs, []);
    assert.deepEqual(shown.specs, [{ file: "login-flow.md", title: "Login flow" }]);
  });

  it("renders the documents, the work and the history", () => {
    const shown = repo.nav(["feature", "show", "auth"]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /^auth$/m);
    assert.match(shown.stdout, /title:\s+Authentication/);
    assert.match(shown.stdout, /path:\s+\.navbook\/specs\/auth/);
    assert.match(shown.stdout, /specs \(1\):/);
    assert.match(shown.stdout, /login-flow\.md\s+Login flow/);
    assert.match(shown.stdout, /issues and pull requests \(2\):/);
    assert.match(shown.stdout, /recent commits \(\d+\):/);
    assert.match(shown.stdout, /docs\(feature\): create auth/);

    assert.doesNotMatch(
      repo.nav(["feature", "show", "auth", "--commits", "0"]).stdout,
      /recent commits/,
    );
  });

  it("says so when there is nothing to list", () => {
    const empty = makeNavRepo();
    try {
      assert.match(empty.nav(["feature", "list"]).stdout, /No features yet/);
      assert.equal(empty.nav(["feature", "list", "--json"]).stdout, "");
      assert.match(
        empty.nav(["feature", "spec", "list", "auth"]).stderr,
        /no feature named 'auth'/,
      );
    } finally {
      empty.cleanup();
    }
  });

  it("names the features that exist when one is not found", () => {
    const result = repo.nav(["feature", "show", "nope"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no feature named 'nope'/);
    assert.match(result.stderr, /auth\s+Authentication/);
  });
});

describe("completion", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeNavRepo();
    repo.nav(["feature", "open", "Authentication", "--slug", "auth", "-m", "x", "--commit"]);
    repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "x", "--commit"]);
    repo.nav(["issue", "open", "Add TOTP", "--feature", "auth", "-m", "Body.", "--commit"]);
  });
  after(() => repo.cleanup());

  const lines = (...words: string[]): string[] =>
    repo
      .nav(["__complete", ...words])
      .stdout.trim()
      .split("\n")
      .filter((line) => line !== "");

  it("offers the noun, its verbs, and the spec group", () => {
    assert.ok(lines().includes("feature"));
    assert.deepEqual(lines("feature"), ["open", "list", "show", "edit", "spec"]);
    assert.deepEqual(lines("feature", "spec"), ["add", "edit", "list"]);
  });

  it("offers slugs where a slug goes, and document names where one goes", () => {
    assert.deepEqual(lines("feature", "show"), ["auth"]);
    assert.deepEqual(lines("feature", "edit"), ["auth"]);
    assert.deepEqual(lines("feature", "spec", "add"), ["auth"]);
    assert.deepEqual(lines("feature", "spec", "edit"), ["auth"]);
    assert.deepEqual(lines("feature", "spec", "edit", "auth"), ["login-flow.md"]);
    assert.deepEqual(lines("feature", "spec", "edit", "auth", "login-flow.md"), []);
    assert.deepEqual(lines("feature", "open"), []);
    assert.deepEqual(lines("feature", "list"), []);
    assert.deepEqual(lines("feature", "nonsense"), []);
  });

  it("offers feature terms to a listing query", () => {
    const offered = lines("issue", "list");
    assert.ok(offered.includes("feature:"));
    assert.ok(offered.includes("feature:auth"));
  });
});
