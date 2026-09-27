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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blobSha } from "@navbook/core";
import {
  errorCode,
  type Harness,
  ok,
  originSubjects,
  startHarness,
} from "@navbook/server/test-helpers";

/** This package, as `NAVBOOK_PLUGIN_PATH` names it. */
const ENV = {
  NAVBOOK_PLUGIN_PATH: join(dirname(fileURLToPath(import.meta.url)), ".."),
};

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
    h = await startHarness({ env: ENV });
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

    // The same value again, under `ext.kb`, which is what the host's own
    // list-row fragment selects. A plugin's SDL extends a type but nothing
    // extends a fragment, so this is the only way a feature chip is drawn on a
    // row the host fetched (spec 02 §2.12).
    const listed = ok<{ issues: { id: string; ext: { kb?: { features: string[] } } }[] }>(
      await h.gql(`query { issues { id ext } }`),
    ).issues;
    assert.deepEqual(listed.find((issue) => issue.id === one.issue.id)?.ext.kb, {
      features: ["auth"],
    });

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

  it("honours the commit limit, nought included", async () => {
    const limited = ok<Payload>(
      await h.gql(`query { feature(slug: "auth") { commits(limit: 2) { sha } } }`),
    ).feature;
    assert.equal(limited.commits.length, 2);

    const none = ok<Payload>(
      await h.gql(`query { feature(slug: "auth") { commits(limit: 0) { sha } } }`),
    ).feature;
    assert.deepEqual(none.commits, []);
  });

  it("reports the hash each write in one request actually left behind", async () => {
    // GraphQL runs a document's mutations serially and completes each payload
    // before the next begins, so a hash worked out for the first write is
    // already in hand when the second reports. A client that saved with a
    // stale one would be refused on its next save, which is why every write
    // reads its feature back and every record is hashed on its own.
    const before = await feature("auth");
    const spec = before.specs.find((s: Payload) => s.fileName === "login-flow.md");

    const both = ok<Payload>(
      await h.gql(
        `mutation Two($add: AddSpecInput!, $edit: UpdateSpecInput!) {
          added: addSpec(input: $add) { spec { fileName baseSha } }
          edited: updateSpec(input: $edit) { spec { fileName baseSha } }
        }`,
        {
          add: { feature: "auth", title: "Token rotation", body: "Body." },
          edit: {
            feature: "auth",
            fileName: "login-flow.md",
            body: "Edited beside another write.",
            baseSha: spec.baseSha,
          },
        },
      ),
    );

    const now = await feature("auth");
    const byName = new Map(now.specs.map((s: Payload) => [s.fileName, s.baseSha]));
    assert.equal(both.added.spec.baseSha, byName.get("token-rotation.md"));
    assert.equal(both.edited.spec.baseSha, byName.get("login-flow.md"));

    // And the hash it reported is one a further save is accepted with.
    ok<Payload>(
      await h.gql(UPDATE_SPEC, {
        input: {
          feature: "auth",
          fileName: "login-flow.md",
          body: "Saved with the hash the last payload gave.",
          baseSha: both.edited.spec.baseSha,
        },
      }),
    );
  });

  it("leaves a clean tree that doctor is happy with", async () => {
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout.trim(), "");
    const report = ok<Payload>(await h.gql(`query { doctor { diagnostics { check path } } }`));
    assert.deepEqual(report.doctor.diagnostics, []);
  });
});

/**
 * A document written by hand, under a name no tool would have chosen.
 *
 * Spec 02 §2.11 makes reading deliberately more generous than writing: a
 * `Session Policy.md` committed from an editor is conforming and must keep
 * working, even though `addSpec` would refuse to create it. That asymmetry is
 * only safe because nothing joins a name onto a path — the name is looked up
 * among the documents already parsed — so this is where that is proved.
 */
