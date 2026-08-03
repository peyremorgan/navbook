/**
 * Pull request operations — spec 04 §4.3.
 *
 * The shared verbs come from `entity.ts`; this module adds the three that only
 * pull requests have (`update`, `review`, `merge`) and the parts of the shared
 * verbs that must reach across branches, because a PR's files live on the
 * branch it proposes to merge (spec 03 §3.5).
 */

import { type Revision, readRevisions } from "../core/files.ts";
import { MIN_PREFIX_LENGTH, resolvePrefix } from "../core/id.ts";
import { NAVBOOK_ROOT } from "../core/json.ts";
import {
  type MergedBlock,
  type Plan,
  planMergedBlock,
  planPrUpdate,
  RevisionUnchangedError,
} from "../core/ops.ts";
import { matchesQuery, type Query } from "../core/query.ts";
import { allEntities, type EntityRecord, parseTree } from "../core/tree.ts";
import { gitMaybe } from "../git/exec.ts";
import { isAncestor, mergeBase, objectExists } from "../git/history.ts";
import { add, commit, composeMessage } from "../git/index-ops.ts";
import {
  canFastForward,
  commitMerge,
  conflictedPaths,
  fastForward,
  isAlreadyMerged,
  mergeHead,
  mergeNoCommit,
} from "../git/merge.ts";
import {
  catBlobs,
  listBranchRefs,
  lsTreeNames,
  lsTreeRecursive,
  type Ref,
} from "../git/refscan.ts";
import {
  currentBranch,
  defaultBranch,
  isMergeInProgress,
  isTreeClean,
  resolveSha,
} from "../git/repo.ts";
import {
  applyOps,
  asId,
  currentAuthor,
  loadRepo,
  nowIso,
  type RunPlanResult,
  repoPath,
  requireNavbook,
  runPlan,
  stage,
  type WsCtx,
  wsFail,
} from "../workspace/index.ts";
import {
  type CommitOptions,
  findEntity,
  type OpenEntityResult,
  type OpenInput,
  openEntity,
  rewritePlan,
} from "./entity.ts";

const PR_OPEN_DIR = "prs/open";

/* --------------------------------------------------------------------- open */

export interface PrOpenDraft {
  /** Branch the pull request rides on. */
  source: string;
  /** Branch it proposes to merge into. */
  target: string;
  head: string;
  base: string;
  created: string;
  /** The pull request's title: the caller's, or the last commit's subject. */
  title: string;
  /** The first revision, ready to record. */
  revision: Revision;
}

/**
 * Work out everything a new pull request needs from git, and check the branch
 * is in a state that can carry one.
 *
 * As with {@link prepareOpen}, the author is left to the caller: resolving it
 * can fail for its own reasons, and that should not pre-empt a complaint about
 * the text itself.
 */
export function preparePrOpen(
  ws: WsCtx,
  opts: { target?: string; title?: string } = {},
): PrOpenDraft {
  requireNavbook(ws);
  const source = currentBranch(ws.repoRoot);
  if (!source) {
    wsFail("precondition", "HEAD is detached; check out the branch the pull request rides on");
  }

  const target = opts.target ?? defaultBranch(ws.repoRoot);
  if (!target) wsFail("precondition", "could not determine a target branch; pass --target");
  if (target === source) {
    wsFail("precondition", `a pull request cannot target its own branch (${source})`);
  }

  const head = resolveSha(ws.repoRoot, "HEAD");
  if (!head) wsFail("precondition", "this branch has no commits yet");
  const base = mergeBase(ws.repoRoot, "HEAD", target);
  if (!base) {
    wsFail("precondition", `'${target}' does not exist, or shares no history with ${source}`);
  }

  const created = nowIso(ws);
  return {
    source,
    target,
    head,
    base,
    created,
    // Only ask git for a subject when there is no title to use it for.
    title: opts.title ?? lastCommitSubject(ws) ?? source,
    revision: { head, base, date: created },
  };
}

/** Open a pull request from a composed file. */
export function openPr(ws: WsCtx, input: OpenInput, opts: CommitOptions): OpenEntityResult {
  return openEntity(ws, "pr", input, opts);
}

