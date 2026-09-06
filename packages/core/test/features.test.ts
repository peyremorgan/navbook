/**
 * The feature model: how `specs/` is read, what a feature file must say, and
 * how an entity names the feature it belongs to (spec 02 §2.11).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSpecFileName,
  newFeatureFile,
  newIssueFile,
  newSpecFile,
  parseFile,
  readFeatures,
  specFileName,
  validateFeature,
  validateSpec,
} from "../src/core/files.ts";
import { featureJson, specJson } from "../src/core/json.ts";
import { type NavTree, parseTree } from "../src/core/tree.ts";
import { validateTree } from "../src/core/validate.ts";

const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));

const featureFile = (title = "Authentication"): string =>
  `---\ntitle: ${title}\nauthor: alice@example.com\ncreated: 2026-09-01T10:00:00Z\n---\n\nEverything about signing in.\n`;

const specFile = (title = "Login flow"): string => `---\ntitle: ${title}\n---\n\n## Requirements\n`;

const issueFile = (feature?: string): string =>
  `---\ntitle: Login times out\nauthor: alice@example.com\ncreated: 2026-08-02T09:14:00Z\n${feature === undefined ? "" : `feature: ${feature}\n`}---\n\nBody.\n`;

const messages = (files: Record<string, string>, check: string): string[] =>
  validateTree(tree(files))
    .filter((d) => d.check === check)
    .map((d) => `${d.path}: ${d.message}`);

describe("parseTree over specs/", () => {
  it("reads a feature, its documents, and what it holds besides", () => {
    const repo = parseTree(
      tree({
        "specs/auth/feature.md": featureFile(),
        "specs/auth/login-flow.md": specFile(),
        "specs/auth/Session Policy.md": specFile("Session policy"),
        "specs/auth/diagrams/flow.png": "binary-ish",
        "specs/auth/notes.txt": "loose",
        "specs/billing/feature.md": featureFile("Billing"),
      }),
    );

    assert.deepEqual(repo.featureProblems, []);
    assert.deepEqual(
      repo.features.map((f) => f.slug),
      ["auth", "billing"],
    );

    const auth = repo.featureBySlug.get("auth");
    assert.ok(auth);
    assert.equal(auth.title, "Authentication");
    assert.equal(auth.dirPath, "specs/auth");
    assert.equal(auth.filePath, "specs/auth/feature.md");
    assert.equal(auth.body.trim(), "Everything about signing in.");
    // Any `*.md` beside `feature.md` is a document, whatever it is called.
    assert.deepEqual(
      auth.specs.map((s) => [s.fileName, s.title]),
      [
        ["Session Policy.md", "Session policy"],
        ["login-flow.md", "Login flow"],
      ],
    );
    // Everything else is kept and not read.
    assert.deepEqual(auth.extraFiles, ["specs/auth/diagrams/flow.png", "specs/auth/notes.txt"]);
  });

  it("keeps feature faults out of the entity faults D1 reports", () => {
    const repo = parseTree(
      tree({
        "issues/open/bqlybac0-x/issue.md": issueFile(),
        "specs/Auth/feature.md": featureFile(),
        "specs/stray.md": specFile(),
      }),
    );
    assert.deepEqual(repo.problems, []);
    assert.equal(repo.featureProblems.length, 2);
    assert.deepEqual(repo.features, []);
  });

  it("tolerates an archived copy rather than reading it as a feature", () => {
    const repo = parseTree(tree({ "archive/2024/specs/auth/feature.md": featureFile() }));
    assert.deepEqual(repo.features, []);
    assert.deepEqual(repo.featureProblems, []);
    assert.deepEqual(repo.reserved, ["archive/2024/specs/auth/feature.md"]);
  });

  it("still routes other unknown roots to reserved", () => {
    const repo = parseTree(tree({ "config.yaml": "future: true", "sync/github/state.json": "{}" }));
    assert.deepEqual(repo.reserved, ["config.yaml", "sync/github/state.json"]);
  });
});

describe("the feature key on an entity", () => {
  it("reads a scalar and a list alike", () => {
    const one = parseFile(issueFile("auth"));
    assert.deepEqual(readFeatures(one.fm), ["auth"]);
    const many = parseFile(issueFile("[auth, mobile]"));
    assert.deepEqual(readFeatures(many.fm), ["auth", "mobile"]);
  });

  it("ignores values that could name no directory", () => {
    assert.deepEqual(readFeatures(parseFile(issueFile("Auth!")).fm), []);
    assert.deepEqual(readFeatures(parseFile(issueFile("[auth, Mobile]")).fm), ["auth"]);
    assert.deepEqual(readFeatures(parseFile(issueFile()).fm), []);
  });

  it("reads a value YAML would resolve to a number as the text it was typed as", () => {
    // `specs/7/` is a legal directory name, so `feature: 7` names it.
    assert.deepEqual(readFeatures(parseFile(issueFile("7")).fm), ["7"]);
  });

  it("reports a value that is not a slug as a schema fault", () => {
    assert.deepEqual(messages({ "issues/open/bqlybac0-x/issue.md": issueFile("Auth!") }, "D2"), [
      "issues/open/bqlybac0-x/issue.md: 'feature' must be a slug or list of slugs",
    ]);
    assert.deepEqual(messages({ "issues/open/bqlybac0-x/issue.md": issueFile("[]") }, "D2"), [
      "issues/open/bqlybac0-x/issue.md: 'feature' must be a slug or list of slugs",
    ]);
  });
});

describe("doctor D13", () => {
  it("reports a directory name that is not a slug", () => {
    assert.deepEqual(messages({ "specs/Auth/feature.md": featureFile() }, "D13"), [
      "specs/Auth/feature.md: feature directory name 'Auth' does not match the slug grammar (§2.11)",
    ]);
  });

  it("reports a file sitting directly in specs/", () => {
    assert.deepEqual(messages({ "specs/auth.md": featureFile() }, "D13"), [
      "specs/auth.md: 'specs/' must contain feature directories, not files (§2.11)",
    ]);
  });

  it("reports a feature directory with no feature.md", () => {
    assert.deepEqual(messages({ "specs/auth/login-flow.md": specFile() }, "D13"), [
      "specs/auth: feature directory is missing its feature.md (§2.11)",
    ]);
  });

  it("reports missing keys on feature.md and on a document", () => {
    assert.deepEqual(
      messages(
        {
          "specs/auth/feature.md": "---\ntitle: Authentication\n---\n\nSummary.\n",
          "specs/auth/login-flow.md": "---\nauthor: alice@example.com\n---\n\nBody.\n",
        },
        "D13",
      ),
      [
        "specs/auth/feature.md: missing required key 'author'",
        "specs/auth/feature.md: missing required key 'created'",
        "specs/auth/login-flow.md: missing required key 'title'",
      ],
    );
  });

  it("reports a document with no frontmatter at all", () => {
    const found = messages(
      {
        "specs/auth/feature.md": featureFile(),
        "specs/auth/login-flow.md": "# Login flow\n\nNo frontmatter here.\n",
      },
      "D13",
    );
    assert.equal(found.length, 1);
    assert.match(found[0] as string, /^specs\/auth\/login-flow\.md: /);
  });

  it("passes a well-formed tree, empty summary included", () => {
    assert.deepEqual(
      messages(
        {
          "specs/auth/feature.md":
            "---\ntitle: Authentication\nauthor: alice@example.com\ncreated: 2026-09-01T10:00:00Z\n---\n",
          "specs/auth/login-flow.md": specFile(),
        },
        "D13",
      ),
      [],
    );
  });
});

describe("doctor D14", () => {
  it("warns when an entity names a feature this tree does not hold", () => {
    assert.deepEqual(
      messages(
        {
          "issues/open/bqlybac0-x/issue.md": issueFile("[auth, bilng]"),
          "specs/auth/feature.md": featureFile(),
        },
        "D14",
      ),
      [
        "issues/open/bqlybac0-x/issue.md: feature 'bilng' has no specs/bilng/ directory in this tree",
      ],
    );
  });

  it("says nothing when the directory is there", () => {
    assert.deepEqual(
      messages(
        {
          "issues/open/bqlybac0-x/issue.md": issueFile("auth"),
          "specs/auth/feature.md": featureFile(),
        },
        "D14",
      ),
      [],
    );
  });
});

describe("composing feature files", () => {
  it("writes a feature.md that validates", () => {
    const content = newFeatureFile({
      title: "Authentication",
      author: "alice@example.com",
      created: "2026-09-01T10:00:00Z",
      body: "Everything about signing in.",
    });
    assert.equal(
      content,
      "---\ntitle: Authentication\nauthor: alice@example.com\ncreated: 2026-09-01T10:00:00Z\n---\n\nEverything about signing in.\n",
    );
    assert.deepEqual(validateFeature(parseFile(content)), []);
  });

  it("writes a feature.md with no summary, ending at its delimiter", () => {
    const content = newFeatureFile({
      title: "Billing",
      author: "alice@example.com",
      created: "2026-09-01T10:00:00Z",
    });
    assert.equal(
      content,
      "---\ntitle: Billing\nauthor: alice@example.com\ncreated: 2026-09-01T10:00:00Z\n---\n",
    );
    assert.deepEqual(validateFeature(parseFile(content)), []);
    assert.equal(parseFile(content).body, "");
    // And it reads back as the file it is: no body, no blank line invented.
    assert.equal(
      newFeatureFile({
        title: "Billing",
        author: "alice@example.com",
        created: "2026-09-01T10:00:00Z",
        body: "   ",
      }),
      content,
    );
  });

  it("writes a spec document that validates", () => {
    const content = newSpecFile({ title: "Login flow", body: "## Requirements" });
    assert.equal(content, "---\ntitle: Login flow\n---\n\n## Requirements\n");
    assert.deepEqual(validateSpec(parseFile(content)), []);
  });

  it("writes one feature as a scalar and several as a flow list", () => {
    const base = {
      title: "Add TOTP",
      author: "alice@example.com",
      created: "2026-09-01T10:00:00Z",
      body: "Body.",
    };
    assert.match(newIssueFile({ ...base, features: ["auth"] }), /^feature: auth$/m);
    assert.match(
      newIssueFile({ ...base, features: ["auth", "mobile"] }),
      /^feature: \[auth, mobile\]$/m,
    );
    assert.doesNotMatch(newIssueFile(base), /feature/);
  });

  it("round-trips both spellings through the parser", () => {
    const base = {
      title: "Add TOTP",
      author: "alice@example.com",
      created: "2026-09-01T10:00:00Z",
      body: "Body.",
    };
    for (const features of [["auth"], ["auth", "mobile"]]) {
      const parsed = parseFile(newIssueFile({ ...base, features }));
      assert.deepEqual(readFeatures(parsed.fm), features);
    }
  });
});

describe("spec document names", () => {
  it("derives a name from a title", () => {
    assert.equal(specFileName("Login flow"), "login-flow.md");
    assert.equal(specFileName("日本語"), "untitled.md");
  });

  it("never derives the name the identity card already uses", () => {
    assert.equal(specFileName("Feature"), "feature-spec.md");
    assert.equal(isSpecFileName(specFileName("Feature")), true);
  });

  it("accepts what a tool may create and refuses the rest", () => {
    assert.equal(isSpecFileName("login-flow.md"), true);
    assert.equal(isSpecFileName("feature.md"), false);
    assert.equal(isSpecFileName("Login Flow.md"), false);
    assert.equal(isSpecFileName("../escape.md"), false);
    assert.equal(isSpecFileName("login-flow.txt"), false);
  });
});

describe("the JSON projection", () => {
  it("names identity first, then frontmatter in file order, then the documents", () => {
    const repo = parseTree(
      tree({
        "specs/auth/feature.md": featureFile(),
        "specs/auth/login-flow.md": specFile(),
      }),
    );
    const feature = repo.features[0];
    assert.ok(feature);
    assert.deepEqual(featureJson(".navbook", feature), {
      slug: "auth",
      path: ".navbook/specs/auth",
      title: "Authentication",
      author: "alice@example.com",
      created: "2026-09-01T10:00:00Z",
      body: "Everything about signing in.",
      specs: [{ file: "login-flow.md", title: "Login flow" }],
    });
    assert.deepEqual(specJson(".navbook", feature, feature.specs[0]!), {
      feature: "auth",
      file: "login-flow.md",
      path: ".navbook/specs/auth/login-flow.md",
      title: "Login flow",
      body: "## Requirements",
    });
  });
});
