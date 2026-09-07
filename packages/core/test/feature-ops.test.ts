/**
 * Feature operations against a real repository.
 *
 * The commit listing is the reason this needs git rather than a `NavTree`: what
 * counts as touching a feature is partly a question about history, and the only
 * honest way to test that is to make some.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { newFeatureFile, newIssueFile, newSpecFile } from "../src/core/files.ts";
import { git } from "../src/git/exec.ts";
import { hashObject } from "../src/git/index-ops.ts";
import {
  addSpec,
  applyFeatureEdit,
  createFeature,
  editFeature,
  editSpec,
  featureCommits,
  featureMembers,
  findFeature,
  initWorkspace,
  listFeatures,
  openIssue,
  prepareOpen,
  referencedFeatures,
  resolveFeatureForEdit,
  revalidateFeatureFile,
  runDoctor,
} from "../src/ops/index.ts";
import {
  currentAuthor,
  loadRepo,
  makeWsCtx,
  type WorkspaceError,
  type WsCtx,
} from "../src/workspace/index.ts";

const IDENTITY = { name: "Nav Test", email: "nav@test.invalid" };
const NOW = "2026-09-01T10:00:00Z";

function inWorkspace(use: (ws: WsCtx, dir: string) => void, ids?: string): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-feature-"));
  try {
    git(["init", "--quiet", "-b", "main"], { cwd: dir });
    git(["config", "user.name", IDENTITY.name], { cwd: dir });
    git(["config", "user.email", IDENTITY.email], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });
    const env: NodeJS.ProcessEnv = { NAV_NOW: NOW, ...(ids ? { NAV_IDS: ids } : {}) };
    initWorkspace(makeWsCtx({ cwd: dir, env }), { commit: true });
    use(makeWsCtx({ cwd: dir, env }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function featureText(ws: WsCtx, title: string, body?: string): string {
  return newFeatureFile({ title, author: currentAuthor(ws), created: NOW, body });
}

const create = (ws: WsCtx, title: string, slug?: string) =>
  createFeature(
    ws,
    { content: featureText(ws, title), ...(slug ? { slug } : {}), fallbackTitle: title },
    { commit: true },
  );

const fileIssue = (ws: WsCtx, title: string, features?: string[]) =>
  openIssue(
    ws,
    {
      content: newIssueFile({
        title,
        author: currentAuthor(ws),
        created: prepareOpen(ws).created,
        body: "Body.",
        ...(features ? { features } : {}),
      }),
      fallbackTitle: title,
    },
    { commit: true },
  );

const subjects = (dir: string): string[] =>
  git(["log", "--format=%s"], { cwd: dir }).trim().split("\n");

describe("creating a feature", () => {
  it("brings specs/ with it rather than needing it in advance", () => {
    inWorkspace((ws, dir) => {
      const created = create(ws, "Authentication");
      assert.equal(created.slug, "authentication");
      assert.equal(created.dirPath, "specs/authentication");
      assert.equal(created.run.committed, true);
      assert.equal(created.run.subject, "docs(feature): create authentication");
      assert.match(
        readFileSync(join(dir, ".navbook/specs/authentication/feature.md"), "utf8"),
        /^title: Authentication$/m,
      );
      assert.equal(subjects(dir)[0], "docs(feature): create authentication");
    });
  });

  it("takes a slug of its own when the title makes a poor one", () => {
    inWorkspace((ws) => {
      assert.equal(create(ws, "Authentication & Sessions", "auth").slug, "auth");
    });
  });

  it("refuses a slug that already names a feature", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      assert.throws(
        () => create(ws, "Another", "auth"),
        (error: WorkspaceError) => error.code === "already-exists",
      );
    });
  });

  it("refuses a slug no directory could be named after", () => {
    inWorkspace((ws) => {
      assert.throws(
        () => create(ws, "Authentication", "Auth!"),
        (error: WorkspaceError) => error.code === "invalid-input",
      );
    });
  });

  it("leaves a clean tree that doctor is happy with", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      addSpec(
        ws,
        "auth",
        {
          content: newSpecFile({ title: "Login flow", body: "## Requirements" }),
          fileName: "login-flow.md",
        },
        { commit: true },
      );
      assert.equal(git(["status", "--porcelain"], { cwd: dir }).trim(), "");
      assert.deepEqual(runDoctor(ws, {}).diagnostics, []);
    });
  });
});

describe("adding and editing documents", () => {
  it("adds a document under the name the title gives it", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      const added = addSpec(
        ws,
        "auth",
        {
          content: newSpecFile({ title: "Login flow", body: "## Requirements" }),
          fileName: "login-flow.md",
        },
        { commit: true },
      );
      assert.equal(added.path, "specs/auth/login-flow.md");
      assert.equal(added.run.subject, "docs(feature): add auth/login-flow.md");
      assert.equal(findFeature(ws, "auth").specs.length, 1);
      assert.equal(subjects(dir)[0], "docs(feature): add auth/login-flow.md");
    });
  });

  it("refuses a name a tool must not create", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      for (const fileName of ["feature.md", "../escape.md", "Login Flow.md", "notes.txt"]) {
        assert.throws(
          () =>
            addSpec(
              ws,
              "auth",
              { content: newSpecFile({ title: "X", body: "Body." }), fileName },
              { commit: true },
            ),
          (error: WorkspaceError) => error.code === "invalid-input",
          fileName,
        );
      }
    });
  });

  it("refuses a document the feature already has", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      const input = {
        content: newSpecFile({ title: "Login flow", body: "Body." }),
        fileName: "login-flow.md",
      };
      addSpec(ws, "auth", input, { commit: true });
      assert.throws(
        () => addSpec(ws, "auth", input, { commit: true }),
        (error: WorkspaceError) => error.code === "already-exists",
      );
    });
  });

  it("edits a document, and the identity card", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      addSpec(
        ws,
        "auth",
        {
          content: newSpecFile({ title: "Login flow", body: "First." }),
          fileName: "login-flow.md",
        },
        { commit: true },
      );

      const edited = editSpec(
        ws,
        "auth",
        "login-flow.md",
        newSpecFile({ title: "Login flow", body: "Second." }),
        { commit: true },
      );
      assert.equal(edited.run.subject, "docs(feature): edit auth/login-flow.md");
      assert.match(
        readFileSync(join(dir, ".navbook/specs/auth/login-flow.md"), "utf8"),
        /Second\./,
      );

      const card = editFeature(
        ws,
        "auth",
        featureText(ws, "Authentication", "Now with a summary."),
        {
          commit: true,
        },
      );
      assert.equal(card.run.subject, "docs(feature): edit auth");
      assert.equal(findFeature(ws, "auth").body.trim(), "Now with a summary.");
    });
  });

  it("says which feature and which document it cannot find", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      assert.throws(
        () => findFeature(ws, "billing"),
        (error: WorkspaceError) => error.code === "not-found",
      );
      assert.throws(
        () => editSpec(ws, "auth", "nope.md", "x", { commit: true }),
        (error: WorkspaceError) => error.code === "not-found",
      );
      assert.throws(
        () => findFeature(ws, "Auth!"),
        (error: WorkspaceError) => error.code === "invalid-input",
      );
    });
  });
});

describe("refusing a write that would overwrite somebody else's", () => {
  it("takes the hash the editor started from and refuses a later one", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      addSpec(
        ws,
        "auth",
        {
          content: newSpecFile({ title: "Login flow", body: "First." }),
          fileName: "login-flow.md",
        },
        { commit: true },
      );
      const path = join(dir, ".navbook/specs/auth/login-flow.md");
      const stale = hashObject(dir, path) as string;

      // Somebody else writes, as a peer's push would once it was merged in.
      editSpec(ws, "auth", "login-flow.md", newSpecFile({ title: "Login flow", body: "Theirs." }), {
        commit: true,
      });

      assert.throws(
        () =>
          editSpec(
            ws,
            "auth",
            "login-flow.md",
            newSpecFile({ title: "Login flow", body: "Mine." }),
            { commit: true, baseSha: stale },
          ),
        (error: WorkspaceError) => error.code === "stale-content",
      );
      // Refused before anything was written: their work is still there.
      assert.match(readFileSync(path, "utf8"), /Theirs\./);

      // With the hash it actually has, the same write goes through.
      const fresh = hashObject(dir, path) as string;
      editSpec(ws, "auth", "login-flow.md", newSpecFile({ title: "Login flow", body: "Mine." }), {
        commit: true,
        baseSha: fresh,
      });
      assert.match(readFileSync(path, "utf8"), /Mine\./);
    });
  });

  it("guards the identity card the same way", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      const stale = hashObject(dir, join(dir, ".navbook/specs/auth/feature.md")) as string;
      editFeature(ws, "auth", featureText(ws, "Authentication", "Theirs."), { commit: true });
      assert.throws(
        () =>
          editFeature(ws, "auth", featureText(ws, "Authentication", "Mine."), {
            commit: true,
            baseSha: stale,
          }),
        (error: WorkspaceError) => error.code === "stale-content",
      );
    });
  });
});

describe("editing a file in place", () => {
  it("records what an editor left behind", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      addSpec(
        ws,
        "auth",
        {
          content: newSpecFile({ title: "Login flow", body: "First." }),
          fileName: "login-flow.md",
        },
        { commit: true },
      );

      const target = resolveFeatureForEdit(ws, "auth", "login-flow.md");
      assert.equal(target.filePath, "specs/auth/login-flow.md");
      writeFileSync(target.path, newSpecFile({ title: "Login flow", body: "Edited by hand." }));
      assert.deepEqual(revalidateFeatureFile(target.path, true), []);
      const run = applyFeatureEdit(ws, target, { commit: true });
      assert.equal(run.subject, "docs(feature): edit auth/login-flow.md");
      assert.equal(subjects(dir)[0], "docs(feature): edit auth/login-flow.md");

      const card = resolveFeatureForEdit(ws, "auth");
      assert.equal(card.filePath, "specs/auth/feature.md");
      assert.equal(card.spec, undefined);
    });
  });

  it("reports what an edited file gets wrong", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      const target = resolveFeatureForEdit(ws, "auth");
      writeFileSync(
        target.path,
        "---\nauthor: a@b.invalid\ncreated: 2026-09-01T10:00:00Z\n---\n\nX\n",
      );
      assert.deepEqual(revalidateFeatureFile(target.path, false), ["missing required key 'title'"]);
      writeFileSync(target.path, "no frontmatter at all\n");
      assert.equal(revalidateFeatureFile(target.path, false).length, 1);
      writeFileSync(target.path, featureText(ws, "Authentication"));
      assert.equal(dir.length > 0, true);
    });
  });
});

describe("what belongs to a feature", () => {
  it("lists the issues that name it, and only those", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      create(ws, "Billing", "billing");
      const one = fileIssue(ws, "Add TOTP", ["auth"]);
      const both = fileIssue(ws, "Bill by seat", ["auth", "billing"]);
      fileIssue(ws, "Unrelated");

      const repo = loadRepo(ws, { comments: "none" });
      assert.deepEqual(
        featureMembers(repo, "auth")
          .issues.map((i) => i.id)
          .sort(),
        [both.id, one.id].sort(),
      );
      assert.deepEqual(
        featureMembers(repo, "billing").issues.map((i) => i.id),
        [both.id],
      );
      assert.deepEqual(featureMembers(repo, "nothing").issues, []);
      assert.deepEqual(featureMembers(repo, "auth").prs, []);
    });
  });

  it("names every feature anybody mentions, existing or not", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      fileIssue(ws, "Add TOTP", ["auth", "bilng"]);
      assert.deepEqual(referencedFeatures(loadRepo(ws, { comments: "none" })), ["auth", "bilng"]);
    });
  });

  it("lists features in slug order", () => {
    inWorkspace((ws) => {
      create(ws, "Zed", "zed");
      create(ws, "Authentication", "auth");
      assert.deepEqual(
        listFeatures(ws).map((f) => f.slug),
        ["auth", "zed"],
      );
    });
  });
});

describe("the commits that touched a feature", () => {
  it("gathers spec commits, member commits and messages that name a member", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      const issue = fileIssue(ws, "Add TOTP", ["auth"]);
      const stranger = fileIssue(ws, "Unrelated");
      addSpec(
        ws,
        "auth",
        { content: newSpecFile({ title: "Login flow", body: "Body." }), fileName: "login-flow.md" },
        { commit: true },
      );

      // A code commit that never touches `.navbook/`, joined by its trailer.
      writeFileSync(join(dir, "login.c"), "int main(void) { return 0; }\n");
      git(["add", "login.c"], { cwd: dir });
      git(["commit", "--quiet", "-m", `fix: raise the timeout\n\nCloses: ${issue.id}\n`], {
        cwd: dir,
      });

      // A code commit for the issue that does not belong to the feature.
      writeFileSync(join(dir, "other.c"), "void other(void) {}\n");
      git(["add", "other.c"], { cwd: dir });
      git(["commit", "--quiet", "-m", `fix: something else\n\nCloses: ${stranger.id}\n`], {
        cwd: dir,
      });

      const repo = loadRepo(ws, { comments: "none" });
      const feature = findFeature(ws, "auth");
      const found = featureCommits(ws, feature, featureMembers(repo, "auth"));
      const found_subjects = found.map((c) => c.subject);

      assert.ok(found_subjects.includes("docs(feature): create auth"));
      assert.ok(found_subjects.includes("docs(feature): add auth/login-flow.md"));
      assert.ok(found_subjects.includes(`docs(issue): open #${issue.id}`));
      assert.ok(found_subjects.includes("fix: raise the timeout"));
      assert.ok(!found_subjects.includes("fix: something else"));
      assert.ok(!found_subjects.includes(`docs(issue): open #${stranger.id}`));
      assert.ok(!found_subjects.includes("docs: initialize navbook"));

      // Newest first, and every commit named once however many ways it counted.
      assert.deepEqual([...new Set(found.map((c) => c.sha))].length, found.length);
      for (let i = 1; i < found.length; i++) {
        assert.ok((found[i - 1] as { date: Date }).date >= (found[i] as { date: Date }).date);
      }
      const one = found[0] as { author: string; message: string };
      assert.equal(one.author, `${IDENTITY.name} <${IDENTITY.email}>`);
      assert.equal(typeof one.message, "string");
    });
  });

  it("does not mistake a longer id, or one buried in a word, for a reference", () => {
    inWorkspace((ws, dir) => {
      create(ws, "Authentication", "auth");
      const issue = fileIssue(ws, "Add TOTP", ["auth"]);

      writeFileSync(join(dir, "a.txt"), "a\n");
      git(["add", "a.txt"], { cwd: dir });
      git(["commit", "--quiet", "-m", `chore: mentions ${issue.id}x and x${issue.id}`], {
        cwd: dir,
      });

      const repo = loadRepo(ws, { comments: "none" });
      const found = featureCommits(ws, findFeature(ws, "auth"), featureMembers(repo, "auth"));
      assert.ok(!found.map((c) => c.subject).some((s) => s.startsWith("chore: mentions")));
    });
  });

  it("keeps git's order for commits made in the same second", () => {
    inWorkspace((ws, dir) => {
      // Every commit here shares one author date, so a sort on the timestamp
      // alone could put them in any order. git's walk knows which came second.
      create(ws, "Authentication", "auth");
      addSpec(
        ws,
        "auth",
        { content: newSpecFile({ title: "One", body: "Body." }), fileName: "one.md" },
        { commit: true },
      );
      addSpec(
        ws,
        "auth",
        { content: newSpecFile({ title: "Two", body: "Body." }), fileName: "two.md" },
        { commit: true },
      );

      const repo = loadRepo(ws, { comments: "none" });
      const found = featureCommits(ws, findFeature(ws, "auth"), featureMembers(repo, "auth"));
      assert.deepEqual(
        found.map((commit) => commit.subject),
        git(["log", "--format=%s"], { cwd: dir }).trim().split("\n").slice(0, found.length),
      );
      assert.deepEqual(
        found.map((commit) => commit.subject),
        [
          "docs(feature): add auth/two.md",
          "docs(feature): add auth/one.md",
          "docs(feature): create auth",
        ],
      );
    });
  });

  it("honours the limit, and finds the feature's own commits with no members at all", () => {
    inWorkspace((ws) => {
      create(ws, "Authentication", "auth");
      for (const title of ["One", "Two", "Three"]) {
        addSpec(
          ws,
          "auth",
          { content: newSpecFile({ title, body: "Body." }), fileName: `${title.toLowerCase()}.md` },
          { commit: true },
        );
      }
      const repo = loadRepo(ws, { comments: "none" });
      const members = featureMembers(repo, "auth");
      const feature = findFeature(ws, "auth");
      assert.equal(featureCommits(ws, feature, members).length, 4);
      assert.equal(featureCommits(ws, feature, members, { limit: 2 }).length, 2);
      assert.deepEqual(featureCommits(ws, feature, members, { limit: 0 }), []);
    });
  });
});