function lastCommitSubject(ws: WsCtx): string | null {
  const subject = gitMaybe(["log", "-1", "--format=%s"], { cwd: ws.repoRoot });
  return subject === null || subject === "" ? null : subject;
}

/* ------------------------------------------------------------------- update */

export interface PrUpdateResult {
  entity: EntityRecord;
  head: string;
  /** How many revisions the pull request has after this one. */
  revisionCount: number;
  run: RunPlanResult;
}

/** Append a revision pinning the current HEAD (spec 02 §2.7). */
export function updatePr(ws: WsCtx, ref: string, opts: CommitOptions): PrUpdateResult {
  const entity = findEntity(ws, "pr", ref);
  if (entity.status !== "open") {
    wsFail(
      "precondition",
      `#${entity.id} is ${entity.status}; only open pull requests take updates`,
    );
  }

  const head = resolveSha(ws.repoRoot, "HEAD");
  if (!head) wsFail("precondition", "this branch has no commits yet");
  const target = typeof entity.fm.target === "string" ? entity.fm.target : null;
  const base = target ? mergeBase(ws.repoRoot, "HEAD", target) : null;
  if (!base) {
    wsFail(
      "precondition",
      `could not compute a merge base with '${target ?? "the target branch"}'`,
    );
  }

  let plan: Plan;
  try {
    plan = planPrUpdate(entity, { head, base, date: nowIso(ws) });
  } catch (error) {
    if (error instanceof RevisionUnchangedError) wsFail("precondition", error.message);
    plan = rewritePlan(entity, () => {
      throw error;
    });
  }

  return {
    entity,
    head,
    revisionCount: readRevisions(entity.fm).length + 1,
    run: runPlan(ws, plan, { commit: opts.commit }),
  };
}

/* ------------------------------------------------------------------- review */

/**
 * The revision a review binds to: a named one, or the latest recorded.
 *
 * A review is evidence about a specific state of the branch (spec 02 §2.7), so
 * a pull request with no recorded revision has nothing to bind to.
 *
 * An empty `wanted` counts as naming nothing, not as a prefix every revision
 * starts with — otherwise `--revision ""` would report the pull request's own
 * revisions back as an ambiguity.
 */
export function bindReviewRevision(entity: EntityRecord, wanted?: string): string {
  const heads = readRevisions(entity.fm).map((revision) => revision.head);
  if (!wanted) {
    const latest = heads[heads.length - 1];
    if (!latest) {
      wsFail("precondition", `#${entity.id} has no recorded revision to bind this review to`);
    }
    return latest;
  }

  const matches = heads.filter((head) => head.startsWith(wanted.toLowerCase()));
  if (matches.length === 1) return matches[0] as string;
  if (matches.length === 0) {
    wsFail(
      "not-found",
      `#${entity.id} has no recorded revision starting with '${wanted}'`,
      heads.map((head) => `  ${head}`),
    );
  }
  wsFail("ambiguous", `'${wanted}' matches ${matches.length} recorded revisions of #${entity.id}`);
}

/* --------------------------------------------------------------------- list */

export interface FoundPr {
  entity: EntityRecord;
  refs: Ref[];
}

/** Open pull requests on any fetched branch, matching a query. */
export function listPrsAcrossRefs(ws: WsCtx, query: Query): FoundPr[] {
  return scanRefsForOpenPrs(ws).filter((entry) => matchesQuery(query, entry.entity));
}

/**
 * Enumerate open pull requests across local and fetched remote branches.
 *
 * The target branch does not show open PRs — they live on their source branches
 * — so this is how they are discovered (spec 03 §3.5). Local refs win when the
 * same PR appears on several, and every ref it was found on is reported: this
 * is the state of the branches you have fetched, not an aggregate truth.
 */
