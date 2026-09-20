/**
 * Pull request operations — spec 04 §4.3.
 *
 * The shared verbs come from `entity.ts`; this module adds the three that only
 * pull requests have (`update`, `review`, `merge`) and the parts of the shared
 * verbs that must reach across branches, because a PR's files live on the
 * branch it proposes to merge (spec 03 §3.5).
 */

import { type Revision, readRevisions } from "../core/files.ts";
import { parseDoc, stringAt } from "../core/frontmatter.ts";
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
import {
  type MergeMethod,
  type MergePolicyReading,
  type ReviewPolicyReading,
  rewritesSource,
} from "../core/policy.ts";
import { matchesQuery, type Query } from "../core/query.ts";
import { type ReviewSummary, reviewSummary } from "../core/review.ts";
import { allEntities, type EntityRecord, parseTree, type Repo } from "../core/tree.ts";
import { gitMaybe } from "../git/exec.ts";
import { isAncestor, mergeBase, objectExists } from "../git/history.ts";
import { add, commit, composeMessage } from "../git/index-ops.ts";
import {
  canFastForward,
  commitMerge,
  conflictedPaths,
  continueReplay,
  fastForward,
  isAlreadyMerged,
  mergeHead,
  mergeNoCommit,
  replayOnto,
  squashMerge,
} from "../git/merge.ts";
import {
  clearPendingMerge,
  type MergeStage,
  type PendingMerge,
  readPendingMerge,
  writePendingMerge,
} from "../git/merge-state.ts";
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
  checkoutBranch,
  currentBranch,
  defaultBranch,
  isMergeInProgress,
  isReplayInProgress,
  isTreeClean,
  resolveSha,
  updateBranch,
  worktreeHolding,
} from "../git/repo.ts";
import {
  applyOps,
  asId,
  currentAuthor,
  loadRepo,
  nowIso,
  type RunPlanResult,
  readMergePolicy,
  readReviewPolicy,
  repoPath,
  requireNavbook,
  resolveEntity,
  runPlan,
  stage,
  WorkspaceError,
  type WsCtx,
  wsFail,
} from "../workspace/index.ts";
import {
  type CommitOptions,
  type OpenEntityResult,
  type OpenInput,
  openEntity,
  rewritePlan,
} from "./entity.ts";

const PR_OPEN_DIR = "prs/open";
/** Where a pull request sits once it is no longer in flight (spec 02 §2.1). */
const PR_SETTLED_DIRS = ["prs/merged", "prs/closed"] as const;

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
  const entity = findPrToWrite(ws, ref);
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
  const entity = findPrToWrite(ws, ref);
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

/**
 * Open pull requests on any fetched branch, matching a query.
 *
 * The enumeration is filtered before the query runs: a listing answers "what is
 * still in flight?", so a pull request its target branch has already merged or
 * closed does not belong in it, however many source branches still carry the
 * copy that was current before the merge.
 */
export function listPrsAcrossRefs(ws: WsCtx, query: Query): FoundPr[] {
  // Read once for the whole scan, and from here rather than from each ref: a
  // pull request is counted by how this checkout counts (spec 02 §2.10).
  const { policy } = readReviewPolicy(ws);
  const found = dropSettledOnTarget(ws, listBranchRefs(ws.repoRoot), scanRefsForOpenPrs(ws));
  return found.filter((entry) => matchesQuery(query, entry.entity, policy));
}

/**
 * Enumerate open pull requests across local and fetched remote branches.
 *
 * The target branch does not show open PRs — they live on their source branches
 * — so this is how they are discovered (spec 03 §3.5). Local refs win when the
 * same PR appears on several, and every ref it was found on is reported: this
 * is the state of the branches you have fetched, not an aggregate truth.
 *
 * Deliberately unfiltered — it reports what the refs say, including the open
 * copy a source branch still carries after its merge. Listing drops those
 * ({@link dropSettledOnTarget}); merging wants to see them, so that a second
 * `nav pr merge` can say the branch is already contained rather than that the
 * pull request cannot be found.
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
 * The ref entitled to answer for a pull request: the branch it targets, which
 * is where the merge files it as merged (spec 03 §3.5). The local copy is
 * preferred, then any remote-tracking one.
 */
function targetRefOf(refs: readonly Ref[], target: string): string | undefined {
  if (target === "") return undefined;
  const local = refs.find((ref) => !ref.remote && ref.short === target);
  if (local) return local.full;
  // A remote-tracking copy is `<remote>/<target>`, the remote being the first
  // path segment — so `origin/release/dev` is not the branch `dev`.
  return refs.find((ref) => ref.remote && ref.short.slice(ref.short.indexOf("/") + 1) === target)
    ?.full;
}

