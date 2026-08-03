/**
 * The operation layer, driven directly.
 *
 * Every assertion here is made without spawning the CLI: these are the calls a
 * second front end (spec 06 §6.3) makes, so exercising them in process is what
 * proves the layer is genuinely free of one.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { newCommentFile, newIssueFile } from "../src/core/files.ts";
import { git } from "../src/git/exec.ts";
import {
  applyComment,
  closeEntity,
  executeEntityDelete,
  findEntity,
  initWorkspace,
  listEntities,
  mintIds,
  openIssue,
  parseListQuery,
  planEntityDelete,
  prepareOpen,
  reopenEntity,
  runDoctor,
} from "../src/ops/index.ts";
import { currentAuthor, makeWsCtx, WorkspaceError, type WsCtx } from "../src/workspace/index.ts";

const IDENTITY = { name: "Nav Test", email: "nav@test.invalid" };
const NOW = "2026-08-04T16:40:00Z";

/** A throwaway repository with `.navbook/` already initialised. */
function inWorkspace(use: (ws: WsCtx, dir: string) => void, ids?: string): void {
  const dir = mkdtempSync(join(tmpdir(), "navbook-ops-"));
  try {
    git(["init", "--quiet", "-b", "main"], { cwd: dir });
    git(["config", "user.name", IDENTITY.name], { cwd: dir });
    git(["config", "user.email", IDENTITY.email], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });

    const env: NodeJS.ProcessEnv = { NAV_NOW: NOW, ...(ids ? { NAV_IDS: ids } : {}) };
    initWorkspace(makeWsCtx({ cwd: dir, env }), { commit: true });
    // Discovery ran before `.navbook/` existed, so take a fresh context.
    use(makeWsCtx({ cwd: dir, env }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The complete text of a new issue file, as a front end would compose it. */
function issueText(ws: WsCtx, title: string, body: string): string {
  const { created } = prepareOpen(ws);
  return newIssueFile({ title, author: currentAuthor(ws), created, body });
}

describe("ops: opening and listing", () => {
  it("files an issue and finds it again", () => {
    inWorkspace((ws) => {
      const opened = openIssue(
        ws,
        { content: issueText(ws, "Something is broken", "It broke."), fallbackTitle: "unused" },
        { commit: true },
      );
      assert.equal(opened.id, "aaa11111");
      assert.equal(opened.dirPath, "issues/open/aaa11111-something-is-broken");
      assert.equal(opened.run.committed, true);

      const found = findEntity(ws, "issue", "aaa1");
      assert.equal(found.title, "Something is broken");
      assert.equal(found.status, "open");
      assert.equal(found.fm.author, `${IDENTITY.name} <${IDENTITY.email}>`);
    }, "aaa11111");
  });

  it("takes the title from the composed file, not the fallback", () => {
    inWorkspace((ws) => {
      const opened = openIssue(
        ws,
        { content: issueText(ws, "Real title", "Body."), fallbackTitle: "Ignored" },
        {},
      );
      assert.equal(opened.dirPath, "issues/open/aaa11111-real-title");
    }, "aaa11111");
  });

  it("lists what matches a query, newest first", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "First", "One."), fallbackTitle: "First" }, {});
      openIssue(ws, { content: issueText(ws, "Second", "Two."), fallbackTitle: "Second" }, {});

      const open = listEntities(ws, "issue", parseListQuery([], "issue"));
      assert.deepEqual(
        open.map((entity) => entity.title).sort(),
        ["First", "Second"],
        "the default query is status:open",
      );

      const matched = listEntities(ws, "issue", parseListQuery(["second"], "issue"));
      assert.deepEqual(
        matched.map((entity) => entity.title),
        ["Second"],
      );
    }, "aaa11111,bbb22222");
  });

  it("reports a malformed query as an input error", () => {
    assert.throws(
      () => parseListQuery(["status:nonsense"], "issue"),
      (error: unknown) => error instanceof WorkspaceError && error.code === "invalid-input",
    );
  });

  it("refuses to open an entity outside a Navbook repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-bare-"));
    try {
      git(["init", "--quiet", "-b", "main"], { cwd: dir });
      const ws = makeWsCtx({ cwd: dir, env: {} });
      assert.throws(
        () => prepareOpen(ws),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-a-navbook-repo",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ops: commenting", () => {
  it("adds a comment and files it under the entity", () => {
    inWorkspace((ws, dir) => {
      openIssue(ws, { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" }, {});
      const entity = findEntity(ws, "issue", "aaa11111");

      const added = applyComment(
        ws,
        entity,
        { content: newCommentFile({ author: "bob@example.com", body: "Looking at it." }) },
        {},
      );
      assert.equal(added.id, "bbb22222");
      assert.match(added.path, /^issues\/open\/aaa11111-broken\/comments\/.*-bbb22222\.md$/);
      assert.match(readFileSync(join(dir, ".navbook", added.path), "utf8"), /Looking at it\./);
    }, "aaa11111,bbb22222");
  });
});

describe("ops: closing and reopening", () => {
  it("moves an entity to closed/ and back", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" }, {});

      const closed = closeEntity(ws, "issue", "aaa1", { resolution: "fixed" }, {});
      assert.equal(closed.destination, "issues/closed/aaa11111-broken");
      assert.equal(findEntity(ws, "issue", "aaa1").status, "closed");

      const reopened = reopenEntity(ws, "issue", "aaa1", {});
      assert.equal(reopened.destination, "issues/open/aaa11111-broken");
      assert.equal(findEntity(ws, "issue", "aaa1").status, "open");
    }, "aaa11111");
  });

  it("refuses to close something already closed", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" }, {});
      closeEntity(ws, "issue", "aaa1", {}, {});
      assert.throws(
        () => closeEntity(ws, "issue", "aaa1", {}, {}),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    }, "aaa11111");
  });

  it("refuses to mark an entity a duplicate of itself", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" }, {});
      assert.throws(
        () => closeEntity(ws, "issue", "aaa1", { duplicateOf: "aaa11111" }, {}),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    }, "aaa11111");
  });

  it("reports an unresolvable reference", () => {
    inWorkspace((ws) => {
      assert.throws(
        () => findEntity(ws, "issue", "zzzz9999"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-found",
      );
      assert.throws(
        () => findEntity(ws, "issue", "zz"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "prefix-too-short",
      );
    });
  });
});