export function scanRefsForOpenPrs(ws: WsCtx): FoundPr[] {
  const cwd = ws.repoRoot;
  const refs = listBranchRefs(cwd);
  const byId = new Map<string, FoundPr>();

  for (const ref of refs) {
    const dirs = lsTreeNames(cwd, ref.full, `${NAVBOOK_ROOT}/${PR_OPEN_DIR}`).filter(
      (name) => name !== ".gitkeep",
    );
    if (dirs.length === 0) continue;

    for (const dirName of dirs) {
      const dirPath = `${NAVBOOK_ROOT}/${PR_OPEN_DIR}/${dirName}`;
      const paths = lsTreeRecursive(cwd, ref.full, dirPath);
      if (paths.length === 0) continue;

      const blobs = catBlobs(
        cwd,
        paths.map((path) => ({ ref: ref.full, path: `${dirPath}/${path}` })),
      );
      const files = new Map<string, string>();
      for (const path of paths) {
        const content = blobs.get(`${ref.full}:${dirPath}/${path}`);
        if (content !== undefined) files.set(`${PR_OPEN_DIR}/${dirName}/${path}`, content);
      }

      const entity = parseTree(files).prs[0];
      if (!entity) continue;

      const existing = byId.get(entity.id);
      if (!existing) {
        byId.set(entity.id, { entity, refs: [ref] });
      } else {
        // Prefer the copy on a local branch: it is the one you can act on.
        if (!ref.remote && existing.refs.every((seen) => seen.remote)) existing.entity = entity;
        existing.refs.push(ref);
      }
    }
  }
  return [...byId.values()];
}