/**
 * Drop pull requests that the branch answering for them has already settled.
 *
 * Not an aggregation of tracker state — spec 03 §3.1 forbids that — but the
 * opposite: each pull request's status is read from the one branch entitled to
 * report it, its target, plus the default branch that is the tracker of record.
 * The copy under `prs/open/` on a source branch is a snapshot taken before the
 * merge, so a branch that has not merged or rebased since has simply not heard
 * the news; it is the stale half of the "exactly one status directory"
 * invariant (spec 03 §3.4), and reading it as current is what made every
 * branch left behind after its merge report its pull request as still in
 * flight. Consulting only those two refs is also what keeps a speculative
 * close on some unrelated feature branch from settling anything.
 */
function dropSettledOnTarget(ws: WsCtx, refs: readonly Ref[], found: FoundPr[]): FoundPr[] {
  if (found.length === 0) return found;
  const settled = settledOnTargets(
    ws,
    refs,
    found.map((entry) => stringField(entry.entity, "target")),
  );
  return settled.size === 0 ? found : found.filter((entry) => !settled.has(entry.entity.id));
}

/**
 * The IDs settled on the default branch or on any of `targets`.
 *
 * Shared by the listing and by the count that points at it, so the two cannot
 * disagree about what is still in flight.
 */
function settledOnTargets(
  ws: WsCtx,
  refs: readonly Ref[],
  targets: readonly string[],
): Set<string> {
  const consult = new Set<string>();
  const record = defaultBranch(ws.repoRoot);
  const recordRef = record === null ? undefined : targetRefOf(refs, record);
  if (recordRef) consult.add(recordRef);
  for (const target of targets) {
    const ref = targetRefOf(refs, target);
    if (ref) consult.add(ref);
  }
  // IDs are unique across the tracker (spec 02 §2.2), so an ID any of these
  // refs files as settled is settled, whichever of them was asked for it.
  return consult.size === 0 ? new Set() : settledPrIds(ws, [...consult]);
}

/**
 * The IDs that the given refs record as merged or closed.
 *
 * One `cat-file --batch-check` resolves every status directory asked for, and
 * only the distinct trees that come back are listed, so refs sharing a
 * merge-base cost one read between them. No `pr.md` is parsed: the directory a
 * pull request sits in is its status (spec 02 §2.1), so the price does not
 * grow with the number of pull requests.
 */
function settledPrIds(ws: WsCtx, refs: readonly string[]): Set<string> {
  const cwd = ws.repoRoot;
  const trees = batchResolve(
    cwd,
    refs.flatMap((ref) => PR_SETTLED_DIRS.map((dir) => `${ref}:${ws.navDir}/${dir}`)),
  );

  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const tree of trees.values()) {
    if (seen.has(tree)) continue;
    seen.add(tree);
    for (const name of lsTreeNamesOfTree(cwd, tree)) {
      // Directories are `<id>-<slug>` and the ID alone is the reference.
      const id = name === ".gitkeep" ? undefined : name.split("-")[0];
      if (id) ids.add(id);
    }
  }
  return ids;
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
 * It must agree with that listing, so a pull request is settled by the same
 * refs {@link dropSettledOnTarget} asks: its target and the default branch.
 *
 * Cheap by construction: one `cat-file --batch-check` resolves every branch's
 * `prs/open` directory at once, and only the distinct trees that come back are
 * listed, so branches sharing a merge-base cost one read between them. Only
 * each pull request's `pr.md` is read, for its target, once per distinct tree.
 */
export function countOpenPrsOnOtherRefs(ws: WsCtx): number {
  const cwd = ws.repoRoot;
  const dir = `${ws.navDir}/${PR_OPEN_DIR}`;
  const refs = listBranchRefs(cwd);

  // HEAD rather than the branch's name: a detached HEAD has no name, and its
  // tree still holds whatever pull requests it holds.
  const trees = batchResolve(cwd, [`HEAD:${dir}`, ...refs.map((ref) => `${ref.full}:${dir}`)]);
  const listed = new Map<string, string[]>();
  const namesOf = (tree: string): string[] => {
    const cached = listed.get(tree);
    if (cached) return cached;
    const names = lsTreeNamesOfTree(cwd, tree).filter((name) => name !== ".gitkeep");
    listed.set(tree, names);
    return names;
  };
  // Directories are `<id>-<slug>` and the ID alone is the reference (spec 02
  // §2.2), so one pull request on ten branches is still one.
  const idOf = (name: string): string => name.split("-")[0] as string;

  const headTree = trees.get(`HEAD:${dir}`);
  const mine = new Set(headTree === undefined ? [] : namesOf(headTree).map(idOf));

  // Where each pull request elsewhere was first seen, a local branch's copy
  // preferred, as the scan behind the listing prefers it.
  const elsewhere = new Map<string, { tree: string; name: string; remote: boolean }>();
  for (const ref of refs) {
    const tree = trees.get(`${ref.full}:${dir}`);
    if (tree === undefined) continue;
    for (const name of namesOf(tree)) {
      const id = idOf(name);
      // A pull request this tree holds is not elsewhere, however many other
      // refs — its own `origin/` copy, most often — also carry it.
      if (id === "" || mine.has(id)) continue;
      const seen = elsewhere.get(id);
      if (!seen || (seen.remote && !ref.remote)) {
        elsewhere.set(id, { tree, name, remote: ref.remote });
      }
    }
  }
  if (elsewhere.size === 0) return 0;

  const blobs = catBlobs(
    cwd,
    [...elsewhere.values()].map(({ tree, name }) => ({ ref: tree, path: `${name}/pr.md` })),
  );
  const targets = [...elsewhere.values()].map(({ tree, name }) =>
    targetOf(blobs.get(`${tree}:${name}/pr.md`)),
  );
  const settled = settledOnTargets(ws, refs, targets);
  return [...elsewhere.keys()].filter((id) => !settled.has(id)).length;
}

