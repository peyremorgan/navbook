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
  addSpec,
  applyComment,
  applyEntityEdit,
  bindReviewRevision,
  blobContent,
  blobSha,
  type CommentRecord,
  closeEntity,
  createFeature,
  currentAuthor,
  type EntityKind,
  type EntityRecord,
  editFeature,
  editSpec,
  executeIssueLink,
  type FeatureRecord,
  FrontmatterError,
  findEntity,
  findFeature,
  findParentIssue,
  loadRepo,
  locatePr,
  type NewCommentInput,
  newCommentFile,
  newFeatureFile,
  newIssueFile,
  newSpecFile,
  openIssue,
  planIssueLink,
  prepareOpen,
  type Repo,
  type RunPlanResult,
  reopenEntity,
  repoPath,
  resolveComment,
  resolveEntity,
  resolveFeature,
  resolveSpec,
  specFileName,
  unlinkIssue,
  validateComment,
  validateFeature,
  validateIssue,
  validatePr,
  validateSpec,
  WorkspaceError,
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
import type { FeatureParent, SpecParent } from "../mappers.ts";
import {
  applyEntityPatch,
  applyFeaturePatch,
  applySpecPatch,
  isEmptyPatch,
  isEmptySpecPatch,
  movedFields,
  namedFields,
} from "../patch.ts";
import { toCoreKind, toCoreVerdict } from "./map.ts";

/** Mutations always commit: a change nobody committed is not a change made. */
const COMMIT = { commit: true } as const;

/** What the client is told about the commit and the push behind it. */
function commitInfo(result: RunPlanResult, pushed: boolean): CommitInfo {
  return { committed: result.committed, subject: result.subject, pushed };
}

/**
 * The tree as the operation has just left it.
 *
 * The record an operation returns describes the tree before its own plan was
 * applied — a closed issue's record still says `open`, and its path still names
 * the directory it has left — so a payload has to read it back. That read
 * happens inside the write transaction, because once the lock is released the
 * next mutation is free to move the very files being reported on.
 */
function afterWrite(ctx: GraphQLCtx): Repo {
  ctx.invalidateRepo();
  return loadRepo(ctx.ws);
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
            ...(input.features ? { features: [...input.features] } : {}),
            // Absence rather than falsehood, because a rank of zero is a
            // position like any other. `Float` has already refused NaN and the
            // infinities at coercion, and `checkComposed` refuses a deadline
            // that is not a day before anything is written.
            ...(input.rank === undefined || input.rank === null ? {} : { rank: input.rank }),
            ...(input.deadline ? { deadline: input.deadline } : {}),
            ...(parent ? { parent: parent.id } : {}),
          });
          checkComposed(content, validateIssue, "issue");

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
        commit: commitInfo(result.run, pushed),
      };
    }),

  updateIssue: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await patchEntity(ctx, "issue", input);
      return { issue: result.entity, commit: commitInfo(result.run, pushed) };
    }),

  updatePr: (_parent, { input }, ctx) =>
    run(async () => {
      const { result, pushed } = await patchEntity(ctx, "pr", input);
      // A working-tree read, so it was found on no ref in particular.
      return { pr: { entity: result.entity, refs: [] }, commit: commitInfo(result.run, pushed) };
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
        commit: commitInfo(result.run, pushed),
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
          const entity = writeTarget(ctx, kind, input.ref);
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
          const written = from(afterWrite(ctx), kind, entity.id);
          return { run: added.run, entity: written, comment: addedComment(written, added.id) };
        },
        (commented) => commented.run.committed,
      );

      return {
        comment: result.comment,
        entity:
          result.entity.kind === "issue" ? result.entity : { entity: result.entity, refs: [] },
        commit: commitInfo(result.run, pushed),
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
        commit: commitInfo(result.run, pushed),
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
        commit: commitInfo(result.run, pushed),
      };
    }),

  createFeature: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.title, "title");

      const { result, pushed } = await ctx.sync.write(
        () => {
          const { created } = prepareOpen(ctx.ws);
          const content = newFeatureFile({
            title: input.title,
            author: currentAuthor(ctx.ws),
            created,
            // A feature may have no summary, so an absent one is absent rather
            // than refused the way an issue with no description is.
            ...(input.summary ? { body: input.summary } : {}),
          });
          checkComposed(content, validateFeature, "feature");

          const opened = createFeature(
            ctx.ws,
            {
              content,
              ...(input.slug ? { slug: input.slug } : {}),
              fallbackTitle: input.title,
            },
            COMMIT,
          );
          return { run: opened.run, feature: featureAfter(ctx, opened.slug) };
        },
        (opened) => opened.run.committed,
      );

      return { feature: result.feature, commit: commitInfo(result.run, pushed) };
    }),

  updateFeature: (_parent, { input }, ctx) =>
    run(async () => {
      if (input.title === undefined && input.summary === undefined) {
        throw invalidInput("the patch names no field to change");
      }

      const { result, pushed } = await ctx.sync.write(
        () => {
          const feature = findFeature(ctx.ws, input.slug);
          const before = readFileSync(absPath(ctx.ws, feature.filePath), "utf8");
          const patched = applyFeaturePatch(
            before,
            input,
            repoPath(ctx.ws.navDir, feature.filePath),
          );
          checkComposed(patched, validateFeature, "feature");

          // Unlike `updateIssue`, nothing is written before the operation runs:
          // `editSpec`/`editFeature` take the finished text, so core's guards —
          // the stale check among them — all run before any file is touched.
          const edited = editFeature(ctx.ws, feature.slug, patched, {
            commit: true,
            baseSha: input.baseSha,
          });
          return { run: edited.run, feature: featureAfter(ctx, feature.slug) };
        },
        (edited) => edited.run.committed,
      );

      return { feature: result.feature, commit: commitInfo(result.run, pushed) };
    }),

  addSpec: (_parent, { input }, ctx) =>
    run(async () => {
      requireText(input.title, "title");
      requireText(input.body, "body");

      const { result, pushed } = await ctx.sync.write(
        () => {
          const content = newSpecFile({ title: input.title, body: input.body });
          checkComposed(content, validateSpec, "specification document");

          const added = addSpec(
            ctx.ws,
            input.feature,
            { content, fileName: input.fileName ?? specFileName(input.title) },
            COMMIT,
          );
          return { run: added.run, ...specAfter(ctx, added.feature.slug, added.fileName) };
        },
        (added) => added.run.committed,
      );

      return {
        feature: result.feature,
        spec: result.spec,
        commit: commitInfo(result.run, pushed),
      };
    }),

  updateSpec: (_parent, { input }, ctx) =>
    run(async () => {
      if (isEmptySpecPatch(input)) throw invalidInput("the patch names no field to change");

      const { result, pushed } = await ctx.sync.write(
        () => {
          const feature = findFeature(ctx.ws, input.feature);
          const spec = resolveSpec(feature, input.fileName);
          const before = readFileSync(absPath(ctx.ws, spec.path), "utf8");
          const patched = applySpecPatch(before, input, repoPath(ctx.ws.navDir, spec.path));
          checkComposed(patched, validateSpec, "specification document");

          const edited = editSpec(ctx.ws, feature.slug, spec.fileName, patched, {
            commit: true,
            baseSha: input.baseSha,
          });
          return { run: edited.run, ...specAfter(ctx, feature.slug, spec.fileName) };
        },
        (edited) => edited.run.committed,
      );

      return {
        feature: result.feature,
        spec: result.spec,
        commit: commitInfo(result.run, pushed),
      };
    }),
};

