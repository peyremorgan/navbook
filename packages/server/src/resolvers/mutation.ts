/**
 * The write half of the API — spec 06 §6.3.
 *
 * Every mutation is the same shape: compose what the operation layer needs from
 * structured input, run the operation inside the sync engine's write
 * transaction, and read the entity back so the payload describes the tree as it
 * now is rather than as it was.
 *
 * Two things are deliberately not here. Composing is delegated to `core`'s file
 * builders, so the server never writes frontmatter by hand; and the decision to
 * go ahead with a link that moves a subtask is the client's, taken with a flag
 * rather than with a plan the server would have to remember.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  absPath,
  applyComment,
  applyEntityEdit,
  bindReviewRevision,
  blobContent,
  blobSha,
  type CommentRecord,
  closeEntity,
  currentAuthor,
  currentBranch,
  defaultBranch,
  type EntityKind,
  type EntityRecord,
  executeIssueLink,
  FrontmatterError,
  findEntity,
  findParentIssue,
  findPrToWrite,
  isValidBranchName,
  loadRepo,
  locatePr,
  locatePrToWrite,
  type NewCommentInput,
  newCommentFile,
  newIssueFile,
  newPrFile,
  nowIso,
  openIssue,
  openPr,
  planIssueLink,
  prepareOpen,
  preparePrOpen,
  type Repo,
  type RunPlanResult,
  reopenEntity,
  repoPath,
  resolveComment,
  resolveEntity,
  resolveSha,
  stringField,
  unlinkIssue,
  validateComment,
  validateIssue,
  validatePr,
  WorkspaceError,
  type WsCtx,
} from "@navbook/core";
import type { GraphQLError } from "graphql";
import { checkComposed, requireText } from "../compose.ts";
import type { GraphQLCtx } from "../context.ts";
import { apiError, invalidInput, run } from "../errors.ts";
import type {
  AddCommentInput,
  CommitInfo,
  MutationResolvers,
  UpdateIssueInput,
  UpdatePrInput,
} from "../generated/resolver-types.ts";
import {
  applyEntityPatch,
  isEmptyPatch,
  movedFields,
  namedFields,
  type PluginField,
} from "../patch.ts";
import type { WriteResult } from "../sync.ts";
import { type WriteSite, writeOnBranch } from "../write-site.ts";
import { toCoreKind, toCoreVerdict } from "./map.ts";

/** Mutations always commit: a change nobody committed is not a change made. */
const COMMIT = { commit: true } as const;

/**
 * What the client is told about the commit and the push behind it — and, in
 * the same breath, what the plugins are told.
 *
 * Every mutation ends here, which is why the event is emitted here: one place
 * to keep correct, and a mutation added later gets it without anybody
 * remembering to. It runs after the write transaction has released, so a
 * listener sees a settled tree and cannot deadlock reading it, and after the
 * push has been attempted, so `pushed` is the truth rather than a hope.
 *
 * A write whose push failed never gets here: it throws — `SYNC_CONFLICT`,
 * `SYNC_PUSH_REJECTED` or `SYNC_FAILED`, each saying the commit was kept in
 * the clone — and so no event is emitted for it. That is deliberate. The
 * person who asked was told the change did not go through, and spec 06 §6.3
 * says a client reporting such a change as saved would be lying about where
 * the work went; a bridge announcing it to a channel would be telling the
 * same lie to more people. The commit may yet reach the remote with the next
 * push, or be thrown away by the operator reconciling the clone, and which of
 * the two is not known here. So `pushed: false` on an event means what it
 * means on {@link CommitInfo}: a server with no remote, or nothing committed.
 */
export function commitInfo(ctx: GraphQLCtx, result: RunPlanResult, pushed: boolean): CommitInfo {
  ctx.plugins.emit({
    subject: result.subject,
    message: result.message,
    committed: result.committed,
    pushed,
    viewer: ctx.viewer,
    at: nowIso(ctx.ws),
  });
  return { committed: result.committed, subject: result.subject, pushed };
}

