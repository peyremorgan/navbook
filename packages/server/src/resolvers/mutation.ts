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
  applyComment,
  applyEntityEdit,
  bindReviewRevision,
  type CommentRecord,
  closeEntity,
  currentAuthor,
  type EntityKind,
  type EntityRecord,
  executeIssueLink,
  findEntity,
  findParentIssue,
  locatePr,
  type NewCommentInput,
  newCommentFile,
  newIssueFile,
  openIssue,
  planIssueLink,
  prepareOpen,
  type RunPlanResult,
  reopenEntity,
  resolveComment,
  resolveEntityForEdit,
  unlinkIssue,
  validateComment,
  validateIssue,
  WorkspaceError,
} from "@navbook/core";
import { checkComposed, requireText } from "../compose.ts";
import type { GraphQLCtx } from "../context.ts";
import { apiError, invalidInput, run } from "../errors.ts";
import type {
  AddCommentInput,
  CommitInfo,
  MutationResolvers,
} from "../generated/resolver-types.ts";
import { applyIssuePatch, isEmptyPatch } from "../patch.ts";
import { toCoreKind, toCoreVerdict } from "./map.ts";

/** Mutations always commit: a change nobody committed is not a change made. */
const COMMIT = { commit: true } as const;

/** What the client is told about the commit and the push behind it. */
function commitInfo(result: RunPlanResult, pushed: boolean): CommitInfo {
  return { committed: result.committed, subject: result.subject, pushed };
}

/**
 * Re-read an entity after writing it.
 *
 * The record the operation returned describes the tree before its own plan was
 * applied — a closed issue's record still says `open`, and its path still names
 * the directory it has left. Reading it back is what makes the payload true.
 */
function reread(ctx: GraphQLCtx, kind: EntityKind, id: string): EntityRecord {
  ctx.invalidateRepo();
  return findEntity(ctx.ws, kind, id);
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
            ...(parent ? { parent: parent.id } : {}),
          });
          checkComposed(content, validateIssue, "issue");

          return openIssue(ctx.ws, { content, fallbackTitle: input.title }, COMMIT);
        },
        (opened) => opened.run.committed,
      );

      return {
        issue: reread(ctx, "issue", result.id),
        parent: result.parent ? reread(ctx, "issue", result.parent.id) : null,
        commit: commitInfo(result.run, pushed),
      };
    }),

  updateIssue: (_parent, { input }, ctx) =>
    run(async () => {
      if (isEmptyPatch(input)) throw invalidInput("the patch names no field to change");

      const { result, pushed } = await ctx.sync.write(
        () => {
          const { entity, path } = resolveEntityForEdit(ctx.ws, "issue", input.ref);
          const patched = applyIssuePatch(readFileSync(path, "utf8"), input, entity.filePath);
          // Validated before the file is touched, so a rejected patch leaves
          // the tree exactly as it was.
          checkComposed(patched, validateIssue, "issue");

          writeFileSync(path, patched, "utf8");
          // `applyEntityEdit` reads the file back, which is what puts the edit
          // in the plan and so under the --commit guard.
          return { entity, run: applyEntityEdit(ctx.ws, entity, COMMIT) };
        },
        (edit) => edit.run.committed,
      );

      return {
        issue: reread(ctx, "issue", result.entity.id),
        commit: commitInfo(result.run, pushed),
      };
    }),

  closeIssue: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () =>
          closeEntity(
            ctx.ws,
            "issue",
            input.ref,
            {
              ...(input.resolution ? { resolution: input.resolution } : {}),
              ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}),
            },
            COMMIT,
          ),
        (closed) => closed.run.committed,
      );

      return {
        issue: reread(ctx, "issue", result.entity.id),
        destination: result.destination,
        commit: commitInfo(result.run, pushed),
      };
    }),

  reopenIssue: (_parent, { ref }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => reopenEntity(ctx.ws, "issue", ref, COMMIT),
        (reopened) => reopened.run.committed,
      );

      return {
        issue: reread(ctx, "issue", result.entity.id),
        destination: result.destination,
        commit: commitInfo(result.run, pushed),
      };
    }),

  addComment: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.body, "body");
      const kind = toCoreKind(input.kind);
      const review = reviewFields(input, kind);

      const { result, pushed } = await ctx.sync.write(
        () => {
          const entity = commentTarget(ctx, kind, input.ref);
          const replyTo =
            input.replyTo === undefined || input.replyTo === null
              ? undefined
              : resolveComment(entity, input.replyTo);

          const content = newCommentFile({
            author: currentAuthor(ctx.ws),
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
            ctx.ws,
            entity,
            { content, review: review?.verdict !== undefined },
            COMMIT,
          );
          return { entity, added };
        },
        (commented) => commented.added.run.committed,
      );

      const entity = reread(ctx, kind, result.entity.id);
      return {
        comment: addedComment(entity, result.added.id),
        entity: entity.kind === "issue" ? entity : { entity, refs: [] },
        commit: commitInfo(result.added.run, pushed),
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
          return { link, run: executeIssueLink(ctx.ws, link, COMMIT) };
        },
        (linked) => linked.run.committed,
      );

      return {
        child: reread(ctx, "issue", result.link.child.id),
        parent: findEntity(ctx.ws, "issue", result.link.parent.id),
        previousParentId: result.link.previousParentId ?? null,
        commit: commitInfo(result.run, pushed),
      };
    }),

  unlinkIssue: (_parent, { ref }, ctx) =>
    run(async () => {
      const { result, pushed } = await ctx.sync.write(
        () => unlinkIssue(ctx.ws, ref, COMMIT),
        (unlinked) => unlinked.run.committed,
      );

      return {
        child: reread(ctx, "issue", result.child.id),
        previousParentId: result.parentId ?? null,
        commit: commitInfo(result.run, pushed),
      };
    }),
};

/**
 * The entity a comment is to be added to, in the branch the server serves.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so one this checkout does not hold cannot be commented on here: the
 * comment would land in a directory with no `pr.md` beside it, which is the
 * stranded-comment fault of spec 03 §3.3.1 rather than a review. The cross-ref
 * scan can still see it, so the refusal says where it actually lives instead of
 * repeating that it was not found.
 */
function commentTarget(ctx: GraphQLCtx, kind: EntityKind, ref: string): EntityRecord {
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
          "a comment must be written beside the pull request it belongs to",
          `serve a checkout of '${located.sourceRef}' to review it`,
        ],
      },
    );
  }
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