/** The `target:` a `pr.md` names, or "" when it names none or does not parse. */
function targetOf(text: string | undefined): string {
  if (text === undefined) return "";
  try {
    return stringAt(parseDoc(text), ["target"]) ?? "";
  } catch {
    return "";
  }
}

export function stringField(entity: EntityRecord, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------- merge */

/**
 * How the source branch is put onto the target.
 *
 * One per shape of history, not one per method: `auto` and `merge-ff` both
 * resolve to a plain fast-forward or a plain merge commit, and the method that
 * chose it stops mattering the moment the choice is made. What is left is
 * exactly the four things git can be asked to do, plus the replay that
 * precedes two of them.
 */
export type MergeStrategy =
  | "fast-forward"
  | "merge-commit"
  | "replay-fast-forward"
  | "replay-merge-commit"
  | "squash";

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
  /** The method this merge lands by, whoever chose it. */
  method: MergeMethod;
  /** The marker's merge policy, and any fault found reading it (spec 02 §2.10). */
  mergePolicy: MergePolicyReading;
  strategy: MergeStrategy;
  /** The merge commit message, unused by a fast-forward. */
  message: string;
  /** What the reviews say, for a caller that wants to mention it. */
  review: MergeReview;
  /** Whether to bring the source branch up to the target afterwards. */
  syncSource: boolean;
  /**
   * Whether the replay will be handed the source *branch* and so rewrite it.
   *
   * False for every method that keeps the source's commits, and false for a
   * replay that must not touch the branch — one told `--no-sync-source`, one
   * whose source is a remote-tracking ref, one another worktree is standing
   * on. Such a replay runs on a detached HEAD and leaves every ref alone.
   */
  rewriteSource: boolean;
}

export interface MergeOptions {
  /** Land by this method instead of the one the marker declares (spec 02 §2.10). */
  method?: MergeMethod;
  /** Leave the source branch where it is; the default moves it (see {@link SourceSync}). */
  syncSource?: boolean;
}

/**
 * What became of the source branch once the merge was recorded.
 *
 * The archive commit lands on the target and nowhere else, so a source branch
 * that outlives the merge — `dev` into `main` — is left one commit behind it,
 * with the same pull request reading `merged` on one branch and `open` on the
 * other. Fast-forwarding the source closes that gap; anything short of a
 * fast-forward is a person's business, and is reported rather than attempted.
 *
 * The two exceptions are the methods that rewrite the source's commits, and
 * both are the method working rather than a gap to close: a replay moves the
 * branch onto the commits it produced, and a squash leaves it alone because
 * nothing on it can reach the one commit that replaced it.
 */
export type SourceSyncOutcome =
  /** The branch now points where the target does. */
  | "fast-forwarded"
  /** It already did. */
  | "up-to-date"
  /** It was replayed onto the target, and now points there. */
  | "rebased"
  /** Its change landed as one commit that it cannot fast-forward to. */
  | "squashed"
  /** A remote-tracking ref, or a branch this clone does not hold: not ours to move. */
  | "not-local"
  /** It has commits the target does not, so it cannot fast-forward. */
  | "diverged"
  /** Another worktree stands on it; moving the ref would leave that tree behind its HEAD. */
  | "checked-out"
  /** The caller asked for the target to move and nothing else. */
  | "disabled";

export interface SourceSync {
  /** The ref the merge came from, as the plan named it. */
  ref: string;
  outcome: SourceSyncOutcome;
  /** The worktree holding the branch, when that is what stopped the move. */
  worktree?: string;
}

export interface MergeResult {
  entity: EntityRecord;
  /** The commit that landed the branch, or null where the method made none. */
  mergeSha: string | null;
  /** Where the pull request now lives, relative to the Navbook directory. */
  dirPath: string;
  /** The method it was landed by, which decides how `source` reads. */
  method: MergeMethod;
  /** What the reviews said when the merge was made. */
  review: MergeReview;
  /** What became of the source branch. */
  source: SourceSync;
}