/**
 * The tree as the operation has just left it.
 *
 * The record an operation returns describes the tree before its own plan was
 * applied — a closed issue's record still says `open`, and its path still names
 * the directory it has left — so a payload has to read it back. That read
 * happens inside the write transaction, because once the lock is released the
 * next mutation is free to move the very files being reported on. It is also
 * the tree the payload's own fields then read.
 */
function afterWrite(ctx: GraphQLCtx): Repo {
  ctx.invalidateRepo();
  return ctx.loadRepo("all");
}

/**
 * The tree as a write at `site` has just left it.
 *
 * The clone's own tree for a write made there; the worktree's, read whole,
 * for one made on another branch. That one is never the clone's cached tree,
 * which describes the served branch — and it is read with every comment, so a
 * payload's fields never go back to the served branch for them.
 */
function afterWriteAt(ctx: GraphQLCtx, at: WsCtx, site: WriteSite): Repo {
  return site.worktree === null ? afterWrite(ctx) : loadRepo(at, { comments: "all" });
}

/**
 * Where to read a pull request's target from, by its full ref name.
 *
 * The remote's copy whenever there is a remote, even with a local branch of
 * the same name beside it: the server keeps only the branch it serves up to
 * date, so any other local branch in its clone is as old as whoever made it
 * left it, and a merge base read from that would be older than the truth. A
 * target that is no branch there is refused, rather than handed to git as a
 * revision to make sense of.
 */
function targetRev(ctx: GraphQLCtx, at: WsCtx, target: string): string {
  const remote = ctx.sync.remote;
  const ref = remote === null ? `refs/heads/${target}` : `refs/remotes/${remote}/${target}`;
  if (resolveSha(at.repoRoot, ref) === null) {
    throw apiError(
      remote === null
        ? `there is no branch '${target}' in the server's clone`
        : `'${target}' is not a branch on '${remote}'`,
      "PRECONDITION",
      { branch: target, ...(remote === null ? {} : { remote }) },
    );
  }
  return ref;
}

/** Refuse, as bad input, a field naming something git would not take for a branch. */
function requireBranchName(ctx: GraphQLCtx, name: string, what: string): void {
  if (!isValidBranchName(ctx.ws.repoRoot, name)) {
    throw invalidInput(`${what} '${name}' is not a branch name git accepts`);
  }
}

/**
 * Refuse to open a pull request on the served branch or the default one.
 *
 * Opening one commits on its source branch and pushes it, as the person
 * asking — and anybody signed in may ask. That is a write to a branch they
 * chose, which is fine for the branch somebody pushed to propose a change and
 * not for the ones everybody else builds on: the served branch is the
 * tracker's, and the default branch is where pull requests land. Neither is
 * the source of one anybody opens through the API.
 */
function refuseSharedSource(ctx: GraphQLCtx, source: string): void {
  const root = ctx.ws.repoRoot;
  const which =
    source === currentBranch(root)
      ? "the branch this server serves"
      : source === defaultBranch(root)
        ? "the repository's default branch"
        : null;
  if (which === null) return;
  throw apiError(`cannot open a pull request on '${source}', ${which}`, "PRECONDITION", {
    branch: source,
    details: [
      "a pull request is written on its source branch, which the server commits to and pushes",
      "push the work to a branch of its own and open the pull request from that",
    ],
  });
}

/** The branch a payload read from `site` was found on, in `Pr.refs`' terms. */
function refsOf(site: WriteSite): string[] {
  return site.worktree === null ? [] : [site.branch];
}

/** One entity from an already-loaded tree. */
function from(repo: Repo, kind: EntityKind, id: string): EntityRecord {
  return resolveEntity(repo, id, kind);
}

