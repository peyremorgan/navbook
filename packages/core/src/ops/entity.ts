/**
 * The operations issues and pull requests share — spec 04 §4.3.
 *
 * Each one loads the tree, resolves what the caller named, asks `core` for a
 * plan and applies it. What comes back is data: which entity was touched, where
 * it landed, what was committed. Nothing here decides how any of that is
 * phrased or where it is written.
 *
 * Operations that would otherwise have to stop and ask mid-flight are split in
 * two — a `plan…` that describes the consequences and an `execute…` that
 * carries them out — so the decision to go ahead belongs to the caller.
 */

import { readFileSync } from "node:fs";
import { parseFile, readParent, readSubtasks, validateIssue, validatePr } from "../core/files.ts";
import { FrontmatterError } from "../core/frontmatter.ts";
import { NAVBOOK_ROOT } from "../core/json.ts";
import { descendantsOf, type LinkRepair } from "../core/links.ts";
import {
  type CloseInput,
  docsSubject,
  LinkRewriteError,
  linksReadable,
  type Plan,
  planClose,
  planComment,
  planDelete,
  planEntityOpen,
  planPaths,
  planReopen,
} from "../core/ops.ts";
import { isQueryError, matchesQuery, parseQuery, type Query } from "../core/query.ts";
import type { EntityKind, EntityRecord, Repo } from "../core/tree.ts";
import { uncommittedPaths } from "../git/index-ops.ts";
import {
  absPath,
  assertNoUnrelatedStaged,
  currentAuthor,
  loadRepo,
  loadRepoForQuery,
  nowIso,
  type RunPlanResult,
  repoPath,
  requireNavbook,
  resolveEntity,
  runPlan,
  scanAllIds,
  type WsCtx,
  wsFail,
} from "../workspace/index.ts";

export interface CommitOptions {
  commit?: boolean;
}

/** Entities of one kind from a parsed repository. */
export function selectEntities(repo: Repo, kind: EntityKind): EntityRecord[] {
  return kind === "issue" ? repo.issues : repo.prs;
}