/** Read a pull request's review state against the working tree's policy. */
function mergeReview(ws: WsCtx, entity: EntityRecord): MergeReview {
  const reading = readReviewPolicy(ws);
  return { reading, summary: reviewSummary(entity, reading.policy) };
}

/** Check a merge can proceed and decide how it would be performed. */
export function planPrMerge(ws: WsCtx, ref: string, opts: MergeOptions = {}): MergePlan {
  requireNothingInFlight(ws);
  if (!isTreeClean(ws.repoRoot)) {
    wsFail("precondition", "the working tree has changes; commit or stash them before merging");
  }
  // Clean, and nothing in flight: whatever the last merge left behind is over.
  clearPendingMerge(ws.repoRoot);

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

  const mergePolicy = readMergePolicy(ws);
  const method = opts.method ?? mergePolicy.policy.method;
  const syncSource = opts.syncSource !== false;
  return {
    entity,
    sourceRef,
    targetBranch: branch,
    method,
    mergePolicy,
    strategy: strategyFor(ws, method, entity, sourceRef, branch),
    message: mergeMessage(entity),
    review: mergeReview(ws, entity),
    syncSource,
    rewriteSource:
      rewritesSource(method) &&
      method !== "squash" &&
      syncSource &&
      isFreeLocalBranch(ws, sourceRef),
  };
}

/**
 * Nothing half-done: neither git's idea of an unfinished operation, nor ours.
 *
 * A replay and a squash both stop in states git does not call "a merge in
 * progress", so asking git alone would let a second `nav pr merge` start on
 * top of the first and lose whichever conflicts had already been resolved.
 */
function requireNothingInFlight(ws: WsCtx): void {
  const pending = readPendingMerge(ws.repoRoot);
  // A note outlives what it describes: `git rebase --abort` and
  // `git reset --merge` put the repository back without knowing about it. So
  // the note only stands in the way while something is actually half-done —
  // git holding a merge or a rebase, or a resolution sitting in the index that
  // the clean-tree check below refuses to merge over. Anything else is a note
  // about an operation that is over, and `planPrMerge` throws it away.
  if (pending && (isMergeInProgress(ws.repoRoot) || isReplayInProgress(ws.repoRoot))) {
    wsFail("precondition", `merging #${pending.id} is already in progress`, [
      "finish it with 'nav pr merge --continue'",
    ]);
  }
  if (pending && !isTreeClean(ws.repoRoot)) {
    wsFail("precondition", `merging #${pending.id} is already in progress`, [
      "finish it with 'nav pr merge --continue'",
      `or abandon it with '${ABANDON[pending.stage]}'`,
    ]);
  }
  if (isMergeInProgress(ws.repoRoot)) {
    wsFail("precondition", "a merge is already in progress", [
      "finish it with 'nav pr merge --continue', or 'git merge --abort'",
    ]);
  }
  if (isReplayInProgress(ws.repoRoot)) {
    wsFail("precondition", "a rebase is already in progress", [
      "finish it with 'git rebase --continue', or 'git rebase --abort'",
    ]);
  }
}

/**
 * The shape of history a method asks for, given what the branches allow.
 *
 * The one refusal in this file that is not about the tracker's state:
 * `merge-ff` says the target's history is to stay linear without rewriting
 * anybody's commits, and two branches that have diverged cannot both be had.
 * Spec 02 §2.7 is untouched by it — what it refuses is a shape, and no review
 * could change the answer.
 */
function strategyFor(
  ws: WsCtx,
  method: MergeMethod,
  entity: EntityRecord,
  sourceRef: string,
  branch: string,
): MergeStrategy {
  switch (method) {
    case "auto":
      return canFastForward(ws.repoRoot, sourceRef) ? "fast-forward" : "merge-commit";
    case "merge":
      return "merge-commit";
    case "merge-ff":
      if (canFastForward(ws.repoRoot, sourceRef)) return "fast-forward";
      return wsFail(
        "precondition",
        `#${entity.id} cannot fast-forward into ${branch}, and this repository merges by 'merge-ff'`,
        [
          `rebase the branch onto ${branch}, or merge ${branch} into it and try again`,
          "or land this one by another method: nav pr merge --method rebase",
        ],
      );
    case "rebase":
      return "replay-fast-forward";
    case "rebase-no-ff":
      return "replay-merge-commit";
    case "squash":
      return "squash";
  }
}

/** True when `ref` is a local branch this worktree may rewrite. */
function isFreeLocalBranch(ws: WsCtx, ref: string): boolean {
  if (resolveSha(ws.repoRoot, `refs/heads/${ref}`) === null) return false;
  return worktreeHolding(ws.repoRoot, ref) === null;
}

/** Carry out a merge the caller has decided to go ahead with. */
export function executePrMerge(ws: WsCtx, plan: MergePlan): MergeResult {
  const recorded = landMerge(ws, plan);
  return {
    ...recorded,
    source: syncSourceBranch(ws, {
      id: plan.entity.id,
      sourceRef: plan.sourceRef,
      targetBranch: plan.targetBranch,
      syncSource: plan.syncSource,
      method: plan.method,
      rewroteSource: plan.rewriteSource,
    }),
  };
}