export function stringField(entity: EntityRecord, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------- merge */

export type MergeStrategy = "fast-forward" | "merge-commit";

export interface MergePlan {
  entity: EntityRecord;
  /** The branch carrying the pull request's commits. */
  sourceRef: string;
  /** The checked-out branch it merges into. */
  targetBranch: string;
  strategy: MergeStrategy;
  /** The merge commit message, unused by a fast-forward. */
  message: string;
}

export interface MergeResult {
  entity: EntityRecord;
  /** The merge commit, or null when the branch fast-forwarded. */
  mergeSha: string | null;
  /** Where the pull request now lives, relative to `.navbook/`. */
  dirPath: string;
}

/** Check a merge can proceed and decide how it would be performed. */
export function planPrMerge(ws: WsCtx, ref: string, opts: { noFf?: boolean } = {}): MergePlan {
  if (isMergeInProgress(ws.repoRoot)) {
    wsFail("precondition", "a merge is already in progress", [
      "finish it with 'nav pr merge --continue', or 'git merge --abort'",
    ]);
  }
  if (!isTreeClean(ws.repoRoot)) {
    wsFail("precondition", "the working tree has changes; commit or stash them before merging");
  }

  const branch = currentBranch(ws.repoRoot);
  if (!branch) wsFail("precondition", "HEAD is detached; check out the target branch");

  const { entity, sourceRef } = locatePr(ws, ref);
  const target = stringField(entity, "target");
  if (target !== branch) {
    wsFail("precondition", `#${entity.id} targets '${target}', but '${branch}' is checked out`, [
      `run 'git checkout ${target}' first`,
    ]);
  }
  if (isAlreadyMerged(ws.repoRoot, sourceRef)) {
    wsFail("precondition", `#${entity.id} is already contained in ${branch}`, [
      "if it merged without being archived, run 'nav doctor --fix'",
    ]);
  }

  const fastForwardable = opts.noFf !== true && canFastForward(ws.repoRoot, sourceRef);
  return {
    entity,
    sourceRef,
    targetBranch: branch,
    strategy: fastForwardable ? "fast-forward" : "merge-commit",
    message: mergeMessage(entity),
  };
}

/** Carry out a merge the caller has decided to go ahead with. */
export function executePrMerge(ws: WsCtx, plan: MergePlan): MergeResult {
  if (plan.strategy === "fast-forward") {
    // A fast-forward creates no commit to carry the move, so the archive
    // happens in the immediate follow-up commit that spec 02 §2.8 allows.
    fastForward(ws.repoRoot, plan.sourceRef);
    return recordMergedBlock(ws, archiveIntoIndex(ws, plan.entity.id), null);
  }

  if (mergeNoCommit(ws.repoRoot, plan.sourceRef) === "conflict") conflictStop(ws, plan.entity.id);
  // The move is staged into the merge itself (04 §4.3), so the commit that
  // lands the branch is also the commit that files the discussion as merged.
  const archived = archiveIntoIndex(ws, plan.entity.id);
  return recordMergedBlock(ws, archived, commitMerge(ws.repoRoot, plan.message));
}

/** Finish a merge that was interrupted by conflicts. */
export function continuePrMerge(ws: WsCtx, ref?: string): MergeResult {
  if (isMergeInProgress(ws.repoRoot)) {
    const conflicts = conflictedPaths(ws.repoRoot);
    if (conflicts.length > 0) {
      wsFail("merge-unresolved", "the merge still has unresolved conflicts", [
        ...conflicts.map((path) => `  ${path}`),
        "resolve them, 'git add' each one, then run 'nav pr merge --continue' again",
      ]);
    }
  }

  const entity = pendingMergePr(ws, ref);
  const inProgress = isMergeInProgress(ws.repoRoot);
  const archived = archiveIntoIndex(ws, entity.id);
  const mergeSha = inProgress
    ? commitMerge(ws.repoRoot, mergeMessage(entity))
    : (resolveSha(ws.repoRoot, "HEAD") ?? null);
  return recordMergedBlock(ws, archived, mergeSha);
}

function mergeMessage(entity: EntityRecord): string {
  return composeMessage(`Merge #${entity.id}: ${stringField(entity, "title")}`, [
    { key: "Refs", id: entity.id },
  ]);
}

/** The PR whose source branch this in-progress merge is bringing in. */
function pendingMergePr(ws: WsCtx, ref: string | undefined): EntityRecord {
  if (ref) return locatePr(ws, ref).entity;

  const incoming = mergeHead(ws.repoRoot);
  if (!incoming) {
    wsFail("merge-ambiguous", "no merge is in progress and no pull request was named", [
      "pass the ID: nav pr merge --continue <id>",
    ]);
  }
  const candidates = scanRefsForOpenPrs(ws).filter((entry) => {
    const revisions = readRevisions(entry.entity.fm);
    const head = revisions[revisions.length - 1]?.head;
    return (
      head !== undefined &&
      objectExists(ws.repoRoot, head) &&
      isAncestor(ws.repoRoot, head, incoming)
    );
  });
  const first = candidates[0];
  if (!first || candidates.length > 1) {
    wsFail("merge-ambiguous", "could not tell which pull request this merge belongs to", [
      "pass the ID: nav pr merge --continue <id>",
    ]);
  }
  return first.entity;
}

/**
 * Move the pull request into `prs/merged/` and stage the move without
 * committing, so the commit that lands the branch is also the commit that
 * files the discussion as merged (spec 04 §4.3).
 */
function archiveIntoIndex(ws: WsCtx, id: string): EntityRecord {
  const entity = loadRepo(ws).byId.get(id);
  if (entity?.kind !== "pr") {
    wsFail(
      "precondition",
      `#${id} did not arrive on this branch; the merge may not have carried its files`,
    );
  }
  if (entity.status === "merged") return entity;

  const targetDir = `prs/merged/${entity.dirName}`;
  applyOps(ws, [{ op: "move", from: entity.dirPath, to: targetDir }]);
  stage(ws, [repoPath(entity.dirPath), repoPath(targetDir)]);
  return { ...entity, status: "merged", dirPath: targetDir, filePath: `${targetDir}/pr.md` };
}

/**
 * Record the `merged:` block in a follow-up commit. A merge commit cannot name
 * its own SHA, so this step is necessarily separate (spec 02 §2.7).
 */
function recordMergedBlock(ws: WsCtx, entity: EntityRecord, mergeSha: string | null): MergeResult {
  const merged: MergedBlock = {
    date: nowIso(ws),
    by: currentAuthor(ws),
    ...(mergeSha ? { commit: mergeSha } : {}),
  };

  let plan: Plan;
  try {
    plan = planMergedBlock(entity, merged);
  } catch (error) {
    // The branch is already merged at this point, so say plainly what is left.
    wsFail(
      "precondition",
      `#${entity.id} merged, but ${NAVBOOK_ROOT}/${entity.filePath} could not be updated`,
      [
        `  ${error instanceof Error ? error.message : String(error)}`,
        "the merge itself is committed; fix the file and commit the 'merged:' block by hand",
      ],
    );
  }
  applyOps(ws, plan.ops);
  commit(ws.repoRoot, composeMessage(plan.message, plan.trailers));
  return { entity, mergeSha, dirPath: entity.dirPath };
}

/**
 * Leave the merge in progress and say exactly how to finish it. The merge is
 * not aborted: the author's conflict resolution is worth keeping, and
 * `--continue` performs the archive step they would otherwise have to remember.
 */
function conflictStop(ws: WsCtx, id: string): never {
  wsFail("merge-conflict", `merging #${id} produced conflicts`, [
    ...conflictedPaths(ws.repoRoot).map((path) => `  ${path}`),
    "resolve them, 'git add' each one, then run 'nav pr merge --continue'",
    "or abandon the merge with 'git merge --abort'",
  ]);
}

export interface LocatedPr {
  entity: EntityRecord;
  sourceRef: string;
}

/**
 * Find a pull request for merging. It normally lives on another branch, so the
 * working tree is searched first and the refs afterwards.
 */
export function locatePr(ws: WsCtx, ref: string): LocatedPr {
  const found = scanRefsForOpenPrs(ws);
  const resolution = resolvePrefix(
    asId(ref),
    found.map((entry) => entry.entity.id),
  );
  if (!resolution.ok) {
    switch (resolution.reason) {
      case "too-short":
        wsFail(
          "prefix-too-short",
          `'${ref}' is too short; ID prefixes must be at least ${MIN_PREFIX_LENGTH} characters`,
        );
        break;
      case "not-found":
        wsFail("not-found", `no open pull request matches '${ref}' on any fetched branch`);
        break;
      default:
        wsFail(
          "ambiguous",
          `'${ref}' is ambiguous; ${resolution.matches.length} pull requests match`,
          resolution.matches.map((id) => {
            const match = found.find((entry) => entry.entity.id === id);
            return `  #${id}  ${match ? stringField(match.entity, "title") : ""}`;
          }),
        );
    }
  }

  const entry = found.find((candidate) => candidate.entity.id === resolution.id) as FoundPr;
  // `source:` is only SHOULD, so fall back to a local ref before a remote one:
  // a local branch is the copy the user can actually merge.
  const declared = stringField(entry.entity, "source");
  const sourceRef =
    entry.refs.find((candidate) => candidate.short === declared)?.short ??
    entry.refs.find((candidate) => !candidate.remote)?.short ??
    (entry.refs[0]?.short as string);
  return { entity: entry.entity, sourceRef };
}

/* --------------------------------------------------------------------- close */

export interface Materialized {
  id: string;
  ref: string;
}

/**
 * Bring a pull request onto this branch if it is not already here, so it can
 * be declined — spec 02 §2.8.
 *
 * A PR's files usually live on its source branch, so closing one from the
 * default branch means first checking its directory out of the ref that has
 * it. Returns null when the entity is already present and nothing was done.
 * The close itself is the ordinary shared verb, run afterwards.
 */
export function materializePrIfAbsent(ws: WsCtx, ref: string): Materialized | null {
  const repo = loadRepo(ws, { includeComments: false });
  const wanted = asId(ref).toLowerCase();
  const present = allEntities(repo).some(
    (entity) => entity.kind === "pr" && entity.id.startsWith(wanted),
  );
  return present ? null : materializeFromRef(ws, ref);
}

/** Check a pull request's directory out of the branch that carries it. */
function materializeFromRef(ws: WsCtx, ref: string): Materialized {
  const { entity, sourceRef } = locatePr(ws, ref);
  const path = `${NAVBOOK_ROOT}/${entity.dirPath}`;
  if (gitMaybe(["checkout", sourceRef, "--", path], { cwd: ws.repoRoot }) === null) {
    wsFail("not-found", `could not read ${path} from '${sourceRef}'`);
  }
  add(ws.repoRoot, [path]);
  return { id: entity.id, ref: sourceRef };
}