/** Newest first, with a stable tie-break on ID. */
export function sortEntities(entities: readonly EntityRecord[]): EntityRecord[] {
  return [...entities].sort((a, b) => {
    const aCreated = typeof a.fm.created === "string" ? a.fm.created : "";
    const bCreated = typeof b.fm.created === "string" ? b.fm.created : "";
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Parse query terms, reporting a malformed query as an input error. */
export function parseListQuery(terms: readonly string[], kind: EntityKind): Query {
  const query = parseQuery([...terms], kind);
  if (isQueryError(query)) wsFail("invalid-input", query.message);
  return query;
}

export interface ListEntitiesOptions {
  /** Entities to filter instead of the working tree's, e.g. a cross-ref scan. */
  entities?: readonly EntityRecord[];
}

/** Entities of one kind matching a query, newest first. */
export function listEntities(
  ws: WsCtx,
  kind: EntityKind,
  query: Query,
  opts: ListEntitiesOptions = {},
): EntityRecord[] {
  const source = opts.entities ?? selectEntities(loadRepoForQuery(ws, query), kind);
  return sortEntities(source.filter((entity) => matchesQuery(query, entity)));
}

/** Resolve an ID or unambiguous prefix against the working tree. */
export function findEntity(ws: WsCtx, kind: EntityKind, ref: string): EntityRecord {
  return resolveEntity(loadRepo(ws), ref, kind);
}

/* --------------------------------------------------------------------- open */

export interface OpenDraft {
  /** Timestamp to stamp the new entity with. */
  created: string;
}

/**
 * Check the repository can take a new entity, and supply the stamps it needs.
 *
 * Called before the text is composed, so an author never fills in a buffer only
 * to be told afterwards that there is nowhere to put it.
 *
 * The author is deliberately not resolved here. Asking git who is acting can
 * fail on its own account (an unconfigured `user.email`), and that is not a
 * reason to reject text the caller has not even supplied yet; callers resolve
 * it with {@link currentAuthor} at the point they build the file.
 */
export function prepareOpen(ws: WsCtx): OpenDraft {
  requireNavbook(ws);
  return { created: nowIso(ws) };
}

export interface OpenInput {
  /** The complete entity file, frontmatter included. */
  content: string;
  /** Title to slug the directory with when the file's own cannot be read. */
  fallbackTitle: string;
}

export interface OpenEntityResult {
  id: string;
  /** The new directory, relative to `.navbook/`. */
  dirPath: string;
  run: RunPlanResult;
}

/**
 * Mint an ID and lay out a new entity's directory.
 *
 * `amend` lets a caller extend the plan with work that needs the new ID —
 * recording the new issue in its parent's `subtasks`, say — so that work lands
 * in the same commit rather than a follow-up the tree is briefly wrong without.
 */
export function openEntity(
  ws: WsCtx,
  kind: EntityKind,
  input: OpenInput,
  opts: CommitOptions,
  amend?: (plan: Plan, id: string) => Plan,
): OpenEntityResult {
  // A title edited in the buffer decides the slug, so read it back.
  const title = titleOf(input.content) ?? input.fallbackTitle;
  const id = ws.mintId(scanAllIds(ws.navRoot));
  const { plan, dirPath } = planEntityOpen(kind, id, title, input.content);
  const final = amend ? amend(plan, id) : plan;
  return { id, dirPath, run: runPlan(ws, final, { commit: opts.commit }) };
}

function titleOf(content: string): string | null {
  try {
    const { fm } = parseFile(content);
    return typeof fm.title === "string" ? fm.title : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- edit */

export interface EntityEditTarget {
  entity: EntityRecord;
  /** Absolute path of the file to edit — the real file, not a scratch buffer. */
  path: string;
}

/** Locate the file behind an entity so a caller can edit it in place. */
export function resolveEntityForEdit(ws: WsCtx, kind: EntityKind, ref: string): EntityEditTarget {
  const entity = findEntity(ws, kind, ref);
  return { entity, path: absPath(ws, entity.filePath) };
}

/** Schema problems in an edited file, as messages; an unparseable file is one. */
export function revalidateEntityFile(path: string, kind: EntityKind): string[] {
  try {
    const parsed = parseFile(readFileSync(path, "utf8"));
    const problems = kind === "issue" ? validateIssue(parsed) : validatePr(parsed);
    return problems.map((problem) => problem.message);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/** Record an edit that has already been made to the entity's file. */
export function applyEntityEdit(
  ws: WsCtx,
  entity: EntityRecord,
  opts: CommitOptions,
): RunPlanResult {
  // The edited file is the operation's own output, so it belongs in the plan:
  // that is what tells the --commit guard which staged path is expected.
  const plan: Plan = {
    ops: [
      {
        op: "write",
        path: entity.filePath,
        content: readFileSync(absPath(ws, entity.filePath), "utf8"),
      },
    ],
    message: docsSubject(entity.kind, "edit", entity.id),
    trailers: [{ key: "Refs", id: entity.id }],
  };
  return runPlan(ws, plan, { commit: opts.commit });
}

/* ------------------------------------------------------------------ comment */

export interface CommentInput {
  /** The complete comment file, frontmatter included. */
  content: string;
  /** Files a review under `reviews/` rather than `comments/` (spec 02 §2.6). */
  review?: boolean;
}

export interface AddCommentResult {
  id: string;
  /** Path of the new file, relative to `.navbook/`. */
  path: string;
  run: RunPlanResult;
}

/** Add a comment or review to an entity. */
export function applyComment(
  ws: WsCtx,
  entity: EntityRecord,
  input: CommentInput,
  opts: CommitOptions,
): AddCommentResult {
  const id = ws.mintId(scanAllIds(ws.navRoot));
  const { plan, path } = planComment(entity, id, ws.now(), input.content, {
    review: input.review === true,
  });
  return { id, path, run: runPlan(ws, plan, { commit: opts.commit }) };
}

/* ------------------------------------------------------------ close/reopen */

export interface StatusChangeResult {
  entity: EntityRecord;
  /** Where the entity now lives, relative to `.navbook/`. */
  destination: string;
  run: RunPlanResult;
}

/** Move an entity to `closed/`, recording why (spec 02 §2.5). */
export function closeEntity(
  ws: WsCtx,
  kind: EntityKind,
  ref: string,
  input: CloseInput,
  opts: CommitOptions,
): StatusChangeResult {
  const repo = loadRepo(ws);
  const entity = resolveEntity(repo, ref, kind);
  if (entity.status === "closed") wsFail("precondition", `#${entity.id} is already closed`);
  if (entity.status === "merged") {
    wsFail("precondition", `#${entity.id} is merged and cannot be closed`);
  }

  const resolved: CloseInput = { ...input };
  if (resolved.duplicateOf) {
    const target = resolveEntity(repo, resolved.duplicateOf, kind);
    if (target.id === entity.id) {
      wsFail("precondition", `#${entity.id} cannot be a duplicate of itself`);
    }
    resolved.duplicateOf = target.id;
  }

  const plan = rewritePlan(entity, () => planClose(entity, resolved));
  return {
    entity,
    destination: destination(entity, "closed"),
    run: runPlan(ws, plan, { commit: opts.commit }),
  };
}

/** Move an entity back to `open/` and clear its resolution. */
export function reopenEntity(
  ws: WsCtx,
  kind: EntityKind,
  ref: string,
  opts: CommitOptions,
): StatusChangeResult {
  const entity = findEntity(ws, kind, ref);
  if (entity.status === "open") wsFail("precondition", `#${entity.id} is already open`);
  if (entity.status === "merged") {
    wsFail("precondition", `#${entity.id} is merged; a merged pull request cannot be reopened`);
  }

  const plan = rewritePlan(entity, () => planReopen(entity));
  return {
    entity,
    destination: destination(entity, "open"),
    run: runPlan(ws, plan, { commit: opts.commit }),
  };
}

/**
 * Build a plan that rewrites an entity file, turning a malformed-frontmatter
 * failure into an operational error that names the file and the way out.
 */
export function rewritePlan(entity: EntityRecord, build: () => Plan): Plan {
  try {
    return build();
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
    // A link operation rewrites its neighbours too, and it is that file the
    // user has to fix — not necessarily the one they named.
    const path = error instanceof LinkRewriteError ? error.path : entity.filePath;
    wsFail("frontmatter", `${NAVBOOK_ROOT}/${path}: ${error.message}`, [
      "fix the file by hand, or run 'nav doctor' to see what is wrong",
    ]);
  }
}

function destination(entity: EntityRecord, status: string): string {
  return `${entity.kind === "issue" ? "issues" : "prs"}/${status}/${entity.dirName}`;
}

/* ------------------------------------------------------------------- delete */

export interface EntityDeletePlan {
  entity: EntityRecord;
  /** Subtasks removed with it, deepest last; empty without `--recursive`. */
  alsoRemoved: EntityRecord[];
  /** Subtasks left behind as top-level issues, when the subtree is kept. */
  detached: EntityRecord[];
  plan: Plan;
}

export interface DeleteOptions extends CommitOptions {
  /** Remove the issue's subtasks with it, to any depth (spec 04 §4.3). */
  recursive?: boolean;
}

/**
 * Describe removing an entity's directory — spec 04 §4.3.
 *
 * Closing records how work ended; deleting says it should never have been
 * filed, which is why it takes the directory rather than moving it, and why it
 * works whatever the status. The staged-work guard runs here, ahead of any
 * question the caller asks: --commit refuses outright while unrelated work is
 * staged, and confirming a deletion that then cannot happen is worse than being
 * told why up front. {@link executeEntityDelete} checks again, against an index
 * nothing has touched in between.
 *
 * Links to whatever is removed are severed in the same plan. Without
 * `--recursive` the subtasks survive as top-level issues, which is the reading
 * that loses nothing: an issue filed under another is still work in its own
 * right, and deleting the heading is not a judgement on what was under it.
 */
export function planEntityDelete(
  ws: WsCtx,
  kind: EntityKind,
  ref: string,
  opts: DeleteOptions,
): EntityDeletePlan {
  const repo = loadRepo(ws);
  const entity = resolveEntity(repo, ref, kind);

  // Decomposition is issue-only, so deleting a pull request never rewrites an
  // issue file. A link that named it was already a fault, and once the target
  // is gone it is a D8 warning the delete subject itself accounts for.
  const links = kind === "issue" ? planDeleteLinks(repo, entity, opts.recursive === true) : null;
  const plan = rewritePlan(entity, () =>
    planDelete(entity, {
      alsoRemove: links?.alsoRemoved ?? [],
      repairs: links?.repairs ?? [],
    }),
  );
  if (opts.commit) assertNoUnrelatedStaged(ws, planPaths(plan).map(repoPath));
  return {
    entity,
    alsoRemoved: links?.alsoRemoved ?? [],
    detached: links?.detached ?? [],
    plan,
  };
}

/** What a delete takes with it, and what it has to mend on the way out. */
function planDeleteLinks(
  repo: Repo,
  entity: EntityRecord,
  recursive: boolean,
): { alsoRemoved: EntityRecord[]; detached: EntityRecord[]; repairs: LinkRepair[] } {
  const alsoRemoved = recursive ? descendantsOf(repo, entity) : [];
  const gone = new Set([entity.id, ...alsoRemoved.map((target) => target.id)]);

  const detached: EntityRecord[] = [];
  const repairs: LinkRepair[] = [];
  for (const issue of repo.issues) {
    if (gone.has(issue.id)) continue;
    const parentId = readParent(issue.fm);
    const orphaned = parentId !== null && gone.has(parentId);
    if (orphaned) detached.push(issue);

    const removeSubtasks = readSubtasks(issue.fm).filter((id) => gone.has(id));
    if (removeSubtasks.length === 0 && !orphaned) continue;
    // A third issue whose link keys cannot be read must not stand between the
    // user and the entity they asked to delete. Its stale reference becomes a
    // D8 warning, alongside the D2 error it already had.
    if (!linksReadable(issue)) continue;
    repairs.push({
      entity: issue,
      edit: { removeSubtasks, ...(orphaned ? { parent: null } : {}) },
    });
  }

  return { alsoRemoved, detached, repairs };
}

/**
 * Paths a deletion would destroy irrecoverably — work git could not give back,
 * as opposed to content merely removed from the tree.
 *
 * Separate from {@link planEntityDelete} because it is the expensive part: it
 * is a full `git status` including untracked files, and a caller that will not
 * stop to ask has no use for the answer. Every directory the plan removes is
 * scanned, so a recursive delete asks about the whole subtree.
 */
export function uncommittedUnder(ws: WsCtx, deletion: EntityDeletePlan): string[] {
  const roots = [deletion.entity, ...deletion.alsoRemoved].map((target) =>
    repoPath(target.dirPath),
  );
  return uncommittedPaths(ws.repoRoot, roots);
}

/** Carry out a delete the caller has decided to go ahead with. */
export function executeEntityDelete(
  ws: WsCtx,
  deletion: EntityDeletePlan,
  opts: CommitOptions,
): RunPlanResult {
  return runPlan(ws, deletion.plan, { commit: opts.commit });
}