describe("a document a tool would not have created", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({
      env: ENV,
      // Written from the clone that stands in for somebody at a terminal, which
      // is how a document with a name like this comes to exist at all.
      prepare: (fixture) => {
        fixture.peer.write(
          ".navbook/specs/auth/feature.md",
          "---\ntitle: Authentication\nauthor: alice@example.invalid\ncreated: 2026-09-01T10:00:00Z\n---\n\nSigning in.\n",
        );
        fixture.peer.write(
          ".navbook/specs/auth/Session Policy.md",
          "---\ntitle: Session policy\nsome-tool-state: {phase: draft}\n---\n\nThirty days.\n",
        );
        fixture.peer.commitAll("docs(feature): hand-write a feature");
        fixture.peer.git(["push", "--quiet"]);
      },
    });
  });
  after(async () => {
    await h.stop();
  });

  it("reads it, hashes it, and lets it be edited", async () => {
    const found = ok<Payload>(
      await h.gql(`query { feature(slug: "auth") {
        specs { fileName title path body baseSha } } }`),
    ).feature;

    const spec = found.specs[0];
    assert.equal(spec.fileName, "Session Policy.md");
    assert.equal(spec.title, "Session policy");
    assert.equal(spec.path, ".navbook/specs/auth/Session Policy.md");
    // A hash for every document, whatever it is called: an empty one would be
    // read as "changed" and would make the document impossible to save.
    assert.match(spec.baseSha, /^[0-9a-f]{40}$/);

    const saved = ok<Payload>(
      await h.gql(UPDATE_SPEC, {
        input: {
          feature: "auth",
          fileName: "Session Policy.md",
          body: "Sixty days.",
          baseSha: spec.baseSha,
        },
      }),
    ).updateSpec;
    assert.match(saved.spec.body, /Sixty days\./);
    assert.equal(saved.commit.subject, "docs(feature): edit auth/Session Policy.md");
    assert.match(
      readFileSync(join(h.fixture.server.dir, ".navbook/specs/auth/Session Policy.md"), "utf8"),
      /^some-tool-state:/m,
    );
  });

  it("still refuses to create one under that name", async () => {
    assert.equal(
      errorCode(
        await h.gql(ADD_SPEC, {
          input: {
            feature: "auth",
            title: "X",
            body: "Body.",
            fileName: "Another Policy.md",
          },
        }),
      ),
      "INVALID_INPUT",
    );
  });
});

describe("baseSha under a clean filter", () => {
  let h: Harness;

  before(async () => {
    h = await startHarness({ env: ENV });
    // A clean filter makes git's hash of a file differ from a hash of its
    // text, and it is repository configuration: nothing a CLI checkout is
    // guaranteed not to have. Scoped to these tests' own files.
    const clone = h.fixture.server;
    clone.git(["config", "filter.pad.clean", "cat; echo"]);
    mkdirSync(join(clone.dir, ".git/info"), { recursive: true });
    appendFileSync(join(clone.dir, ".git/info/attributes"), "**/*filtered*/*.md filter=pad\n");
  });
  after(async () => {
    await h.stop();
  });

  const fileOf = (path: string): string => readFileSync(join(h.fixture.server.dir, path), "utf8");

  it("is one token for an issue and a feature, and both round-trip", async () => {
    const created = ok<Payload>(
      await h.gql(CREATE, { input: { title: "Filtered", slug: "filtered" } }),
    ).createFeature.feature;
    const featureFile = `${created.path}/feature.md`;
    const issue = ok<Payload>(
      await h.gql(
        `mutation Open($input: OpenIssueInput!) { openIssue(input: $input) { issue { id path baseSha } } }`,
        { input: { title: "Filtered issue", body: "Body." } },
      ),
    ).openIssue.issue;
    const issueFile = `${issue.path}/issue.md`;

    // git itself names the committed feature file differently from its text,
    // so this test is actually under the configuration it means to be.
    const stored = h.fixture.server.git(["rev-parse", `HEAD:${featureFile}`]).stdout.trim();
    assert.notEqual(stored, blobSha(fileOf(featureFile)));

    // Both halves hash the text they were read from, the same way.
    assert.equal(created.baseSha, blobSha(fileOf(featureFile)));
    assert.equal(issue.baseSha, blobSha(fileOf(issueFile)));

    const feature = ok<Payload>(
      await h.gql(UPDATE_FEATURE, {
        input: { slug: "filtered", summary: "Mine.", baseSha: created.baseSha },
      }),
    ).updateFeature.feature;
    assert.equal(feature.summary, "Mine.");
    assert.equal(feature.baseSha, blobSha(fileOf(featureFile)));

    const retitled = ok<Payload>(
      await h.gql(
        `mutation Update($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { title baseSha } } }`,
        { input: { ref: issue.id, title: "Filtered issue, retitled", baseSha: issue.baseSha } },
      ),
    ).updateIssue.issue;
    assert.equal(retitled.title, "Filtered issue, retitled");
    assert.equal(retitled.baseSha, blobSha(fileOf(issueFile)));
  });

  it("guards a document the same way, and still refuses a stale token", async () => {
    const spec = ok<Payload>(
      await h.gql(ADD_SPEC, {
        input: { feature: "filtered", title: "Filtered flow", body: "First." },
      }),
    ).addSpec.spec;
    assert.equal(spec.baseSha, blobSha(fileOf(spec.path)));

    const edit = (body: string, baseSha: string) =>
      h.gql(UPDATE_SPEC, {
        input: { feature: "filtered", fileName: spec.fileName, body, baseSha },
      });

    const theirs = ok<Payload>(await edit("Theirs.", spec.baseSha)).updateSpec.spec;
    assert.equal(theirs.body, "Theirs.");
    assert.equal(theirs.baseSha, blobSha(fileOf(spec.path)));

    assert.equal(errorCode(await edit("Mine.", spec.baseSha)), "STALE_CONTENT");
    assert.match(fileOf(spec.path), /Theirs\./);
  });
});