/** The comment a write just added, found by the id the operation minted. */
function addedComment(entity: EntityRecord, id: string): CommentRecord {
  const comment = entity.comments.find((candidate) => candidate.id === id);
  if (!comment) {
    // The file was written and committed a moment ago; not finding it means the
    // tree changed underneath, which is worth an error rather than a null.
    throw apiError(`comment #${id} was written but could not be read back`, "PRECONDITION");
  }
  return comment;
}

export const Mutation: MutationResolvers = {
  openIssue: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.title, "title");
      requireText(input.body, "body");

      const { result, pushed } = await ctx.sync.write(
        () => {
          const { created } = prepareOpen(ctx.ws);
          // Resolved before composing, so a bad parent is reported without
          // anything having been written.
          const parent =
            input.parent === undefined || input.parent === null
              ? undefined
              : findParentIssue(ctx.ws, input.parent);

          const content = newIssueFile({
            title: input.title,
            author: currentAuthor(ctx.ws),
            created,
            body: input.body,
            ...(input.labels ? { labels: [...input.labels] } : {}),
            ...(input.assignees ? { assignee: [...input.assignees] } : {}),
            ...(input.milestone ? { milestone: input.milestone } : {}),
            // Absence rather than falsehood, because a rank of zero is a
            // position like any other. `Float` has already refused NaN and the
            // infinities at coercion, and `checkComposed` refuses a deadline
            // that is not a day before anything is written.
            ...(input.rank === undefined || input.rank === null ? {} : { rank: input.rank }),
            // Fields a plugin's own SDL added to this input, bridged onto the
            // frontmatter by whichever plugin declared them.
            ext: ctx.plugins.openFields(input as Record<string, unknown>),
            ...(input.deadline ? { deadline: input.deadline } : {}),
            ...(parent ? { parent: parent.id } : {}),
          });
          checkComposed(content, (parsed) => validateIssue(parsed, ctx.ws.ext), "issue");

          const opened = openIssue(ctx.ws, { content, fallbackTitle: input.title }, COMMIT);
          const repo = afterWrite(ctx);
          return {
            run: opened.run,
            issue: from(repo, "issue", opened.id),
            parent: opened.parent ? from(repo, "issue", opened.parent.id) : null,
          };
        },
        (opened) => opened.run.committed,
      );

      return {
        issue: result.issue,
        parent: result.parent,
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  updateIssue: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await patchEntity(ctx, "issue", input);
      return { issue: result.entity, commit: commitInfo(ctx, result.run, pushed) };
    }),

  updatePr: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await patchEntity(ctx, "pr", input);
      return {
        pr: { entity: result.entity, refs: result.refs },
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  closeIssue: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => {
          const closed = closeEntity(
            ctx.ws,
            "issue",
            input.ref,
            {
              ...(input.resolution ? { resolution: input.resolution } : {}),
              ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}),
            },
            COMMIT,
          );
          return {
            run: closed.run,
            destination: closed.destination,
            issue: from(afterWrite(ctx), "issue", closed.entity.id),
          };
        },
        (closed) => closed.run.committed,
      );

      return {
        issue: result.issue,
        destination: result.destination,
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  reopenIssue: (_parent, { ref }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => {
          const reopened = reopenEntity(ctx.ws, "issue", ref, COMMIT);
          return {
            run: reopened.run,
            destination: reopened.destination,
            issue: from(afterWrite(ctx), "issue", reopened.entity.id),
          };
        },
        (reopened) => reopened.run.committed,
      );

      return {
        issue: result.issue,
        destination: result.destination,
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  addComment: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.body, "body");
      const kind = toCoreKind(input.kind);
      const review = reviewFields(input, kind);

      const { result, pushed } = await writeEntity(ctx, kind, input.ref, (at, entity, site) => {
        const replyTo =
          input.replyTo === undefined || input.replyTo === null
            ? undefined
            : resolveComment(entity, input.replyTo);

        const content = newCommentFile({
          author: currentAuthor(at),
          body: input.body,
          ...(replyTo ? { replyTo } : {}),
          // Bound here, inside the transaction: the revision it resolves
          // against is the one the tree records after the pull.
          ...(review ? { ...review, revision: bindReviewRevision(entity, review.revision) } : {}),
        });
        checkComposed(
          content,
          (parsed) => validateComment(parsed, { onPr: kind === "pr" }),
          noun(review),
        );

        // A verdict is what makes it a review rather than a comment that
        // happens to point at a line, exactly as `nav pr review` decides it.
        const added = applyComment(
          at,
          entity,
          { content, review: review?.verdict !== undefined },
          COMMIT,
        );
        const written = from(afterWriteAt(ctx, at, site), kind, entity.id);
        return {
          run: added.run,
          entity: written,
          refs: refsOf(site),
          comment: addedComment(written, added.id),
        };
      });

      return {
        comment: result.comment,
        entity:
          result.entity.kind === "issue"
            ? result.entity
            : { entity: result.entity, refs: result.refs },
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  openPr: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.title, "title");
      requireText(input.body, "body");
      const source = requireText(input.source, "source").trim();
      const target = input.target?.trim() || undefined;
      // Settled before anything is checked out: there is nothing to look at.
      requireBranchName(ctx, source, "source");
      if (target !== undefined) requireBranchName(ctx, target, "target");
      if (target === source) {
        throw apiError(`a pull request cannot target its own branch (${source})`, "PRECONDITION");
      }

      const { result, pushed } = await writeOnBranch(
        ctx,
        () => {
          // Under the lock, after the fetch: the default branch is the remote's say.
          refuseSharedSource(ctx, source);
          return source;
        },
        (at, site) => {
          if (!at.hasNavbook) {
            throw apiError(
              `'${source}' has no ${at.navDir}/ to open a pull request in`,
              "PRECONDITION",
              {
                details: [
                  "a pull request is written on its source branch, which has to carry the tracker",
                ],
              },
            );
          }
          const named = target ?? defaultBranch(at.repoRoot) ?? undefined;
          const draft = preparePrOpen(at, {
            source,
            // The site's own checkout: the server's copy of the branch, merged
            // with the remote's a moment ago, which is not a branch of that name.
            sourceRev: "HEAD",
            title: input.title,
            ...(named === undefined ? {} : { target: named, targetRev: targetRev(ctx, at, named) }),
          });
          const content = newPrFile({
            title: draft.title,
            author: currentAuthor(at),
            created: draft.created,
            body: input.body,
            target: draft.target,
            source: draft.source,
            revisions: [draft.revision],
            ...(input.draft ? { draft: true } : {}),
            ...(input.reviewers ? { reviewers: [...input.reviewers] } : {}),
            ...(input.labels ? { labels: [...input.labels] } : {}),
            ...(input.assignees ? { assignee: [...input.assignees] } : {}),
            ...(input.milestone ? { milestone: input.milestone } : {}),
            ext: ctx.plugins.openFields(input as Record<string, unknown>),
          });
          checkComposed(content, (parsed) => validatePr(parsed, at.ext), "pull request");

          const opened = openPr(at, { content, fallbackTitle: draft.title }, COMMIT);
          return {
            run: opened.run,
            pr: from(afterWriteAt(ctx, at, site), "pr", opened.id),
            refs: refsOf(site),
          };
        },
        (opened) => opened.run.committed,
      );

      return {
        pr: { entity: result.pr, refs: result.refs },
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  linkIssue: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => {
          const link = planIssueLink(ctx.ws, input.child, input.parent, COMMIT);
          // Moving a subtask changes a structure somebody else may be reading,
          // so it takes explicit consent. Refusing here means the plan is
          // discarded rather than remembered: the client re-sends it with the
          // flag, and the second attempt is planned against the tree as it is
          // then — which is what keeps the server free of pending state.
          if (link.previousParentId !== undefined && !input.allowReparent) {
            throw apiError(
              `#${link.child.id} is already a subtask of #${link.previousParentId}`,
              "REPARENT_REQUIRED",
              {
                currentParentId: link.previousParentId,
                ...(link.previousParent ? { currentParentTitle: link.previousParent.title } : {}),
                details: ["pass allowReparent: true to move it"],
              },
            );
          }
          const linked = executeIssueLink(ctx.ws, link, COMMIT);
          const repo = afterWrite(ctx);
          return {
            run: linked,
            child: from(repo, "issue", link.child.id),
            parent: from(repo, "issue", link.parent.id),
            previousParentId: link.previousParentId ?? null,
          };
        },
        (linked) => linked.run.committed,
      );

      return {
        child: result.child,
        parent: result.parent,
        previousParentId: result.previousParentId,
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),

  unlinkIssue: (_parent, { ref }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => {
          const unlinked = unlinkIssue(ctx.ws, ref, COMMIT);
          return {
            run: unlinked.run,
            child: from(afterWrite(ctx), "issue", unlinked.child.id),
            previousParentId: unlinked.parentId ?? null,
          };
        },
        (unlinked) => unlinked.run.committed,
      );

      return {
        child: result.child,
        previousParentId: result.previousParentId,
        commit: commitInfo(ctx, result.run, pushed),
      };
    }),
};