/** The feature as the write has just left it, read back inside the transaction. */
function featureAfter(ctx: GraphQLCtx, slug: string): FeatureParent {
  return resolveFeature(afterWrite(ctx), slug);
}

/** The feature and one of its documents, likewise. */
function specAfter(
  ctx: GraphQLCtx,
  slug: string,
  fileName: string,
): { feature: FeatureRecord; spec: SpecParent } {
  const feature = featureAfter(ctx, slug);
  return { feature, spec: { feature, spec: resolveSpec(feature, fileName) } };
}

/**
 * The entity a write is to be made to, in the branch the server serves.
 *
 * A pull request's files live on the branch it proposes to merge (spec 03
 * §3.5), so one this checkout does not hold can be neither commented on nor
 * patched here: a comment would land in a directory with no `pr.md` beside it,
 * which is the stranded-comment fault of spec 03 §3.3.1 rather than a review,
 * and there is no `pr.md` here to patch at all. The cross-ref scan can still
 * see it, so the refusal says where it actually lives instead of repeating that
 * it was not found.
 */
function writeTarget(ctx: GraphQLCtx, kind: EntityKind, ref: string): EntityRecord {
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
 * Rewrite an entity's file from a patch, and record the edit as an edit.
 *
 * Both kinds go through here: the difference between them is which validator
 * the result must satisfy and, for a pull request, that its file may not be on
 * this branch at all — the refusal `writeTarget` raises.
 */
async function patchEntity(
  ctx: GraphQLCtx,
  kind: EntityKind,
  input: UpdateIssueInput | UpdatePrInput,
): Promise<{ result: { entity: EntityRecord; run: RunPlanResult }; pushed: boolean }> {
  if (isEmptyPatch(input)) throw invalidInput("the patch names no field to change");

  return ctx.sync.write(
    () => {
      const entity = writeTarget(ctx, kind, input.ref);
      const path = absPath(ctx.ws, entity.filePath);
      const before = readFileSync(path, "utf8");
      // After the pull and before the write, like core's own stale check: a
      // refusal leaves the tree exactly as it was.
      if (input.baseSha !== undefined && input.baseSha !== null) {
        assertFieldsUnmoved(ctx, entity, before, input, input.baseSha);
      }
      const patched = applyEntityPatch(before, input, repoPath(ctx.ws.navDir, entity.filePath));
      // Validated before the file is touched, so a rejected patch leaves the
      // tree exactly as it was.
      checkComposed(patched, kind === "issue" ? validateIssue : validatePr, kind);

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
        edit = applyEntityEdit(ctx.ws, entity, COMMIT);
      } catch (error) {
        writeFileSync(path, before, "utf8");
        throw error;
      }
      return { run: edit, entity: from(afterWrite(ctx), kind, entity.id) };
    },
    (edit) => edit.run.committed,
  );
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
 */
function assertFieldsUnmoved(
  ctx: GraphQLCtx,
  entity: EntityRecord,
  current: string,
  input: UpdateIssueInput | UpdatePrInput,
  baseSha: string,
): void {
  if (blobSha(current) === baseSha) return;

  const unknown = (): GraphQLError =>
    stale(`#${entity.id} was read from a version this server does not have`, namedFields(input));
  const base = blobContent(ctx.ws.repoRoot, baseSha);
  if (base === null) throw unknown();

  let moved: string[];
  try {
    moved = movedFields(base, current, input);
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