/** A merge result before the source branch has been looked at. */
type Recorded = Omit<MergeResult, "source">;

/** Land the source branch on the target and record the pull request as merged. */
function landMerge(ws: WsCtx, plan: MergePlan): Recorded {
  const cwd = ws.repoRoot;
  switch (plan.strategy) {
    case "fast-forward":
      // A fast-forward creates no commit to carry the move, so the archive
      // happens in the immediate follow-up commit that spec 02 §2.8 allows.
      // Nothing is noted down first: a fast-forward cannot stop half-done.
      fastForward(cwd, plan.sourceRef);
      return recordMerged(ws, plan.entity.id, plan.method, null, plan.review);

    case "merge-commit":
      noteMerge(ws, plan, "merge");
      if (mergeNoCommit(cwd, plan.sourceRef) === "conflict")
        stopForConflicts(ws, plan.entity.id, "merge");
      return landStaged(ws, plan.entity.id, plan.message, plan.method, plan.review);

    case "squash":
      noteMerge(ws, plan, "squash");
      if (squashMerge(cwd, plan.sourceRef) === "conflict")
        stopForConflicts(ws, plan.entity.id, "squash");
      return landStaged(ws, plan.entity.id, plan.message, plan.method, plan.review);

    case "replay-fast-forward":
    case "replay-merge-commit":
      return landReplay(ws, plan);
  }
}

/**
 * Replay the source's commits onto the target, then land what came out.
 *
 * The replay leaves HEAD on the commits it produced and not on the target
 * branch — that is what a rebase does, whether it rewrote a branch or detached
 * — so the target is checked out again before anything is committed to it.
 */
function landReplay(ws: WsCtx, plan: MergePlan): Recorded {
  const cwd = ws.repoRoot;
  const base = mergeBase(cwd, "HEAD", plan.sourceRef);
  const onto = resolveSha(cwd, "HEAD");
  if (base === null || onto === null) {
    wsFail(
      "precondition",
      `could not compute a merge base between '${plan.targetBranch}' and '${plan.sourceRef}'`,
    );
  }

  noteMerge(ws, plan, "replay");
  // The branch name rewrites the branch; its SHA leaves every ref alone.
  const what = plan.rewriteSource
    ? plan.sourceRef
    : (resolveSha(cwd, plan.sourceRef) ?? plan.sourceRef);
  const replay = replayOnto(cwd, onto, base, what);
  if (replay.tip === null) {
    // A rebase leaves HEAD on what it is replaying, not on the target. Worth
    // saying, because it is the one conflict a person resolves somewhere other
    // than where they started — and because `git rebase --abort` puts them
    // back there rather than on the branch they ran the merge from.
    stopForConflicts(
      ws,
      plan.entity.id,
      "replay",
      `the replay left HEAD on ${plan.rewriteSource ? plan.sourceRef : "a detached HEAD"}; '--continue' returns to ${plan.targetBranch}`,
    );
  }
  return landReplayed(ws, plan, replay.tip);
}

/** Put the replayed commits on the target, by whichever of the two ways was asked for. */
function landReplayed(
  ws: WsCtx,
  plan: Pick<MergePlan, "entity" | "strategy" | "targetBranch" | "message" | "method" | "review">,
  tip: string,
): Recorded {
  const cwd = ws.repoRoot;
  checkoutBranch(cwd, plan.targetBranch);

  if (plan.strategy === "replay-fast-forward") {
    fastForward(cwd, tip);
    return recordMerged(ws, plan.entity.id, plan.method, null, plan.review);
  }
  // The replay sits directly on the target, so this merge cannot conflict; it
  // is `--no-ff` precisely to make the commit a fast-forward would not.
  if (mergeNoCommit(cwd, tip) === "conflict") stopForConflicts(ws, plan.entity.id, "merge");
  return landStaged(ws, plan.entity.id, plan.message, plan.method, plan.review);
}

/**
 * Commit what a merge or a squash staged, with the directory move folded in.
 *
 * The note comes off as soon as that commit exists: from here the branch is
 * landed, and a `--continue` that came back would have nothing left to finish
 * and no conflicts to preserve. What can still fail is the `merged:` block,
 * and {@link recordMergedBlock} says plainly what is left to do by hand.
 */
function landStaged(
  ws: WsCtx,
  id: string,
  message: string,
  method: MergeMethod,
  review: MergeReview,
): Recorded {
  // The move is staged into the commit itself (04 §4.3), so the commit that
  // lands the branch is also the commit that files the discussion as merged.
  const archived = archiveIntoIndex(ws, id);
  const sha = commitMerge(ws.repoRoot, message);
  clearPendingMerge(ws.repoRoot);
  return recordMergedBlock(ws, archived, sha, method, review);
}

