/**
 * `nav feature` as a plugin — spec 04 §4.3.
 *
 * The cases that used to live in the CLI's own suite, asking the same
 * questions of the same commands. What they prove is that moving the code out
 * of `@navbook/cli` changed nothing anybody typing at a terminal would notice:
 * the same output, the same commits, the same refusals.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTempRepo, type TempRepo } from "@navbook/cli/test-helpers";

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package, as `NAVBOOK_PLUGIN_PATH` names it. */
const KB = join(HERE, "..");

/** A repository with the knowledge base installed and declared. */
function kbRepo(): TempRepo {
  const repo = makeTempRepo();
  repo.nav(["init"]);
  repo.write(
    ".navbook/navbook.json",
    `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-kb": {} } }, null, 2)}\n`,
  );
  return repo;
}

const ENV = { NAVBOOK_PLUGIN_PATH: KB };

describe("nav feature open", () => {
  it("creates the directory and its identity card", () => {
    const repo = kbRepo();
    try {
      const result = repo.nav(["feature", "open", "Authentication", "-m", "Signing in."], ENV);
      assert.equal(result.code, 0, result.stderr);
      assert.match(
        result.stdout,
        /Created \.navbook\/specs\/authentication\/ {2}\(authentication\)/,
      );
      const text = readFileSync(join(repo.dir, ".navbook/specs/authentication/feature.md"), "utf8");
      assert.match(text, /^title: Authentication$/m);
      assert.match(text, /^author: /m);
      assert.match(text, /Signing in\./);
    } finally {
      repo.cleanup();
    }
  });

  it("files it under the slug it was given", () => {
    const repo = kbRepo();
    try {
      const result = repo.nav(
        ["feature", "open", "Authentication", "--slug", "auth", "-m", "Signing in."],
        ENV,
      );
      assert.match(result.stdout, /\(auth\)/);
    } finally {
      repo.cleanup();
    }
  });

  it("commits under the scope the plugin declares", () => {
    const repo = kbRepo();
    try {
      repo.commitAll("chore: declare the plugin");
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x", "--commit"], ENV);
      const log = repo.git(["log", "-1", "--format=%s"]);
      assert.equal(log.stdout.trim(), "docs(feature): create auth");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a second feature under one slug", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const again = repo.nav(["feature", "open", "Other", "--slug", "auth", "-m", "y"], ENV);
      assert.equal(again.code, 1);
      assert.match(again.stderr, /already exists/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a slug that is not one", () => {
    const repo = kbRepo();
    try {
      const result = repo.nav(["feature", "open", "Auth", "--slug", "Not A Slug", "-m", "x"], ENV);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is not a feature slug/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav feature list", () => {
  it("says so when there are none", () => {
    const repo = kbRepo();
    try {
      assert.match(repo.nav(["feature", "list"], ENV).stdout, /No features yet/);
    } finally {
      repo.cleanup();
    }
  });

  it("counts the documents and the work attached", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "It SHALL."], ENV);
      repo.nav(["issue", "open", "Login times out", "-m", "b", "--feature", "auth"], ENV);
      const result = repo.nav(["feature", "list"], ENV);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /SLUG\s+TITLE\s+SPECS\s+OPEN\s+CLOSED/);
      assert.match(result.stdout, /auth\s+Auth\s+1\s+1\s+0/);
    } finally {
      repo.cleanup();
    }
  });

  it("emits one JSON object per feature", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const result = repo.nav(["feature", "list", "--json"], ENV);
      const row = JSON.parse(result.stdout.trim());
      assert.equal(row.slug, "auth");
      assert.equal(row.title, "Auth");
      assert.equal(row.path, ".navbook/specs/auth");
      assert.deepEqual(row.issues, []);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav feature show", () => {
  it("renders the feature, its documents and its members", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "Signing in."], ENV);
      repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "It SHALL."], ENV);
      const opened = repo.nav(["issue", "open", "Times out", "-m", "b", "--feature", "auth"], ENV);
      const id = opened.stdout.match(/#(\w{8})/)?.[1];
      const result = repo.nav(["feature", "show", "auth"], ENV);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /title: *Auth/);
      assert.match(result.stdout, /Signing in\./);
      assert.match(result.stdout, /login-flow\.md\s+Login flow/);
      assert.match(result.stdout, new RegExp(`#${id}\\s+open\\s+Times out`));
    } finally {
      repo.cleanup();
    }
  });

  it("says which features exist when the slug names none", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const result = repo.nav(["feature", "show", "billing"], ENV);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /no feature named 'billing'/);
      assert.match(result.stderr, /auth/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("nav feature spec", () => {
  it("adds a document and names it from its title", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const result = repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "It."], ENV);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Created \.navbook\/specs\/auth\/login-flow\.md/);
    } finally {
      repo.cleanup();
    }
  });

  it("refuses a name a tool must not create", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const result = repo.nav(
        ["feature", "spec", "add", "auth", "X", "--file", "feature.md", "-m", "y"],
        ENV,
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, /is not a document name this tool will create/);
    } finally {
      repo.cleanup();
    }
  });

  it("lists a feature's documents", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      repo.nav(["feature", "spec", "add", "auth", "Login flow", "-m", "It."], ENV);
      const result = repo.nav(["feature", "spec", "list", "auth"], ENV);
      assert.match(result.stdout, /login-flow\.md\s+Login flow/);
    } finally {
      repo.cleanup();
    }
  });
});