/**
 * The entity a plugin's write is to be made to, in the branch the server serves.
 *
 * A pull request this checkout does not hold is refused with PRECONDITION and
 * the branch that carries it: what a plugin keeps beside `pr.md` is written
 * there or nowhere, and the host's own writes reach that branch through
 * `writeEntity` instead.
 */
export function writeTarget(ctx: GraphQLCtx, kind: EntityKind, ref: string): EntityRecord {
  try {
    return findEntity(ctx.ws, kind, ref);
  } catch (error) {
    if (kind !== "pr" || !(error instanceof WorkspaceError) || error.code !== "not-found")
      throw error;

    const located = locatePr(ctx.ws, ref);
    throw apiError(
      `#${located.entity.id} is on '${located.sourceRef}', which this server does not have checked out`,
      "PRECONDITION",
      {
        sourceRef: located.sourceRef,
        details: [
          "a pull request is written beside the files it proposes to change",
          `serve a checkout of '${located.sourceRef}' to write to it`,
        ],
      },
    );
  }
}

/**
 * Run a write against an entity where it lives.
 *
 * An issue lives on the served branch. A pull request lives on the branch it
 * proposes to merge (spec 03 §3.5), and one this checkout does not hold is
 * written there — in a temporary worktree on that branch, which is then pushed
 * — rather than beside no `pr.md` at all, the stranded comment of spec 03
 * §3.3.1. Where it lives is decided under the lock, after the fetch, and the
 * entity the body is given is read at the site, after that site was brought up
 * to date: it is the copy the write lands beside.
 */