/**
 * Archive and record where the method landed no commit of its own.
 *
 * A fast-forward moved a branch pointer and nothing more, so both the
 * directory move and the `merged:` block go into the one follow-up commit that
 * spec 02 §2.8 allows, and the block names no commit because none exists.
 */
function recordMerged(
  ws: WsCtx,
  id: string,
  method: MergeMethod,
  sha: string | null,
  review: MergeReview,
): Recorded {
  clearPendingMerge(ws.repoRoot);
  return recordMergedBlock(ws, archiveIntoIndex(ws, id), sha, method, review);
}

/** Finish a merge that was interrupted by conflicts. */
export function continuePrMerge(
  ws: WsCtx,
  ref?: string,
  opts: Pick<MergeOptions, "syncSource"> = {},
): MergeResult {
  const pending = readPendingMerge(ws.repoRoot);
  return pending ? continueNoted(ws, pending, opts) : continueFromMergeHead(ws, ref, opts);
}

/**
 * Pick a merge back up from the note it left (spec 04 §4.3).
 *
 * The note is preferred over anything the caller passes, and over `MERGE_HEAD`
 * where both exist, because it is the only thing that knows the method and the
 * branch to come back to. An ID given here is therefore redundant rather than
 * wrong, and is ignored rather than made into an error.
 */
function continueNoted(
  ws: WsCtx,
  pending: PendingMerge,
  opts: Pick<MergeOptions, "syncSource">,
): MergeResult {
  const syncSource = opts.syncSource === false ? false : pending.syncSource;
  const { entity } = locatePr(ws, pending.id);
  // Read before the archive moves the directory, so the reviews are still
  // where the entity says they are.
  const review = mergeReview(ws, entity);
  const message = mergeMessage(entity);

  const recorded =
    pending.stage === "replay"
      ? resumeReplay(ws, pending, entity, message, review)
      : resumeStaged(ws, pending, entity, message, review);

  return {
    ...recorded,
    source: syncSourceBranch(ws, {
      id: pending.id,
      sourceRef: pending.sourceRef,
      targetBranch: pending.targetBranch,
      syncSource,
      method: pending.method,
      rewroteSource: pending.rewroteSource,
    }),
  };
}

/** Carry on with a replay whose conflicts the author has resolved. */
function resumeReplay(
  ws: WsCtx,
  pending: PendingMerge,
  entity: EntityRecord,
  message: string,
  review: MergeReview,
): Recorded {
  const cwd = ws.repoRoot;
  let tip: string | null;
  if (isReplayInProgress(cwd)) {
    refuseWhileUnmerged(ws, "replay");
    tip = continueReplay(cwd).tip;
    if (tip === null) stopForConflicts(ws, pending.id, "replay");
  } else {
    // The author finished the rebase themselves; the replayed commits are
    // wherever it left them, which is the branch if it was rewritten in place.
    tip = resolveSha(cwd, pending.rewroteSource ? pending.sourceRef : "HEAD");
    if (tip === null) {
      wsFail("merge-ambiguous", `could not find the commits replayed for #${pending.id}`, [
        `if the rebase was abandoned, start again: nav pr merge ${pending.id}`,
      ]);
    }
  }

  return landReplayed(
    ws,
    {
      entity,
      strategy: pending.method === "rebase" ? "replay-fast-forward" : "replay-merge-commit",
      targetBranch: pending.targetBranch,
      message,
      method: pending.method,
      review,
    },
    tip,
  );
}

/** Commit a merge or squash whose conflicts the author has resolved. */
function resumeStaged(
  ws: WsCtx,
  pending: PendingMerge,
  entity: EntityRecord,
  message: string,
  review: MergeReview,
): Recorded {
  refuseWhileUnmerged(ws, pending.stage);
  // A squash leaves no `MERGE_HEAD`, and a merge whose conflicts were
  // committed by hand no longer has one either: either way what is left is an
  // ordinary commit of whatever is staged, which is what `landStaged` makes.
  if (pending.stage === "squash" || isMergeInProgress(ws.repoRoot)) {
    return landStaged(ws, entity.id, message, pending.method, review);
  }
  const archived = archiveIntoIndex(ws, entity.id);
  const sha = resolveSha(ws.repoRoot, "HEAD");
  clearPendingMerge(ws.repoRoot);
  return recordMergedBlock(ws, archived, sha, pending.method, review);
}

/**
 * Finish a merge git is holding that Navbook did not start.
 *
 * What `--continue` did before merges left a note, kept for exactly that case:
 * a `git merge` somebody ran by hand, or one begun by a `nav` old enough not
 * to have written one. It can only ever be a merge commit, since that is the
 * one shape `MERGE_HEAD` describes.
 */
