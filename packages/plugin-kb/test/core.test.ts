/**
 * The knowledge base as a plugin — spec 02 §2.11, §2.12.
 *
 * These are the cases that used to live in `@navbook/core`'s suite, asking the
 * same questions of the same trees. What they prove is that the move changed
 * nothing a reader of a repository could notice: the same files parse, the
 * same faults are D13 and D14, and `feature:` matches what it always did.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as core from "@navbook/core";
import {
  type CoreExtensions,
  type ExtensionParts,
  mergeExtensions,
  type NavTree,
  parseTree,
  validateRepo,
} from "@navbook/core";
import { activate } from "../src/core/index.ts";
import { kbOf } from "../src/core/tree.ts";

/** The extensions this plugin registers, as a host would assemble them. */
function extensions(): CoreExtensions {
  const parts: ExtensionParts[] = [];
  activate({
    core,
    manifest: { short: "kb" },
    settings: {},
    register: (part) => void parts.push(part),
  });
  return mergeExtensions(parts);
}

const ext = extensions();
const tree = (entries: Record<string, string>): NavTree => new Map(Object.entries(entries));

const FEATURE = [
  "---",
  "title: Authentication",
  "author: alice@example.com",
  "created: 2026-09-01T10:00:00Z",
  "---",
  "",
  "Signing in, sessions, tokens.",
  "",
].join("\n");

const SPEC = ["---", "title: Login flow", "---", "", "It SHALL abort after 5 s.", ""].join("\n");