function writeEntity<T extends { run: RunPlanResult }>(
  ctx: GraphQLCtx,
  kind: EntityKind,
  ref: string,
  body: (at: WsCtx, entity: EntityRecord, site: WriteSite) => T,
): Promise<WriteResult<T>> {
  return writeOnBranch(
    ctx,
    () => (kind === "pr" ? prBranch(ctx, ref) : null),
    (at, site) =>
      body(at, kind === "pr" ? findPrToWrite(at, ref) : findEntity(at, kind, ref), site),
    (result) => result.run.committed,
  );
}

/**
 * The branch to write a pull request on, or null when the served checkout holds it.
 *
 * The branch its `source:` names, and no other. A branch that merged the
 * source in carries the pull request's directory too — the scan finds it on
 * both — but a comment written there lands where nobody reviewing the pull
 * request looks. So the remote's copy of that branch (the clone's own, with no
 * remote) has to be among the refs carrying it, and a pull request naming no
 * source, or one its own branch no longer carries, is refused rather than
 * written wherever it happens to be found.
 */
function prBranch(ctx: GraphQLCtx, ref: string): string | null {
  const { entity, elsewhere } = locatePrToWrite(ctx.ws, ref);
  if (elsewhere === null) return null;
  const source = stringField(entity, "source");
  if (source === "") {
    throw apiError(
      `#${entity.id} names no source branch, so there is no telling which branch to write it on`,
      "PRECONDITION",
      { details: ["give it a 'source:' from a checkout of its branch"] },
    );
  }
  const remote = ctx.sync.remote;
  const own = remote === null ? `refs/heads/${source}` : `refs/remotes/${remote}/${source}`;
  if (!elsewhere.refs.includes(own)) {
    const where = remote === null ? "the server's clone" : `'${remote}'`;
    throw apiError(
      `#${entity.id} is not on '${source}', its source branch, in ${where}`,
      "PRECONDITION",
      {
        branch: source,
        details: [
          `it is on ${elsewhere.refs.map((full) => `'${shortRef(full)}'`).join(", ")}`,
          "a pull request is written on its own branch; one that merged that branch in carries a copy nobody reviewing it reads",
        ],
      },
    );
  }
  return source;
}