function continueFromMergeHead(
  ws: WsCtx,
  ref: string | undefined,
  opts: Pick<MergeOptions, "syncSource">,
): MergeResult {
  if (isMergeInProgress(ws.repoRoot)) refuseWhileUnmerged(ws, "merge");

  const { entity, sourceRef } = pendingMergePr(ws, ref);
  // Read before the archive moves the directory, so the reviews are still
  // where the entity says they are.
  const review = mergeReview(ws, entity);
  const inProgress = isMergeInProgress(ws.repoRoot);
  const archived = archiveIntoIndex(ws, entity.id);
  const mergeSha = inProgress
    ? commitMerge(ws.repoRoot, mergeMessage(entity))
    : (resolveSha(ws.repoRoot, "HEAD") ?? null);
  const recorded = recordMergedBlock(ws, archived, mergeSha, "merge", review);
  const source = syncSourceBranch(ws, {
    id: entity.id,
    sourceRef,
    targetBranch: currentBranch(ws.repoRoot) ?? "HEAD",
    syncSource: opts.syncSource !== false,
    method: "merge",
    rewroteSource: false,
  });
  return { ...recorded, source };
}

/** Refuse to finish anything while git still has paths nobody has resolved. */
function refuseWhileUnmerged(ws: WsCtx, stage: MergeStage): void {
  const conflicts = conflictedPaths(ws.repoRoot);
  if (conflicts.length === 0) return;
  wsFail("merge-unresolved", `the ${stageNoun(stage)} still has unresolved conflicts`, [
    ...conflicts.map((path) => `  ${path}`),
    `resolve them, 'git add' each one, then run 'nav pr merge --continue' again`,
  ]);
}

interface SyncInput {
  id: string;
  sourceRef: string;
  targetBranch: string;
  syncSource: boolean;
  method: MergeMethod;
  /** Whether the replay already moved this branch onto its new commits. */
  rewroteSource: boolean;
}

/**
 * Bring the source branch up to the target once the merge is recorded.
 *
 * Only ever a fast-forward, and only of a local branch nothing is standing on:
 * every other case is reported and left exactly as it was. The check that the
 * branch is behind the target is made here rather than on the plan, because it
 * is only after the merge that the source is known to be an ancestor of HEAD.
 *
 * A replay is the one move that arrives here already made — git rewrote the
 * branch as part of rebasing it — so what is left for this to do is the same
 * fast-forward as ever, over the archive commit; only the word for it changes.
 * A squash arrives with nothing to do at all.
 */
function syncSourceBranch(ws: WsCtx, input: SyncInput): SourceSync {
  const ref = input.sourceRef;
  if (!input.syncSource) return { ref, outcome: "disabled" };
  // Its commits were replaced by one that nothing on that branch can reach.
  // Deleting it, or resetting it by hand, is the user's call and not ours.
  if (input.method === "squash") return { ref, outcome: "squashed" };

  const cwd = ws.repoRoot;
  const moved = input.rewroteSource ? "rebased" : "fast-forwarded";
  const from = resolveSha(cwd, `refs/heads/${ref}`);
  if (from === null) return { ref, outcome: "not-local" };
  const to = resolveSha(cwd, "HEAD");
  if (to === null || from === to) {
    return { ref, outcome: input.rewroteSource ? "rebased" : "up-to-date" };
  }
  if (!isAncestor(cwd, from, to)) return { ref, outcome: "diverged" };

  const worktree = worktreeHolding(cwd, ref);
  if (worktree !== null) return { ref, outcome: "checked-out", worktree };

  const how = input.rewroteSource
    ? `rebased onto ${input.targetBranch}`
    : `to ${input.targetBranch}`;
  updateBranch(cwd, ref, to, from, `nav pr merge #${input.id}: ${how}`);
  return { ref, outcome: moved };
}

/** Write down what this merge is doing, before the step that can stop. */
function noteMerge(ws: WsCtx, plan: MergePlan, stage: MergeStage): void {
  writePendingMerge(ws.repoRoot, {
    id: plan.entity.id,
    sourceRef: plan.sourceRef,
    targetBranch: plan.targetBranch,
    method: plan.method,
    stage,
    syncSource: plan.syncSource,
    rewroteSource: plan.rewriteSource,
  });
}

function stageNoun(stage: MergeStage): string {
  return stage === "replay" ? "rebase" : "merge";
}

function mergeMessage(entity: EntityRecord): string {
  return composeMessage(`Merge #${entity.id}: ${stringField(entity, "title")}`, [
    { key: "Refs", id: entity.id },
  ]);
}

/** The PR whose source branch this in-progress merge is bringing in. */
function pendingMergePr(ws: WsCtx, ref: string | undefined): LocatedPr {
  if (ref) return locatePr(ws, ref);

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
  return { entity: first.entity, ...sourceOf(first) };
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
  method: MergeMethod,
  review: MergeReview,
): Recorded {
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
  return { entity, mergeSha, dirPath: entity.dirPath, method, review };
}

