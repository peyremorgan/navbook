/**
 * Features over the API — spec 02 §2.11.
 *
 * The three-way assertion of `write.test.ts` holds here too: what the payload
 * said, what the file now holds, and what origin received. Beyond that, two
 * things are peculiar to features and get their own attention — the commit
 * listing, which is the one field that reads history rather than the tree, and
 * the refusal of a save made against a version somebody has since replaced.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { errorCode, type Harness, ok, startHarness } from "../helpers/harness.ts";
import { originSubjects } from "../helpers/temprepo.ts";

const FEATURE_FIELDS = `slug title author created summary path baseSha
  specs { fileName title path body baseSha }`;

const CREATE = `mutation Create($input: CreateFeatureInput!) {
  createFeature(input: $input) { feature { ${FEATURE_FIELDS} } commit { committed subject pushed } }
}`;

const UPDATE_FEATURE = `mutation UpdateFeature($input: UpdateFeatureInput!) {
  updateFeature(input: $input) { feature { ${FEATURE_FIELDS} } commit { committed subject pushed } }
}`;

const ADD_SPEC = `mutation AddSpec($input: AddSpecInput!) {
  addSpec(input: $input) {
    feature { slug specs { fileName } }
    spec { fileName title body path baseSha }
    commit { committed subject pushed }
  }
}`;

const UPDATE_SPEC = `mutation UpdateSpec($input: UpdateSpecInput!) {
  updateSpec(input: $input) {
    feature { slug }
    spec { fileName title body baseSha }
    commit { committed subject pushed }
  }
}`;

const FEATURE = `query Feature($slug: String!) {
  feature(slug: $slug) {
    ${FEATURE_FIELDS}
    issues { id title status features }
    prs { id }
    commits(limit: 20) { sha subject author date }
  }
}`;

const FEATURES = `query { features { slug title specs { fileName } } }`;

const OPEN_ISSUE = `mutation Open($input: OpenIssueInput!) {
  openIssue(input: $input) { issue { id features } commit { subject } }
}`;

const UPDATE_ISSUE = `mutation Update($input: UpdateIssueInput!) {
  updateIssue(input: $input) { issue { id features } commit { subject } }
}`;

const ISSUES = `query Issues($filter: EntityFilter) { issues(filter: $filter) { id title features } }`;

// biome-ignore lint/suspicious/noExplicitAny: test payloads are read positionally
type Payload = any;

describe("features", () => {
  let h: Harness;

  const fileOf = (path: string): string => readFileSync(join(h.fixture.server.dir, path), "utf8");
  const has = (path: string): boolean => existsSync(join(h.fixture.server.dir, path));

  const create = async (input: Record<string, unknown>): Promise<Payload> =>
    ok<Payload>(await h.gql(CREATE, { input })).createFeature;
  const addSpec = async (input: Record<string, unknown>): Promise<Payload> =>
    ok<Payload>(await h.gql(ADD_SPEC, { input })).addSpec;
  const feature = async (slug: string): Promise<Payload> =>
    ok<Payload>(await h.gql(FEATURE, { slug })).feature;

  before(async () => {
    h = await startHarness();
  });
  after(async () => {
    await h.stop();
  });

  it("creates a feature, commits it, and pushes it to origin", async () => {
    const result = await create({
      title: "Authentication",
      slug: "auth",
      summary: "Signing in, sessions and tokens.",
    });

    assert.equal(result.feature.slug, "auth");
    assert.equal(result.feature.title, "Authentication");
    assert.equal(result.feature.summary, "Signing in, sessions and tokens.");
    assert.equal(result.feature.path, ".navbook/specs/auth");
    assert.deepEqual(result.feature.specs, []);
    // The person the token names is the author; the machine is the committer.
    assert.equal(result.feature.author, "A Person <person@example.invalid>");
    assert.equal(result.commit.subject, "docs(feature): create auth");
    assert.equal(result.commit.committed, true);
    assert.equal(result.commit.pushed, true);

    assert.match(fileOf(".navbook/specs/auth/feature.md"), /^title: Authentication$/m);
    assert.equal(originSubjects(h.fixture.origin)[0], "docs(feature): create auth");
  });

  it("derives the slug from the title, and takes a feature with no summary", async () => {
    const result = await create({ title: "Billing & Invoices" });
    assert.equal(result.feature.slug, "billing-invoices");
    assert.equal(result.feature.summary, "");
    // No summary means the file ends at its delimiter, with no blank line.
    assert.ok(fileOf(".navbook/specs/billing-invoices/feature.md").endsWith("---\n"));
  });

  it("refuses a slug that already names a feature, and one that is not a slug", async () => {
    assert.equal(
      errorCode(await h.gql(CREATE, { input: { title: "Another", slug: "auth" } })),
      "ALREADY_EXISTS",
    );
    assert.equal(
      errorCode(await h.gql(CREATE, { input: { title: "X", slug: "Not A Slug" } })),
      "INVALID_INPUT",
    );
    assert.equal(errorCode(await h.gql(CREATE, { input: { title: "  " } })), "INVALID_INPUT");
    // The refusal wrote nothing.
    assert.match(fileOf(".navbook/specs/auth/feature.md"), /^title: Authentication$/m);
  });

  it("adds a document, naming the file from the title", async () => {
    const result = await addSpec({
      feature: "auth",
      title: "Login flow",
      body: "## Requirements\n\nThe app SHALL abort after 5 s.",
    });

    assert.equal(result.spec.fileName, "login-flow.md");
    assert.equal(result.spec.title, "Login flow");
    assert.equal(result.spec.path, ".navbook/specs/auth/login-flow.md");
    assert.match(result.spec.body, /^## Requirements/);
    assert.deepEqual(
      result.feature.specs.map((s: Payload) => s.fileName),
      ["login-flow.md"],
    );
    assert.equal(result.commit.subject, "docs(feature): add auth/login-flow.md");
    assert.equal(originSubjects(h.fixture.origin)[0], "docs(feature): add auth/login-flow.md");
  });

  it("refuses a document name a tool must not create", async () => {
    for (const fileName of ["feature.md", "../escape.md", "Login Flow.md", "notes.txt", "a/b.md"]) {
      assert.equal(
        errorCode(
          await h.gql(ADD_SPEC, {
            input: { feature: "auth", title: "X", body: "Body.", fileName },
          }),
        ),
        "INVALID_INPUT",
        fileName,
      );
    }
    // Nothing escaped the feature's directory.
    assert.equal(has(".navbook/specs/escape.md"), false);
    assert.equal(has(".navbook/escape.md"), false);
  });

  it("refuses a document the feature already has, and one on a feature that is not there", async () => {
    assert.equal(
      errorCode(
        await h.gql(ADD_SPEC, { input: { feature: "auth", title: "Login flow", body: "Again." } }),
      ),
      "ALREADY_EXISTS",
    );
    assert.equal(
      errorCode(await h.gql(ADD_SPEC, { input: { feature: "nope", title: "X", body: "Body." } })),
      "NOT_FOUND",
    );
  });

  it("edits a document, preserving keys the schema does not name", async () => {
    const before = await feature("auth");
    const spec = before.specs.find((s: Payload) => s.fileName === "login-flow.md");

    const result = ok<Payload>(
      await h.gql(UPDATE_SPEC, {
        input: {
          feature: "auth",
          fileName: "login-flow.md",
          body: "## Requirements\n\nRewritten.",
          baseSha: spec.baseSha,
        },
      }),
    ).updateSpec;

    assert.equal(result.spec.title, "Login flow");
    assert.match(result.spec.body, /Rewritten\./);
    assert.equal(result.commit.subject, "docs(feature): edit auth/login-flow.md");
    // The hash moved with the file, so the next edit has something to send.
    assert.notEqual(result.spec.baseSha, spec.baseSha);
    assert.match(fileOf(".navbook/specs/auth/login-flow.md"), /Rewritten\./);
  });

  it("edits the identity card, and clears a summary when asked to", async () => {
    const before = await feature("auth");
    const renamed = ok<Payload>(
      await h.gql(UPDATE_FEATURE, {
        input: { slug: "auth", title: "Authentication and sessions", baseSha: before.baseSha },
      }),
    ).updateFeature;
    assert.equal(renamed.feature.title, "Authentication and sessions");
    assert.equal(renamed.feature.summary, "Signing in, sessions and tokens.");
    assert.equal(renamed.commit.subject, "docs(feature): edit auth");

    const cleared = ok<Payload>(
      await h.gql(UPDATE_FEATURE, {
        input: { slug: "auth", summary: null, baseSha: renamed.feature.baseSha },
      }),
    ).updateFeature;
    assert.equal(cleared.feature.summary, "");
    assert.ok(fileOf(".navbook/specs/auth/feature.md").endsWith("---\n"));
  });

  it("refuses a patch that names nothing to change", async () => {
    const current = await feature("auth");
    assert.equal(
      errorCode(await h.gql(UPDATE_FEATURE, { input: { slug: "auth", baseSha: current.baseSha } })),
      "INVALID_INPUT",
    );
    assert.equal(
      errorCode(
        await h.gql(UPDATE_SPEC, {
          input: { feature: "auth", fileName: "login-flow.md", baseSha: "whatever" },
        }),
      ),
      "INVALID_INPUT",
    );
  });

  it("refuses a save made against a version somebody has since replaced", async () => {
    const current = await feature("auth");
    const spec = current.specs.find((s: Payload) => s.fileName === "login-flow.md");
    const stale = spec.baseSha;

    // Somebody else saves first.
    ok<Payload>(
      await h.gql(UPDATE_SPEC, {
        input: {
          feature: "auth",
          fileName: "login-flow.md",
          body: "Theirs.",
          baseSha: stale,
        },
      }),
    );

    const refused = await h.gql(UPDATE_SPEC, {
      input: { feature: "auth", fileName: "login-flow.md", body: "Mine.", baseSha: stale },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    // Refused before anything was written: their work is still there.
    assert.match(fileOf(".navbook/specs/auth/login-flow.md"), /Theirs\./);

    // With the hash it actually has, the same save goes through.
    const fresh = (await feature("auth")).specs.find(
      (s: Payload) => s.fileName === "login-flow.md",
    );
    ok<Payload>(
      await h.gql(UPDATE_SPEC, {
        input: {
          feature: "auth",
          fileName: "login-flow.md",
          body: "Mine.",
          baseSha: fresh.baseSha,
        },
      }),
    );
    assert.match(fileOf(".navbook/specs/auth/login-flow.md"), /Mine\./);
  });

  it("guards the identity card the same way", async () => {
    const current = await feature("auth");
    ok<Payload>(
      await h.gql(UPDATE_FEATURE, {
        input: { slug: "auth", summary: "Theirs.", baseSha: current.baseSha },
      }),
    );
    assert.equal(
      errorCode(
        await h.gql(UPDATE_FEATURE, {
          input: { slug: "auth", summary: "Mine.", baseSha: current.baseSha },
        }),
      ),
      "STALE_CONTENT",
    );
  });

  it("lists features in slug order, and reports one that is not there", async () => {
    const listed = ok<Payload>(await h.gql(FEATURES)).features;
    assert.deepEqual(
      listed.map((f: Payload) => f.slug),
      ["auth", "billing-invoices"],
    );
    assert.equal(errorCode(await h.gql(FEATURE, { slug: "nope" })), "NOT_FOUND");
    // A slug is exact: a prefix of one is not one.
    assert.equal(errorCode(await h.gql(FEATURE, { slug: "aut" })), "NOT_FOUND");
  });

  it("attaches issues, and gathers them under the feature", async () => {
    const one = ok<Payload>(
      await h.gql(OPEN_ISSUE, {
        input: { title: "Add TOTP", body: "Body.", features: ["auth"] },
      }),
    ).openIssue;
    assert.deepEqual(one.issue.features, ["auth"]);
    assert.match(
      fileOf(`.navbook/issues/open/${one.issue.id}-add-totp/issue.md`),
      /^feature: auth$/m,
    );

    const both = ok<Payload>(
      await h.gql(OPEN_ISSUE, {
        input: { title: "Bill by seat", body: "Body.", features: ["auth", "billing-invoices"] },
      }),
    ).openIssue;
    assert.deepEqual(both.issue.features, ["auth", "billing-invoices"]);
    assert.match(
      fileOf(`.navbook/issues/open/${both.issue.id}-bill-by-seat/issue.md`),
      /^feature: \[auth, billing-invoices\]$/m,
    );

    const gathered = await feature("auth");
    assert.deepEqual(
      gathered.issues.map((i: Payload) => i.id).sort(),
      [both.issue.id, one.issue.id].sort(),
    );
    assert.deepEqual(gathered.prs, []);
  });

  it("sets and clears an issue's features through a patch", async () => {
    const opened = ok<Payload>(
      await h.gql(OPEN_ISSUE, { input: { title: "Later", body: "Body." } }),
    ).openIssue;
    assert.deepEqual(opened.issue.features, []);

    const attached = ok<Payload>(
      await h.gql(UPDATE_ISSUE, {
        input: { ref: opened.issue.id, features: ["auth", "billing-invoices"] },
      }),
    ).updateIssue;
    assert.deepEqual(attached.issue.features, ["auth", "billing-invoices"]);

    const narrowed = ok<Payload>(
      await h.gql(UPDATE_ISSUE, { input: { ref: opened.issue.id, features: ["auth"] } }),
    ).updateIssue;
    assert.deepEqual(narrowed.issue.features, ["auth"]);
    assert.match(
      fileOf(`.navbook/issues/open/${opened.issue.id}-later/issue.md`),
      /^feature: auth$/m,
    );

    const cleared = ok<Payload>(
      await h.gql(UPDATE_ISSUE, { input: { ref: opened.issue.id, features: [] } }),
    ).updateIssue;
    assert.deepEqual(cleared.issue.features, []);
    assert.doesNotMatch(
      fileOf(`.navbook/issues/open/${opened.issue.id}-later/issue.md`),
      /^feature:/m,
    );
  });

  it("filters a listing by feature, ANDing the terms", async () => {
    const titles = async (features: string[]): Promise<string[]> =>
      ok<Payload>(await h.gql(ISSUES, { filter: { features } }))
        .issues.map((i: Payload) => i.title)
        .sort();

    assert.deepEqual(await titles(["auth"]), ["Add TOTP", "Bill by seat"]);
    assert.deepEqual(await titles(["auth", "billing-invoices"]), ["Bill by seat"]);
    assert.deepEqual(await titles(["nothing"]), []);
  });

  it("reports the commits that touched a feature, and only those", async () => {
    const gathered = await feature("auth");
    const subjects = gathered.commits.map((c: Payload) => c.subject);

    assert.ok(subjects.includes("docs(feature): create auth"));
    assert.ok(subjects.includes("docs(feature): add auth/login-flow.md"));
    assert.ok(subjects.some((s: string) => s.startsWith("docs(issue): open #")));
    // Another feature's creation is not this feature's history.
    assert.ok(!subjects.includes("docs(feature): create billing-invoices"));
    assert.ok(!subjects.includes("docs: initialize navbook"));

    const one = gathered.commits[0];
    assert.match(one.sha, /^[0-9a-f]{40}$/);
    assert.match(one.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(one.author, /</);
    // Newest first, each named once.
    assert.equal(
      new Set(gathered.commits.map((c: Payload) => c.sha)).size,
      gathered.commits.length,
    );
    for (let i = 1; i < gathered.commits.length; i++) {
      assert.ok(gathered.commits[i - 1].date >= gathered.commits[i].date);
    }
  });

  it("picks up a commit that only touches code, through the trailer it carries", async () => {
    const opened = ok<Payload>(
      await h.gql(OPEN_ISSUE, {
        input: { title: "Raise the timeout", body: "Body.", features: ["auth"] },
      }),
    ).openIssue;

    // A peer at a terminal fixes it and pushes, naming the issue in a trailer.
    const peer = h.fixture.peer;
    peer.git(["pull", "--quiet", "--ff-only"]);
    peer.write("login.c", "int main(void) { return 0; }\n");
    peer.commitAll(`fix: raise the load-balancer timeout\n\nCloses: ${opened.issue.id}\n`);
    peer.git(["push", "--quiet"]);

    const subjects = (await feature("auth")).commits.map((c: Payload) => c.subject);
    assert.ok(subjects.includes("fix: raise the load-balancer timeout"));
  });

  it("honours the commit limit", async () => {
    const limited = ok<Payload>(
      await h.gql(`query { feature(slug: "auth") { commits(limit: 2) { sha } } }`),
    ).feature;
    assert.equal(limited.commits.length, 2);
  });

  it("leaves a clean tree that doctor is happy with", async () => {
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout.trim(), "");
    const report = ok<Payload>(await h.gql(`query { doctor { diagnostics { check path } } }`));
    assert.deepEqual(report.doctor.diagnostics, []);
  });
});
