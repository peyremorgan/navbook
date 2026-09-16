/**
 * The operation layer, driven directly.
 *
 * Every assertion here is made without spawning the CLI: these are the calls a
 * second front end (spec 06 §6.3) makes, so exercising them in process is what
 * proves the layer is genuinely free of one.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { newCommentFile, newIssueFile, newPrFile, readRevisions } from "../src/core/files.ts";
import { emptyQuery } from "../src/core/query.ts";
import type { EntityRecord } from "../src/core/tree.ts";
import { git } from "../src/git/exec.ts";
import { resolveSha } from "../src/git/repo.ts";
import {
  applyComment,
  bindReviewRevision,
  closeEntity,
  executeEntityDelete,
  executePrMerge,
  findEntity,
  initWorkspace,
  listEntities,
  listPrsAcrossRefs,
  locatePr,
  materializePrIfAbsent,
  mintIds,
  openIssue,
  openPr,
  parseListQuery,
  planEntityDelete,
  planPrMerge,
  prepareOpen,
  preparePrOpen,
  reopenEntity,
  runDoctor,
  uncommittedUnder,
  updatePr,
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

      const open = listEntities(ws, "issue", parseListQuery(ws, [], "issue"));
      assert.deepEqual(
        open.map((entity) => entity.title).sort(),
        ["First", "Second"],
        "the default query is status:open",
      );

      const matched = listEntities(ws, "issue", parseListQuery(ws, ["second"], "issue"));
      assert.deepEqual(
        matched.map((entity) => entity.title),
        ["Second"],
      );
    }, "aaa11111,bbb22222");
  });

  /**
   * The CLI default and the query language's own semantics part ways here: a
   * `list` command with no status term means open only, while a query naming no
   * status filters by none — which is what the GraphQL API sends (spec 04 §4.3).
   */
  it("applies the CLI's open-only default at parse time, not in the query itself", () => {
    inWorkspace((ws) => {
      openIssue(ws, { content: issueText(ws, "Open one", "One."), fallbackTitle: "Open one" }, {});
      openIssue(ws, { content: issueText(ws, "Shut one", "Two."), fallbackTitle: "Shut one" }, {});
      closeEntity(ws, "issue", "bbb2", { resolution: "fixed" }, {});

      const parsed = parseListQuery(ws, [], "issue");
      assert.deepEqual(parsed.status, ["open"]);
      assert.deepEqual(
        listEntities(ws, "issue", parsed).map((entity) => entity.title),
        ["Open one"],
      );

      const neutral = listEntities(ws, "issue", emptyQuery());
      assert.deepEqual(neutral.map((entity) => entity.title).sort(), ["Open one", "Shut one"]);

      // An explicit status still narrows, in either direction.
      assert.deepEqual(
        listEntities(ws, "issue", parseListQuery(ws, ["status:closed"], "issue")).map(
          (e) => e.title,
        ),
        ["Shut one"],
      );
    }, "aaa11111,bbb22222");
  });

  it("reports a malformed query as an input error", () => {
    inWorkspace((ws) => {
      assert.throws(
        () => parseListQuery(ws, ["status:nonsense"], "issue"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "invalid-input",
      );
    });
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
      assert.deepEqual(
        uncommittedUnder(ws, planned),
        [],
        "everything is in git, so nothing would be lost",
      );
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
      assert.ok(uncommittedUnder(ws, planned).length > 0, "it was never committed");
    }, "aaa11111");
  });

  it("refuses to plan a delete --commit while unrelated work is staged", () => {
    inWorkspace((ws, dir) => {
      openIssue(
        ws,
        { content: issueText(ws, "Broken", "It broke."), fallbackTitle: "Broken" },
        { commit: true },
      );
      writeFileSync(join(dir, "unrelated.txt"), "work in progress\n");
      git(["add", "unrelated.txt"], { cwd: dir });

      assert.throws(
        () => planEntityDelete(ws, "issue", "aaa1", { commit: true }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "unrelated-staged",
      );
      assert.ok(
        existsSync(join(dir, ".navbook/issues/open/aaa11111-broken")),
        "a refusal leaves the tree untouched",
      );
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

/**
 * A repository with a feature branch and an open pull request on it, which is
 * the shape every PR operation expects.
 */
function inPrWorkspace(use: (ws: WsCtx, dir: string) => void, ids = "ppp11111"): void {
  inWorkspace((ws, dir) => {
    writeFileSync(join(dir, "app.txt"), "original\n");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "-qm", "seed"], { cwd: dir });
    git(["checkout", "-qb", "feature"], { cwd: dir });
    writeFileSync(join(dir, "app.txt"), "changed\n");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "-qm", "work"], { cwd: dir });

    const draft = preparePrOpen(ws, { target: "main" });
    openPr(
      ws,
      {
        content: newPrFile({
          title: draft.title,
          author: currentAuthor(ws),
          created: draft.created,
          target: draft.target,
          source: draft.source,
          revisions: [draft.revision],
          body: "Please review.",
        }),
        fallbackTitle: draft.title,
      },
      { commit: true },
    );
    use(ws, dir);
  }, ids);
}

describe("ops: opening a pull request", () => {
  it("reads the branch state git is actually in", () => {
    inPrWorkspace((ws) => {
      const entity = findEntity(ws, "pr", "ppp1");
      assert.equal(entity.fm.target, "main");
      assert.equal(entity.fm.source, "feature");
      assert.equal(entity.status, "open");
      assert.equal(readRevisions(entity.fm).length, 1);
    });
  });

  it("takes the caller's title over the last commit's subject", () => {
    inPrWorkspace((ws, dir) => {
      const subject = git(["log", "-1", "--format=%s"], { cwd: dir }).trim();
      assert.equal(preparePrOpen(ws, { target: "main", title: "Mine" }).title, "Mine");
      assert.equal(preparePrOpen(ws, { target: "main" }).title, subject);
    });
  });

  it("refuses a pull request that targets its own branch", () => {
    inPrWorkspace((ws) => {
      assert.throws(
        () => preparePrOpen(ws, { target: "feature" }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    });
  });
});

describe("ops: binding a review to a revision", () => {
  it("binds to the latest revision when none is named", () => {
    inPrWorkspace((ws) => {
      const entity = findEntity(ws, "pr", "ppp1");
      const latest = readRevisions(entity.fm).at(-1)?.head;
      assert.equal(bindReviewRevision(entity), latest);
      assert.equal(bindReviewRevision(entity, undefined), latest);
      // An empty string names nothing; it is not a prefix every head matches.
      assert.equal(bindReviewRevision(entity, ""), latest);
    });
  });

  it("binds to a named revision by unambiguous prefix", () => {
    inPrWorkspace((ws) => {
      const entity = findEntity(ws, "pr", "ppp1");
      const head = readRevisions(entity.fm)[0]?.head as string;
      assert.equal(bindReviewRevision(entity, head), head);
      assert.equal(bindReviewRevision(entity, head.slice(0, 8)), head);
      assert.equal(bindReviewRevision(entity, head.slice(0, 8).toUpperCase()), head);
    });
  });

  it("reports a revision that was never recorded", () => {
    inPrWorkspace((ws) => {
      assert.throws(
        () => bindReviewRevision(findEntity(ws, "pr", "ppp1"), "deadbeef"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-found",
      );
    });
  });

  it("reports a pull request with nothing to bind to", () => {
    inPrWorkspace((ws, dir) => {
      // A hand-written pull request with no revisions at all (§2.7 allows it).
      const path = ".navbook/prs/open/qqq22222-no-revisions/pr.md";
      mkdirSync(join(dir, ".navbook/prs/open/qqq22222-no-revisions"), { recursive: true });
      writeFileSync(
        join(dir, path),
        "---\ntitle: No revisions\nauthor: nav@test.invalid\n" +
          `created: ${NOW}\ntarget: main\n---\n\nNothing pinned yet.\n`,
      );
      assert.throws(
        () => bindReviewRevision(findEntity(ws, "pr", "qqq2")),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    });
  });
});

describe("ops: updating and merging a pull request", () => {
  it("appends a revision pinning the new head", () => {
    inPrWorkspace((ws, dir) => {
      writeFileSync(join(dir, "app.txt"), "changed again\n");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "-qm", "more work"], { cwd: dir });

      const updated = updatePr(ws, "ppp1", { commit: true });
      assert.equal(updated.revisionCount, 2);
      assert.equal(readRevisions(findEntity(ws, "pr", "ppp1").fm).length, 2);
    });
  });

  it("refuses an update that would pin the same head twice", () => {
    inPrWorkspace((ws) => {
      // The first update pins whatever HEAD is now; a second has nothing new
      // to say, and §2.7 revisions are evidence, not a heartbeat.
      updatePr(ws, "ppp1", {});
      assert.throws(
        () => updatePr(ws, "ppp1", {}),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    });
  });

  it("plans a merge without performing it, then performs it", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });

      const plan = planPrMerge(ws, "ppp1");
      assert.equal(plan.entity.id, "ppp11111");
      assert.equal(plan.targetBranch, "main");
      assert.equal(plan.strategy, "fast-forward");
      assert.match(plan.message, /^Merge #ppp11111: work/);
      assert.equal(
        git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir }).trim(),
        "main",
        "planning must not move HEAD",
      );

      const result = executePrMerge(ws, plan);
      assert.equal(result.mergeSha, null, "a fast-forward creates no merge commit");
      assert.equal(result.dirPath, "prs/merged/ppp11111-work");
      assert.equal(findEntity(ws, "pr", "ppp1").status, "merged");
      // The archive commit is on main alone; the source is brought up to it so
      // the same pull request does not read `open` on one branch and `merged`
      // on the other.
      assert.deepEqual(result.source, { ref: "feature", outcome: "fast-forwarded" });
      assert.equal(branchesApart(dir, "main", "feature"), "0\t0");
      assert.match(
        git(["reflog", "show", "-1", "feature"], { cwd: dir }),
        /nav pr merge #ppp11111: to main/,
        "the move is explained in the branch's reflog",
      );
    });
  });

  it("records a merge commit when a fast-forward is refused", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      const result = executePrMerge(ws, planPrMerge(ws, "ppp1", { noFf: true }));
      assert.match(result.mergeSha ?? "", /^[0-9a-f]{40}$/);
      // The source tip is a parent of the merge commit, so it fast-forwards too.
      assert.equal(result.source.outcome, "fast-forwarded");
      assert.equal(branchesApart(dir, "main", "feature"), "0\t0");
    });
  });

  it("leaves the source branch behind when asked to", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      const result = executePrMerge(ws, planPrMerge(ws, "ppp1", { syncSource: false }));
      assert.deepEqual(result.source, { ref: "feature", outcome: "disabled" });
      assert.equal(branchesApart(dir, "main", "feature"), "1\t0");
    });
  });

  it("does not move a source branch another worktree is standing on", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      const elsewhere = mkdtempSync(join(tmpdir(), "nav-wt-"));
      rmSync(elsewhere, { recursive: true });
      git(["worktree", "add", "-q", elsewhere, "feature"], { cwd: dir });
      try {
        const result = executePrMerge(ws, planPrMerge(ws, "ppp1"));
        assert.equal(result.source.outcome, "checked-out");
        assert.equal(
          realpathSync(result.source.worktree ?? ""),
          realpathSync(elsewhere),
          "the caller is told where the branch is checked out",
        );
        // Moving the ref under a checked-out tree would strand its index and
        // files behind its own HEAD, so it is left exactly where it was.
        assert.equal(branchesApart(dir, "main", "feature"), "1\t0");
        assert.equal(git(["status", "--porcelain"], { cwd: elsewhere }).trim(), "");
      } finally {
        git(["worktree", "remove", "--force", elsewhere], { cwd: dir });
      }
    });
  });

  it("does not move a source that is only a remote-tracking ref", () => {
    inPrWorkspace((ws, dir) => {
      // Turn the local branch into what a fetch would have left: the same
      // commits under refs/remotes/, and nothing under refs/heads/.
      const tip = git(["rev-parse", "feature"], { cwd: dir }).trim();
      git(["checkout", "-q", "main"], { cwd: dir });
      git(["branch", "-D", "feature"], { cwd: dir });
      git(["update-ref", "refs/remotes/origin/feature", tip], { cwd: dir });

      const plan = planPrMerge(ws, "ppp1");
      assert.equal(plan.sourceRef, "origin/feature");
      const result = executePrMerge(ws, plan);
      assert.deepEqual(result.source, { ref: "origin/feature", outcome: "not-local" });
      assert.equal(git(["rev-parse", "refs/remotes/origin/feature"], { cwd: dir }).trim(), tip);
      assert.equal(resolveSha(dir, "refs/heads/origin/feature"), null, "nothing was created");
    });
  });

  it("refuses to merge from a branch that is not the target", () => {
    inPrWorkspace((ws) => {
      // Still on `feature`, which is what the pull request comes *from*.
      assert.throws(
        () => planPrMerge(ws, "ppp1"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "precondition",
      );
    });
  });

  it("finds a pull request across refs, and reports one that is nowhere", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      const found = listPrsAcrossRefs(ws, parseListQuery(ws, [], "pr"));
      assert.deepEqual(
        found.map((entry) => entry.entity.id),
        ["ppp11111"],
        "open PRs live on their source branch, not the target",
      );
      assert.equal(locatePr(ws, "ppp1").sourceRef, "feature");
      assert.throws(
        () => locatePr(ws, "zzzz9999"),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-found",
      );
    });
  });

  it("brings a pull request onto the target branch so it can be declined", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      assert.equal(findEntityOrNull(ws, "ppp1"), null, "not on this branch yet");

      const materialized = materializePrIfAbsent(ws, "ppp1");
      assert.deepEqual(materialized, { id: "ppp11111", ref: "feature" });
      assert.equal(
        closeEntity(ws, "pr", "ppp1", { resolution: "wontfix" }, {}).entity.id,
        "ppp11111",
      );
      assert.equal(findEntity(ws, "pr", "ppp1").status, "closed");

      assert.equal(materializePrIfAbsent(ws, "ppp1"), null, "already here, nothing to do");
    });
  });

  /** Pull requests follow the same rule issues do; the kind changes nothing. */
  it("lists a declined pull request unless a status narrows it away", () => {
    inPrWorkspace((ws, dir) => {
      git(["checkout", "-q", "main"], { cwd: dir });
      materializePrIfAbsent(ws, "ppp1");
      closeEntity(ws, "pr", "ppp1", { resolution: "wontfix" }, {});

      assert.deepEqual(
        listEntities(ws, "pr", emptyQuery()).map((entity) => entity.id),
        ["ppp11111"],
      );
      assert.deepEqual(listEntities(ws, "pr", parseListQuery(ws, [], "pr")), []);
      assert.deepEqual(
        listEntities(ws, "pr", parseListQuery(ws, ["status:closed"], "pr")).map(
          (entity) => entity.id,
        ),
        ["ppp11111"],
      );
    });
  });
});

/** `git rev-list --left-right --count a...b`: commits only `a` has, then only `b`. */
function branchesApart(dir: string, a: string, b: string): string {
  return git(["rev-list", "--left-right", "--count", `${a}...${b}`], { cwd: dir }).trim();
}

/** `findEntity` but null instead of throwing, for asserting absence. */
function findEntityOrNull(ws: WsCtx, ref: string): EntityRecord | null {
  try {
    return findEntity(ws, "pr", ref);
  } catch {
    return null;
  }
}