/**
 * Leave the operation in progress and say exactly how to finish it.
 *
 * Nothing is aborted: the author's conflict resolution is worth keeping, and
 * `--continue` performs the archive step they would otherwise have to
 * remember. The note this merge wrote is left in place for it to read.
 *
 * How to abandon it differs by what is half-done, and only one of the three is
 * `git merge --abort`: a squash leaves no `MERGE_HEAD` for that to find, and a
 * replay is a rebase.
 */
function stopForConflicts(ws: WsCtx, id: string, stage: MergeStage, where?: string): never {
  wsFail("merge-conflict", `${stageVerb(stage)} #${id} produced conflicts`, [
    ...conflictedPaths(ws.repoRoot).map((path) => `  ${path}`),
    ...(where ? [where] : []),
    "resolve them, 'git add' each one, then run 'nav pr merge --continue'",
    `or abandon it with '${ABANDON[stage]}'`,
  ]);
}

const ABANDON: Record<MergeStage, string> = {
  merge: "git merge --abort",
  replay: "git rebase --abort",
  squash: "git reset --merge",
};

function stageVerb(stage: MergeStage): string {
  return stage === "replay" ? "replaying" : "merging";
}

export interface LocatedPr {
  entity: EntityRecord;
  sourceRef: string;
  /** Whether {@link sourceRef} is a remote-tracking branch rather than a local one. */
  sourceRemote: boolean;
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
  return { entity: entry.entity, ...sourceOf(entry) };
}

/** The ref a pull request is merged from, out of those carrying it. */
function sourceOf(entry: FoundPr): Omit<LocatedPr, "entity"> {
  // `source:` is only SHOULD, so fall back to a local ref before a remote one:
  // a local branch is the copy the user can actually merge.
  const declared = stringField(entry.entity, "source");
  const source =
    entry.refs.find((candidate) => candidate.short === declared) ??
    entry.refs.find((candidate) => !candidate.remote) ??
    (entry.refs[0] as Ref);
  return { sourceRef: source.short, sourceRemote: source.remote };
}

export interface ReadablePr {
  entity: EntityRecord;
  /** The branch it was read from, or null when the working tree holds it. */
  ref: string | null;
}

/**
 * Find a pull request to read, wherever it is.
 *
 * The working tree first: that copy is the one with whatever has not been
 * committed yet. Only when it is not here is the scan across branches worth
 * its cost, and it is almost never here, because a pull request's files live
 * on its source branch (spec 03 §3.5). Without this, `nav pr list --all-refs`
 * would list IDs that `show` answers "no pull request matches" to.
 */
export function readPr(ws: WsCtx, ref: string, repo: Repo = loadRepo(ws)): ReadablePr {
  const here = prInTree(repo, ref);
  if (here) return { entity: here, ref: null };
  const located = locatePr(ws, ref);
  return { entity: located.entity, ref: located.sourceRef };
}

/**
 * Find a pull request to write to, and refuse one this checkout does not hold.
 *
 * A comment or review is a file in the pull request's directory, so written
 * here it would land beside no `pr.md` — the stranded comment of spec 03
 * §3.3.1 — rather than on the branch under review. The scan can still see
 * where the pull request lives, so the refusal says that, and the worktree to
 * run in when one already has the branch, instead of claiming it does not
 * exist.
 */
export function findPrToWrite(ws: WsCtx, ref: string): EntityRecord {
  const here = prInTree(loadRepo(ws), ref);
  if (here) return here;

  const { entity, sourceRef, sourceRemote } = locatePr(ws, ref);
  const why =
    "a pull request is written on its source branch, beside the files it proposes to merge";
  // A remote-tracking copy is `<remote>/<branch>`; `git switch <branch>` makes
  // the local branch that tracks it.
  const branch = sourceRemote ? sourceRef.slice(sourceRef.indexOf("/") + 1) : sourceRef;
  const tree = sourceRemote ? null : worktreeHolding(ws.repoRoot, branch);
  if (!sourceRemote && branch === currentBranch(ws.repoRoot)) {
    wsFail(
      "precondition",
      `#${entity.id} is committed on '${branch}' but missing from the working tree`,
      [`restore it with 'git checkout HEAD -- ${ws.navDir}/${entity.dirPath}'`],
    );
  }
  wsFail(
    "precondition",
    `#${entity.id} is on '${sourceRef}', which is not checked out here`,
    tree
      ? [why, `'${branch}' is checked out in ${tree}; run the command there`]
      : [
          why,
          `check out '${branch}' first: 'git switch ${branch}', or 'git worktree add <dir> ${branch}'`,
        ],
  );
}

/** The pull request in this tree, or null when only another branch could hold it. */
function prInTree(repo: Repo, ref: string): EntityRecord | null {
  try {
    return resolveEntity(repo, ref, "pr");
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === "not-found") return null;
    throw error;
  }
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