describe("what the plugin contributes to the built-in verbs", () => {
  it("attaches an issue to a feature with --feature", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const opened = repo.nav(["issue", "open", "T", "-m", "b", "--feature", "auth"], ENV);
      assert.equal(opened.code, 0, opened.stderr);
      const path = opened.stdout.match(/Created (\S+)/)?.[1];
      assert.ok(path);
      assert.match(readFileSync(join(repo.dir, path, "issue.md"), "utf8"), /^feature: auth$/m);
    } finally {
      repo.cleanup();
    }
  });

  it("writes several as a list", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      repo.nav(["feature", "open", "Mobile", "--slug", "mobile", "-m", "x"], ENV);
      const opened = repo.nav(
        ["issue", "open", "T", "-m", "b", "--feature", "auth", "--feature", "mobile"],
        ENV,
      );
      const path = opened.stdout.match(/Created (\S+)/)?.[1];
      assert.ok(path);
      assert.match(
        readFileSync(join(repo.dir, path, "issue.md"), "utf8"),
        /^feature: \[auth, mobile\]$/m,
      );
    } finally {
      repo.cleanup();
    }
  });

  it("finds them again with feature:", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      repo.nav(["issue", "open", "Attached", "-m", "b", "--feature", "auth"], ENV);
      repo.nav(["issue", "open", "Loose", "-m", "b"], ENV);
      const result = repo.nav(["issue", "list", "feature:auth"], ENV);
      assert.match(result.stdout, /Attached/);
      assert.doesNotMatch(result.stdout, /Loose/);
    } finally {
      repo.cleanup();
    }
  });

  it("offers the term and the slugs for completion", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      const keys = repo.nav(["__complete", "issue", "list"], ENV).stdout.split("\n");
      assert.ok(keys.includes("feature:"));
      assert.ok(keys.includes("feature:auth"));
    } finally {
      repo.cleanup();
    }
  });

  it("completes the noun and its verbs from the manifest", () => {
    const repo = kbRepo();
    try {
      assert.ok(repo.nav(["__complete"], ENV).stdout.split("\n").includes("feature"));
      assert.deepEqual(
        repo.nav(["__complete", "feature"], ENV).stdout.split("\n").filter(Boolean).sort(),
        ["edit", "list", "open", "show", "spec"],
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe("doctor", () => {
  it("reports D13 for a directory that is not a feature", () => {
    const repo = kbRepo();
    try {
      repo.write(".navbook/specs/loose.md", "---\ntitle: X\n---\n\nBody.\n");
      const result = repo.nav(["doctor"], ENV);
      assert.equal(result.code, 2, result.stdout);
      assert.match(result.stdout, /D13/);
    } finally {
      repo.cleanup();
    }
  });

  it("warns with D14 about a feature no directory holds", () => {
    const repo = kbRepo();
    try {
      repo.nav(["issue", "open", "T", "-m", "b"], ENV);
      const dir = readFileSync(join(repo.dir, ".navbook/navbook.json"), "utf8");
      assert.ok(dir.includes("plugin-kb"));
      // Attach it to a feature that does not exist, by hand.
      const issues = repo.nav(["issue", "list", "--json"], ENV).stdout.trim();
      const path = JSON.parse(issues).path as string;
      const file = join(repo.dir, path, "issue.md");
      const text = readFileSync(file, "utf8").replace("---\n\n", "feature: ghost\n---\n\n");
      repo.write(path.replace(".navbook/", "") ? `${path}/issue.md` : "", text);
      const result = repo.nav(["doctor"], ENV);
      assert.equal(result.code, 0, result.stdout);
      assert.match(result.stdout, /D14/);
    } finally {
      repo.cleanup();
    }
  });

  it("is silent about a sound tree", () => {
    const repo = kbRepo();
    try {
      repo.nav(["feature", "open", "Auth", "--slug", "auth", "-m", "x"], ENV);
      repo.nav(["issue", "open", "T", "-m", "b", "--feature", "auth"], ENV);
      const result = repo.nav(["doctor"], ENV);
      assert.equal(result.code, 0, result.stdout + result.stderr);
    } finally {
      repo.cleanup();
    }
  });
});

describe("without the plugin", () => {
  it("leaves specs/ alone and says it is undeclared", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init"]);
      repo.write(".navbook/specs/auth/feature.md", "---\ntitle: Auth\n---\n\nx.\n");
      const result = repo.nav(["issue", "list"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stderr, /belongs to @navbook\/plugin-kb/);
      // Preserved, which is what §2.12 requires of a tool that cannot read it.
      assert.ok(readFileSync(join(repo.dir, ".navbook/specs/auth/feature.md"), "utf8"));
    } finally {
      repo.cleanup();
    }
  });

  it("has no feature noun at all", () => {
    const repo = makeTempRepo();
    try {
      repo.nav(["init"]);
      const result = repo.nav(["feature", "list"]);
      assert.notEqual(result.code, 0);
    } finally {
      repo.cleanup();
    }
  });
});