const issue = (extra = ""): string =>
  [
    "---",
    "title: Login times out",
    "author: alice@example.com",
    "created: 2026-09-02T09:14:00Z",
    extra,
    "---",
    "",
    "Aborts after 5 s.",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .replace("---\n\nAborts", "---\n\nAborts");

const WITH_FEATURE = {
  "specs/auth/feature.md": FEATURE,
  "specs/auth/login-flow.md": SPEC,
  "issues/open/ab12cd34-login/issue.md": issue("feature: auth"),
};

describe("reading specs/", () => {
  it("builds a feature and its documents", () => {
    const repo = parseTree(tree(WITH_FEATURE), { ext });
    const kb = kbOf(repo.ext);
    assert.equal(kb.features.length, 1);
    const feature = kb.features[0];
    assert.equal(feature?.slug, "auth");
    assert.equal(feature?.title, "Authentication");
    assert.deepEqual(
      feature?.specs.map((spec) => spec.fileName),
      ["login-flow.md"],
    );
    assert.equal(feature?.specs[0]?.title, "Login flow");
  });

  it("finds a feature by slug", () => {
    const repo = parseTree(tree(WITH_FEATURE), { ext });
    assert.ok(kbOf(repo.ext).featureBySlug.has("auth"));
  });

  it("keeps a file it is not meant to interpret", () => {
    // §2.11: anything else the directory holds is preserved and not read.
    const repo = parseTree(tree({ ...WITH_FEATURE, "specs/auth/diagram.png": "binary" }), { ext });
    assert.deepEqual(kbOf(repo.ext).features[0]?.extraFiles, ["specs/auth/diagram.png"]);
  });

  it("reads nothing at all from a tree with no specs/", () => {
    const repo = parseTree(tree({ "issues/open/ab12cd34-login/issue.md": issue() }), { ext });
    assert.deepEqual(kbOf(repo.ext).features, []);
  });

  it("leaves the directory uninterpreted when the plugin is absent", () => {
    // What somebody without this plugin sees: the files are there, preserved,
    // and nothing pretends to understand them (§2.12).
    const repo = parseTree(tree(WITH_FEATURE));
    assert.ok(repo.reserved.includes("specs/auth/feature.md"));
    assert.equal(repo.ext.size, 0);
  });
});

describe("the feature: key", () => {
  it("reads a scalar and a list the same way", () => {
    const one = parseTree(tree(WITH_FEATURE), { ext });
    assert.equal(one.issues[0]?.fm.feature, "auth");

    const many = parseTree(
      tree({
        ...WITH_FEATURE,
        "specs/mobile/feature.md": FEATURE.replace("Authentication", "Mobile"),
        "issues/open/ab12cd34-login/issue.md": issue("feature: [auth, mobile]"),
      }),
      { ext },
    );
    assert.deepEqual(many.issues[0]?.fm.feature, ["auth", "mobile"]);
  });

  it("is a D2 fault when it is not a slug", () => {
    const repo = parseTree(
      tree({ "issues/open/ab12cd34-login/issue.md": issue("feature: Not A Slug") }),
      { ext },
    );
    const found = validateRepo(repo, { ext });
    assert.ok(found.some((d) => d.check === "D2" && /must be a slug/.test(d.message)));
  });
});

describe("the feature: query term", () => {
  const repo = parseTree(tree(WITH_FEATURE), { ext });
  const entity = repo.issues[0];

  it("matches an entity that names the feature", () => {
    const query = core.parseQuery(["feature:auth"], "issue", ext);
    assert.ok(!("message" in query));
    assert.equal(core.matchesQuery(query, entity as never, undefined, ext), true);
  });

  it("does not match one that names another", () => {
    const query = core.parseQuery(["feature:billing"], "issue", ext);
    assert.ok(!("message" in query));
    assert.equal(core.matchesQuery(query, entity as never, undefined, ext), false);
  });

  it("ANDs when repeated, as label and assignee do", () => {
    const query = core.parseQuery(["feature:auth", "feature:mobile"], "issue", ext);
    assert.ok(!("message" in query));
    assert.equal(core.matchesQuery(query, entity as never, undefined, ext), false);
  });

  it("ignores case, as every other term does", () => {
    const query = core.parseQuery(["feature:AUTH"], "issue", ext);
    assert.ok(!("message" in query));
    assert.equal(core.matchesQuery(query, entity as never, undefined, ext), true);
  });
});

describe("D13", () => {
  const codes = (entries: Record<string, string>): string[] =>
    validateRepo(parseTree(tree(entries), { ext }), { ext }).map((d) => d.check);

  it("is silent about a well-formed feature", () => {
    assert.deepEqual(codes(WITH_FEATURE), []);
  });

  it("reports a file directly in specs/", () => {
    assert.ok(codes({ ...WITH_FEATURE, "specs/loose.md": SPEC }).includes("D13"));
  });

  it("reports a directory name that is not a slug", () => {
    assert.ok(codes({ "specs/Not A Slug/feature.md": FEATURE }).includes("D13"));
  });

  it("reports a feature directory with no feature.md", () => {
    assert.ok(codes({ "specs/auth/login-flow.md": SPEC }).includes("D13"));
  });

  it("reports a feature.md missing a required key", () => {
    const bad = FEATURE.replace("author: alice@example.com\n", "");
    assert.ok(codes({ "specs/auth/feature.md": bad }).includes("D13"));
  });

  it("reports a document missing its title", () => {
    const bad = SPEC.replace("title: Login flow\n", "");
    assert.ok(codes({ ...WITH_FEATURE, "specs/auth/login-flow.md": bad }).includes("D13"));
  });
});

describe("D14", () => {
  it("warns about a feature no directory holds", () => {
    const repo = parseTree(
      tree({ "issues/open/ab12cd34-login/issue.md": issue("feature: ghost") }),
      { ext },
    );
    const found = validateRepo(repo, { ext }).filter((d) => d.check === "D14");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.level, "warning");
  });

  it("is silent when the feature exists", () => {
    const found = validateRepo(parseTree(tree(WITH_FEATURE), { ext }), { ext });
    assert.equal(found.filter((d) => d.check === "D14").length, 0);
  });

  it("is a warning rather than an error, so it never fails a commit", () => {
    // The feature may live on a branch nobody has fetched (§2.9's reasoning).
    const repo = parseTree(
      tree({ "issues/open/ab12cd34-login/issue.md": issue("feature: ghost") }),
      { ext },
    );
    assert.equal(core.hasErrors(validateRepo(repo, { ext })), false);
  });
});

describe("the checks keep the numbers the fixtures assert", () => {
  it("still calls them D13 and D14, not X-kb-*", () => {
    // §2.12 grandfathers the names; these numbers follow, so one conformance
    // suite validates an implementation with features built in and one with
    // them in a plugin.
    const ids = ext.doctorChecks.map((check) => check.id).sort();
    assert.deepEqual(ids, ["D13", "D14"]);
  });

  it("sorts them among the format's own checks rather than after them", () => {
    const repo = parseTree(
      tree({
        "issues/open/loose.md": "x",
        "issues/open/ab12cd34-login/issue.md": issue("feature: ghost"),
      }),
      { ext },
    );
    assert.deepEqual(
      validateRepo(repo, { ext }).map((d) => d.check),
      ["D1", "D14"],
    );
  });
});