/**
 * Features read from the tree the server remembers against HEAD.
 *
 * The plugin reads through the request's tree, which with a pull interval is
 * one parsed at HEAD and kept across requests. The questions are the host's
 * own for entities: nothing may get stuck — not the server's own writes, not
 * a push from elsewhere, not an edit made by hand in the served clone.
 */
describe("features from the remembered tree", () => {
  const INTERVAL_MS = 200;
  let h: Harness;

  const FEATURE = `query Feature($slug: String!) {
    feature(slug: $slug) { slug title issues { id } }
  }`;
  const titleOf = async (slug: string): Promise<string> =>
    ok<Payload>(await h.gql(FEATURE, { slug })).feature.title;
  const slugs = async (): Promise<string[]> =>
    ok<Payload>(await h.gql("{ features { slug } }")).features.map((f: Payload) => f.slug);

  /** Ask until `probe` answers `expected`, for a few pull intervals at most. */
  async function eventually<T>(probe: () => Promise<T>, expected: T): Promise<void> {
    let seen: T | undefined;
    for (let tries = 0; tries < 50; tries++) {
      seen = await probe();
      if (JSON.stringify(seen) === JSON.stringify(expected)) return;
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS / 2));
    }
    assert.deepEqual(seen, expected);
  }

  before(async () => {
    h = await startHarness({ env: ENV, pullIntervalMs: INTERVAL_MS });
  });
  after(async () => {
    await h.stop();
  });

  it("answers the server's own writes on the very next read", async () => {
    ok(await h.gql(CREATE, { input: { title: "Cached", slug: "cached" } }));
    // Read once, so a tree is remembered before the writes below.
    assert.equal(await titleOf("cached"), "Cached");
    assert.ok((await slugs()).includes("cached"));

    const current = ok<Payload>(await h.gql(`{ feature(slug: "cached") { baseSha } }`)).feature;
    const renamed = ok<Payload>(
      await h.gql(UPDATE_FEATURE, {
        input: { slug: "cached", title: "Cached, renamed", baseSha: current.baseSha },
      }),
    ).updateFeature.feature;
    assert.equal(renamed.title, "Cached, renamed");
    assert.equal(await titleOf("cached"), "Cached, renamed");

    // A write elsewhere in the tree reaches a feature's derived fields too.
    const opened = ok<Payload>(
      await h.gql(
        `mutation { openIssue(input: { title: "Attached", body: "b.", features: ["cached"] }) { issue { id } } }`,
      ),
    ).openIssue.issue;
    const feature = ok<Payload>(await h.gql(FEATURE, { slug: "cached" })).feature;
    assert.deepEqual(
      feature.issues.map((issue: Payload) => issue.id),
      [opened.id],
    );
  });

  it("sees a feature pushed from elsewhere once it has been pulled", async () => {
    assert.ok(!(await slugs()).includes("pushed"));
    const peer = h.fixture.peer;
    peer.git(["pull", "--quiet", "--no-rebase", "origin", "main"]);
    peer.write(
      ".navbook/specs/pushed/feature.md",
      "---\ntitle: Pushed\nauthor: peer@example.invalid\ncreated: 2026-09-01T10:00:00Z\n---\n",
    );
    peer.commitAll("docs(feature): create pushed");
    assert.equal(peer.git(["push", "--quiet", "origin", "main:main"]).code, 0);
    await eventually(async () => (await slugs()).includes("pushed"), true);
  });

  it("sees a feature edited by hand in the served clone, and every edit after it", async () => {
    ok(await h.gql(CREATE, { input: { title: "By hand", slug: "by-hand" } }));
    assert.equal(await titleOf("by-hand"), "By hand");
    const file = join(h.fixture.server.dir, ".navbook/specs/by-hand/feature.md");
    const original = readFileSync(file, "utf8");

    writeFileSync(file, original.replace("title: By hand", "title: Edited by hand"));
    await eventually(() => titleOf("by-hand"), "Edited by hand");
    writeFileSync(file, original.replace("title: By hand", "title: Edited again"));
    await eventually(() => titleOf("by-hand"), "Edited again");

    writeFileSync(file, original);
    await eventually(() => titleOf("by-hand"), "By hand");
  });
});