describe("ops: deleting", () => {
  it("describes what would be lost before anything is removed", () => {
    inWorkspace((ws, dir) => {
      openIssue(
        ws,
        { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" },
        { commit: true },
      );

      const planned = planEntityDelete(ws, "issue", "aaa1", {});
      assert.equal(planned.entity.id, "aaa11111");
      assert.deepEqual(planned.uncommitted, [], "everything is in git, so nothing would be lost");
      assert.ok(
        existsSync(join(dir, ".navbook", planned.entity.dirPath)),
        "planning must not touch the tree",
      );

      executeEntityDelete(ws, planned, {});
      assert.ok(!existsSync(join(dir, ".navbook", planned.entity.dirPath)));
    }, "aaa11111");
  });

  it("names uncommitted content that deleting would destroy", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" }, {});
      const planned = planEntityDelete(ws, "issue", "aaa1", {});
      assert.ok(planned.uncommitted.length > 0, "the issue was never committed");
    }, "aaa11111");
  });
});

describe("ops: doctor and ids", () => {
  it("finds no format violations in a tree it built itself", () => {
    inWorkspace((ws) => {
      openIssue(
        ws,
        { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" },
        { commit: true },
      );
      const { diagnostics } = runDoctor(ws);
      assert.deepEqual(
        diagnostics.filter((d) => d.level === "error"),
        [],
      );
    }, "aaa11111");
  });

  it("mints the requested number of distinct ids", () => {
    inWorkspace((ws) => {
      const ids = mintIds(ws, 3);
      assert.equal(ids.length, 3);
      assert.equal(new Set(ids).size, 3);
      for (const id of ids) assert.match(id, /^[a-z][a-z0-9]{7}$/);
    });
  });

  it("rejects a nonsensical count", () => {
    inWorkspace((ws) => {
      assert.throws(
        () => mintIds(ws, 0),
        (error: unknown) => error instanceof WorkspaceError && error.code === "invalid-input",
      );
    });
  });
});