/** A ref's name as `git branch -a` would print it. */
function shortRef(full: string): string {
  return full.replace(/^refs\/(heads|remotes)\//, "");
}

/**
 * Rewrite an entity's file from a patch, and record the edit as an edit.
 *
 * Both kinds go through here: the difference between them is which validator
 * the result must satisfy and, for a pull request, that its file may be on
 * another branch — where `writeEntity` takes the write.
 */
async function patchEntity(
  ctx: GraphQLCtx,
  kind: EntityKind,
  input: UpdateIssueInput | UpdatePrInput,
): Promise<WriteResult<{ entity: EntityRecord; run: RunPlanResult; refs: string[] }>> {
  // A plugin's own field counts as something to change: `updateIssue` naming
  // only `features` is a patch, not an empty one.
  const extFields = ctx.plugins.patchFields(input as Record<string, unknown>);
  const pluginFields = ctx.plugins.patchedFields(input as Record<string, unknown>);
  if (isEmptyPatch(input) && Object.keys(extFields).length === 0) {
    throw invalidInput("the patch names no field to change");
  }

  return writeEntity(ctx, kind, input.ref, (at, entity, site) => {
    const path = absPath(at, entity.filePath);
    const before = readFileSync(path, "utf8");
    // After the pull and before the write, like core's own stale check: a
    // refusal leaves the tree exactly as it was.
    if (input.baseSha !== undefined && input.baseSha !== null) {
      assertFieldsUnmoved(ctx, entity, before, input, input.baseSha, pluginFields);
    }
    const patched = applyEntityPatch(
      before,
      input,
      repoPath(ctx.ws.navDir, entity.filePath),
      extFields,
    );
    // Validated before the file is touched, so a rejected patch leaves the
    // tree exactly as it was.
    // With the plugins' keys: a field a plugin owns is validated by it, and a
    // value it refuses must not reach the file, where doctor would find it.
    checkComposed(
      patched,
      (parsed) => (kind === "issue" ? validateIssue(parsed, at.ext) : validatePr(parsed, at.ext)),
      kind,
    );

    // Editing in place is what `applyEntityEdit` records — it reads the file
    // back, which is what puts the edit in the plan and so under the --commit
    // guard. Every other operation writes nothing until it is sure it can
    // commit (core's guard runs first, by design); this one cannot, so it
    // undoes its own write instead. A patched file left behind by a failure
    // would become the base of the next edit, and be committed under somebody
    // else's request.
    writeFileSync(path, patched, "utf8");
    let edit: RunPlanResult;
    try {
      edit = applyEntityEdit(at, entity, COMMIT);
    } catch (error) {
      writeFileSync(path, before, "utf8");
      throw error;
    }
    return {
      run: edit,
      entity: from(afterWriteAt(ctx, at, site), kind, entity.id),
      refs: refsOf(site),
    };
  });
}

/**
 * Refuse a patch to a field that has changed since the client read the file.
 *
 * The twin of core's `assertUnchanged`, per field rather than per file. A hash
 * of the file as it is now is the common case and is settled without git, the
 * way core settles it: hash to hash. Otherwise the hash names the version the
 * client composed its edit against, and that blob is still in the clone —
 * every write here commits, so it is reachable for as long as the hash came
 * from this server. The two versions are then compared on the fields the patch
 * names and nothing else (`movedFields`), because a label set on an issue
 * somebody has just retitled is not a conflict with anybody.
 *
 * A hash the clone cannot make sense of — one it has not fetched, one that is
 * not a hash at all, or one naming a blob that was never an entity file — is
 * refused as stale rather than crashed on: there is no way to tell what the
 * client was looking at, and the refusal says so.
 *
 * That lookup is best-effort. `blobSha` is a function of the text, not git's
 * name for it, and the two coincide only in the default configuration: under
 * a clean filter, `core.autocrlf` with CRLF on disk, or SHA-256 objects, the
 * version the client saw is not found by its hash and a concurrent edit is
 * refused whole — "reload and try again" rather than "this field moved".
 */
function assertFieldsUnmoved(
  ctx: GraphQLCtx,
  entity: EntityRecord,
  current: string,
  input: UpdateIssueInput | UpdatePrInput,
  baseSha: string,
  pluginFields: readonly PluginField[],
): void {
  if (blobSha(current) === baseSha) return;

  const unknown = (): GraphQLError =>
    stale(
      `#${entity.id} was read from a version this server does not have`,
      namedFields(input, pluginFields),
    );
  const base = blobContent(ctx.ws.repoRoot, baseSha);
  if (base === null) throw unknown();

  let moved: string[];
  try {
    moved = movedFields(base, current, input, { fields: pluginFields, ext: ctx.ws.ext });
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    throw unknown();
  }
  if (moved.length === 0) return;
  throw stale(`${moved.join(", ")} of #${entity.id} changed since you opened it`, moved);
}

/** The refusal, carrying the fields in doubt as the input spells them. */
function stale(message: string, moved: string[]): GraphQLError {
  return apiError(message, "STALE_CONTENT", {
    moved,
    details: ["reload it and apply your change to what it says now"],
  });
}

type ReviewFields = Pick<NewCommentInput, "verdict" | "revision" | "file" | "line">;

/** What to call the file in a validation failure. */
function noun(review: ReviewFields | null): string {
  return review?.verdict === undefined ? "comment" : "review";
}

/**
 * The review half of a comment, or null when it is a plain one.
 *
 * A review is evidence about a specific state of a branch (spec 02 §2.6), so
 * the fields only mean anything on a pull request, and a line without a file
 * has nothing to point at. Both are refused here rather than being left to
 * produce a puzzling validation failure later.
 */
function reviewFields(input: AddCommentInput, kind: EntityKind): ReviewFields | null {
  const verdict = input.verdict ?? null;
  const file = input.file ?? null;
  const line = input.line ?? null;
  const revision = input.revision ?? null;

  if (verdict === null && file === null) {
    if (line !== null) throw invalidInput("'line' is only meaningful with 'file'");
    if (revision !== null) {
      throw invalidInput("'revision' is only meaningful with 'verdict' or 'file'");
    }
    return null;
  }
  if (kind !== "pr") {
    throw invalidInput("review fields are only meaningful on pull-request comments (§2.6)");
  }
  if (line !== null && file === null) throw invalidInput("'line' is only meaningful with 'file'");

  return {
    ...(verdict !== null ? { verdict: toCoreVerdict(verdict) } : {}),
    ...(revision !== null ? { revision } : {}),
    ...(file !== null ? { file } : {}),
    ...(line !== null ? { line } : {}),
  };
}