/**
 * A stale edit to an entity's features — the host's per-field guard, for a
 * field a plugin owns.
 *
 * `updateIssue` refuses a field somebody else changed since the client read
 * the file, and lands one nobody touched. `features` is this plugin's field,
 * written through its bridge; it must be guarded exactly as `labels` is, and
 * named as the input names it.
 */
describe("a stale edit to an issue's features", () => {
  let h: Harness;

  const SHOW = `query Show($ref: ID!) { issue(ref: $ref) { id title features baseSha } }`;
  const UPDATE = `mutation Update($input: UpdateIssueInput!) {
    updateIssue(input: $input) { issue { id title features baseSha } }
  }`;

  const open = async (title: string): Promise<Payload> =>
    ok<Payload>(
      await h.gql(
        `mutation Open($input: OpenIssueInput!) { openIssue(input: $input) { issue { id path } } }`,
        { input: { title, body: "Body.", features: ["auth"] } },
      ),
    ).openIssue.issue;
  const show = async (ref: string): Promise<Payload> =>
    ok<Payload>(await h.gql(SHOW, { ref })).issue;
  const update = async (input: Payload): Promise<Payload> =>
    ok<Payload>(await h.gql(UPDATE, { input })).updateIssue.issue;
  const moved = (refused: Payload): unknown => refused.errors[0]?.extensions?.moved;

  before(async () => {
    h = await startHarness({ env: ENV });
    for (const slug of ["auth", "billing", "mobile"]) {
      ok(await h.gql(CREATE, { input: { title: slug, slug } }));
    }
  });
  after(async () => {
    await h.stop();
  });

  it("refuses features changed since the page was rendered, naming them", async () => {
    const issue = await open("Contested");
    const seenByB = await show(issue.id);

    await update({ ref: issue.id, features: ["auth", "billing"] });
    const refused = await h.gql(UPDATE, {
      input: { ref: issue.id, features: ["mobile"], baseSha: seenByB.baseSha },
    });

    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(moved(refused), ["features"]);
    assert.deepEqual((await show(issue.id)).features, ["auth", "billing"]);
    assert.equal(h.fixture.server.git(["status", "--porcelain"]).stdout, "");
  });

  it("lands features nobody else touched, whatever else moved", async () => {
    const issue = await open("Retitled");
    const seenByB = await show(issue.id);

    await update({ ref: issue.id, title: "A's title" });
    const landed = await update({
      ref: issue.id,
      features: ["auth", "mobile"],
      baseSha: seenByB.baseSha,
    });
    assert.equal(landed.title, "A's title");
    assert.deepEqual(landed.features, ["auth", "mobile"]);
  });

  it("names the plugin's field beside the host's, and only the ones that moved", async () => {
    const issue = await open("Several");
    const seen = await show(issue.id);

    await update({ ref: issue.id, title: "Moved", features: ["billing"] });
    const refused = await h.gql(UPDATE, {
      input: {
        ref: issue.id,
        title: "Mine",
        labels: ["x"],
        features: ["mobile"],
        baseSha: seen.baseSha,
      },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(moved(refused), ["title", "features"]);
  });

  it("names the plugin's field when it cannot tell what the client saw", async () => {
    const issue = await open("Unknown base");
    const refused = await h.gql(UPDATE, {
      input: { ref: issue.id, features: ["mobile"], baseSha: "0".repeat(40) },
    });
    assert.equal(errorCode(refused), "STALE_CONTENT");
    assert.deepEqual(moved(refused), ["features"]);
  });
});
