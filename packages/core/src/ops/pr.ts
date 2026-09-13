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
import {
  type MergedBlock,
  type Plan,
  planMergedBlock,
  planPrUpdate,
  planRequest,
  type RequestResult,
  RevisionUnchangedError,
} from "../core/ops.ts";
import { parsePerson, sameEmail } from "../core/person.ts";
import type { ReviewPolicyReading } from "../core/policy.ts";
import { matchesQuery, type Query } from "../core/query.ts";
import { type ReviewSummary, reviewSummary } from "../core/review.ts";
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
  batchResolve,
  catBlobs,
  listBranchRefs,
  lsTreeNames,
  lsTreeNamesOfTree,
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
  readReviewPolicy,
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
    plan = rewritePlan(ws.navDir, entity, () => {
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

/* ------------------------------------------------------ review requests */

export interface RequestReviewResult {
  entity: EntityRecord;
  /** The people this changed the file for, as it now spells them. */
  changed: string[];
  /** The people it already agreed about. */
  unchanged: string[];
  run: RunPlanResult;
}

/**
 * Ask people to review a pull request, or take them off the list (spec 02 §2.7).
 *
 * Requesting a review from the author is refused. It is a mistake essentially
 * every time — the reviewers block ignores them, so the request could never be
 * answered — and refusing here is cheaper than explaining an entry that never
 * changes. A file that names them anyway stays valid: doctor enforces the
 * spec, not this command's manners.
 */
export function requestReview(
  ws: WsCtx,
  ref: string,
  people: readonly string[],
  opts: CommitOptions & { remove?: boolean },
): RequestReviewResult {
  const entity = findEntity(ws, "pr", ref);
  const author = typeof entity.fm.author === "string" ? entity.fm.author : "";
  if (!opts.remove) {
    // Only what this command is being asked to write: a `reviewer` entry
    // somebody typed by hand and got wrong is doctor's business, and refusing
    // to act on the file until they fix it would help nobody.
    const nonsense = people.filter((person) => parsePerson(person) === null);
    if (nonsense.length > 0) {
      wsFail("invalid-input", `'${nonsense[0]}' is not a person`, [
        "a reviewer is an address, optionally with a name: 'alice@example.com' or 'Alice <alice@example.com>'",
        "a review is answered by somebody, so there is no way to write down a team (§2.7)",
      ]);
    }
    if (author !== "") {
      const own = people.filter((person) => sameEmail(emailOf(person), emailOf(author)));
      if (own.length > 0) {
        wsFail("precondition", `#${entity.id} is ${author}'s own pull request`, [
          "a pull request's author is not among its reviewers, so the request would never be answered",
        ]);
      }
    }
  }

  // The callback either returns or throws, so the result is set by the time
  // `rewritePlan` hands the plan back.
  let result!: RequestResult;
  const plan = rewritePlan(ws.navDir, entity, () => {
    result = planRequest(entity, people, { remove: opts.remove === true });
    return result.plan;
  });
  const { changed, unchanged } = result;
  if (changed.length === 0) {
    // Nothing to write, so nothing is written: an empty commit saying a file
    // already said what it says would be noise in a history people read.
    const verb = opts.remove ? "is not asked to review" : "is already asked to review";
    if (unchanged.length === 1) {
      wsFail("precondition", `${unchanged[0]} ${verb} #${entity.id}`);
    }
    wsFail(
      "precondition",
      `every one of them ${opts.remove ? "is already off" : "is already on"} the reviewers of #${entity.id}`,
      unchanged.map((person) => `  ${person}`),
    );
  }

  return { entity, changed, unchanged, run: runPlan(ws, plan, { commit: opts.commit }) };
}

/** The address a person string identifies, for comparing two spellings of one. */
function emailOf(person: string): string {
  return parsePerson(person)?.email ?? person;
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
  // Read once for the whole scan, and from here rather than from each ref: a
  // pull request is counted by how this checkout counts (spec 02 §2.10).
  const { policy } = readReviewPolicy(ws);
  return scanRefsForOpenPrs(ws).filter((entry) => matchesQuery(query, entry.entity, policy));
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
    const dirs = lsTreeNames(cwd, ref.full, `${ws.navDir}/${PR_OPEN_DIR}`).filter(
      (name) => name !== ".gitkeep",
    );
    if (dirs.length === 0) continue;

    for (const dirName of dirs) {
      const dirPath = `${ws.navDir}/${PR_OPEN_DIR}/${dirName}`;
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

/**
 * How many open pull requests sit on branches other than the one checked out.
 *
 * A count, and deliberately nothing more: spec 03 §3.1 forbids aggregating
 * tracker state across branches, so this answers only "is there something
 * `--all-refs` would show you?". Without it an empty listing reads as "there
 * are none" when the pull requests are merely on their own source branches,
 * which is where spec 03 §3.5 puts them — the usual shape of a repository
 * whose branches are checked out in separate worktrees.
 *
 * Cheap by construction: one `cat-file --batch-check` resolves every branch's
 * `prs/open` directory at once, and only the distinct trees that come back are
 * listed, so branches sharing a merge-base cost one read between them. No
 * `pr.md` is parsed, so the price does not grow with the number of PRs.
 */
export function countOpenPrsOnOtherRefs(ws: WsCtx): number {
  const cwd = ws.repoRoot;
  const here = currentBranch(cwd);
  const dir = `${ws.navDir}/${PR_OPEN_DIR}`;
  const refs = listBranchRefs(cwd);

  const trees = batchResolve(
    cwd,
    refs.map((ref) => `${ref.full}:${dir}`),
  );
  const listed = new Map<string, string[]>();
  const namesOf = (tree: string): string[] => {
    const cached = listed.get(tree);
    if (cached) return cached;
    const names = lsTreeNamesOfTree(cwd, tree);
    listed.set(tree, names);
    return names;
  };

  const mine = new Set<string>();
  const elsewhere = new Set<string>();
  for (const ref of refs) {
    const tree = trees.get(`${ref.full}:${dir}`);
    if (tree === undefined) continue;
    for (const name of namesOf(tree)) {
      if (name === ".gitkeep") continue;
      // Directories are `<id>-<slug>` and the ID alone is the reference (spec
      // 02 §2.2), so one pull request on ten branches is still one.
      const id = name.split("-")[0];
      if (id) (ref.short === here ? mine : elsewhere).add(id);
    }
  }
  // A pull request on the checked-out branch is not elsewhere, however many
  // other refs — its own `origin/` copy, most often — also carry it.
  for (const id of mine) elsewhere.delete(id);
  return elsewhere.size;
}

export function stringField(entity: EntityRecord, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------- merge */

export type MergeStrategy = "fast-forward" | "merge-commit";

/**
 * Where the pull request stands against the policy this repository declares.
 *
 * Carried on the plan rather than left for the caller to work out, because the
 * reviews live on the source branch and by the time a front end holds a result
 * the pull request has been archived. It is reported, never acted on: spec 02
 * §2.7 forbids refusing a merge on the strength of a review state, and spec 02
 * §2.10 keeps a declared policy within that.
 */
export interface MergeReview {
  /** The policy the marker declares, and any fault found reading it. */
  reading: ReviewPolicyReading;
  /** The pull request's review state, counted by that policy. */
  summary: ReviewSummary;
}

export interface MergePlan {
  entity: EntityRecord;
  /** The branch carrying the pull request's commits. */
  sourceRef: string;
  /** The checked-out branch it merges into. */
  targetBranch: string;
  strategy: MergeStrategy;
  /** The merge commit message, unused by a fast-forward. */
  message: string;
  /** What the reviews say, for a caller that wants to mention it. */
  review: MergeReview;
}

export interface MergeResult {
  entity: EntityRecord;
  /** The merge commit, or null when the branch fast-forwarded. */
  mergeSha: string | null;
  /** Where the pull request now lives, relative to the Navbook directory. */
  dirPath: string;
  /** What the reviews said when the merge was made. */
  review: MergeReview;
}

/** Read a pull request's review state against the working tree's policy. */
function mergeReview(ws: WsCtx, entity: EntityRecord): MergeReview {
  const reading = readReviewPolicy(ws);
  return { reading, summary: reviewSummary(entity, reading.policy) };
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
    review: mergeReview(ws, entity),
  };
}

/** Carry out a merge the caller has decided to go ahead with. */
export function executePrMerge(ws: WsCtx, plan: MergePlan): MergeResult {
  if (plan.strategy === "fast-forward") {
    // A fast-forward creates no commit to carry the move, so the archive
    // happens in the immediate follow-up commit that spec 02 §2.8 allows.
    fastForward(ws.repoRoot, plan.sourceRef);
    return recordMergedBlock(ws, archiveIntoIndex(ws, plan.entity.id), null, plan.review);
  }

  if (mergeNoCommit(ws.repoRoot, plan.sourceRef) === "conflict") conflictStop(ws, plan.entity.id);
  // The move is staged into the merge itself (04 §4.3), so the commit that
  // lands the branch is also the commit that files the discussion as merged.
  const archived = archiveIntoIndex(ws, plan.entity.id);
  return recordMergedBlock(ws, archived, commitMerge(ws.repoRoot, plan.message), plan.review);
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
  // Read before the archive moves the directory, so the reviews are still
  // where the entity says they are.
  const review = mergeReview(ws, entity);
  const inProgress = isMergeInProgress(ws.repoRoot);
  const archived = archiveIntoIndex(ws, entity.id);
  const mergeSha = inProgress
    ? commitMerge(ws.repoRoot, mergeMessage(entity))
    : (resolveSha(ws.repoRoot, "HEAD") ?? null);
  return recordMergedBlock(ws, archived, mergeSha, review);
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
  stage(ws, [repoPath(ws.navDir, entity.dirPath), repoPath(ws.navDir, targetDir)]);
  return { ...entity, status: "merged", dirPath: targetDir, filePath: `${targetDir}/pr.md` };
}

/**
 * Record the `merged:` block in a follow-up commit. A merge commit cannot name
 * its own SHA, so this step is necessarily separate (spec 02 §2.7).
 */
function recordMergedBlock(
  ws: WsCtx,
  entity: EntityRecord,
  mergeSha: string | null,
  review: MergeReview,
): MergeResult {
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
      `#${entity.id} merged, but ${ws.navDir}/${entity.filePath} could not be updated`,
      [
        `  ${error instanceof Error ? error.message : String(error)}`,
        "the merge itself is committed; fix the file and commit the 'merged:' block by hand",
      ],
    );
  }
  applyOps(ws, plan.ops);
  commit(ws.repoRoot, composeMessage(plan.message, plan.trailers));
  return { entity, mergeSha, dirPath: entity.dirPath, review };
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
  const repo = loadRepo(ws, { comments: "none" });
  const wanted = asId(ref).toLowerCase();
  const present = allEntities(repo).some(
    (entity) => entity.kind === "pr" && entity.id.startsWith(wanted),
  );
  return present ? null : materializeFromRef(ws, ref);
}

/** Check a pull request's directory out of the branch that carries it. */
function materializeFromRef(ws: WsCtx, ref: string): Materialized {
  const { entity, sourceRef } = locatePr(ws, ref);
  const path = `${ws.navDir}/${entity.dirPath}`;
  if (gitMaybe(["checkout", sourceRef, "--", path], { cwd: ws.repoRoot }) === null) {
    wsFail("not-found", `could not read ${path} from '${sourceRef}'`);
  }
  add(ws.repoRoot, [path]);
  return { id: entity.id, ref: sourceRef };
}
