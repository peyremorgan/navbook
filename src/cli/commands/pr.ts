/**
 * `nav pr <verb>` — spec 04 §4.3.
 *
 * The seven shared verbs come from `entity.ts`; this module adds the three that
 * only pull requests have (`update`, `review`, `merge`) and the parts of the
 * shared verbs that must reach across branches, because a PR's files live on
 * the branch it proposes to merge (spec 03 §3.5).
 */

import {
  type NewCommentInput,
  newCommentFile,
  newPrFile,
  type Revision,
  readRevisions,
  type Verdict,
  validateComment,
  validatePr,
} from "../../core/files.ts";
import { entityJson, NAVBOOK_ROOT, toNdjson } from "../../core/json.ts";
import {
  type MergedBlock,
  planComment,
  planEntityOpen,
  planMergedBlock,
  planPrUpdate,
  RevisionUnchangedError,
} from "../../core/ops.ts";
import { isQueryError, matchesQuery, parseQuery } from "../../core/query.ts";
import { allEntities, allIds, type EntityRecord, parseTree } from "../../core/tree.ts";
import { gitMaybe } from "../../git/exec.ts";
import { isAncestor, mergeBase, objectExists } from "../../git/history.ts";
import { add, commit, composeMessage } from "../../git/index-ops.ts";
import {
  canFastForward,
  commitMerge,
  conflictedPaths,
  fastForward,
  isAlreadyMerged,
  mergeHead,
  mergeNoCommit,
} from "../../git/merge.ts";
import { catBlobs, listBranchRefs, lsTreeNames, lsTreeRecursive } from "../../git/refscan.ts";
import {
  currentBranch,
  defaultBranch,
  isMergeInProgress,
  isTreeClean,
  resolveSha,
} from "../../git/repo.ts";
import { commitReport, runPlan } from "../commit-flow.ts";
import { type Ctx, nowIso } from "../context.ts";
import { fail } from "../errors.ts";
import { resolveEntity } from "../resolve.ts";
import { applyOps, loadRepo, repoPath, stage } from "../workspace.ts";
import { composeFile } from "./compose.ts";
import {
  type CloseOptions,
  cmdClose,
  cmdList,
  currentAuthor,
  type GlobalFlags,
  type ListOptions,
} from "./entity.ts";

const PR_OPEN_DIR = "prs/open";

/* --------------------------------------------------------------------- open */

export interface PrOpenOptions extends GlobalFlags {
  target?: string;
  title?: string;
  message?: string;
  draft?: boolean;
  label?: string[];
  assignee?: string[];
  milestone?: string;
}

export function cmdPrOpen(ctx: Ctx, opts: PrOpenOptions): void {
  const repo = loadRepo(ctx, { includeComments: false });
  const source = currentBranch(ctx.repoRoot);
  if (!source) fail("HEAD is detached; check out the branch the pull request rides on");

  const target = opts.target ?? defaultBranch(ctx.repoRoot);
  if (!target) fail("could not determine a target branch; pass --target");
  if (target === source) fail(`a pull request cannot target its own branch (${source})`);

  const head = resolveSha(ctx.repoRoot, "HEAD");
  if (!head) fail("this branch has no commits yet");
  const base = mergeBase(ctx.repoRoot, "HEAD", target);
  if (!base) fail(`'${target}' does not exist, or shares no history with ${source}`);

  const title = opts.title ?? lastCommitSubject(ctx) ?? source;
  const created = nowIso(ctx);
  const revision: Revision = { head, base, date: created };

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_PR.md",
    noun: "pull request",
    render: (body) =>
      newPrFile({
        title,
        author: currentAuthor(ctx),
        created,
        target,
        source,
        revisions: [revision],
        body,
        draft: opts.draft,
        labels: opts.label,
        assignee: opts.assignee,
        milestone: opts.milestone,
      }),
    validate: validatePr,
  });

  const finalTitle =
    typeof composed.parsed.fm.title === "string" ? composed.parsed.fm.title : title;
  const id = ctx.mintId(new Set(allIds(repo).map((entry) => entry.id)));
  const { plan, dirPath } = planEntityOpen("pr", id, finalTitle, composed.content);

  runPlan(ctx, plan, { commit: opts.commit });
  ctx.stdout.write(`Created ${NAVBOOK_ROOT}/${dirPath}/  (#${id})\n`);
  ctx.stdout.write(`Targets ${target}, from ${source} at ${head.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

function lastCommitSubject(ctx: Ctx): string | null {
  const subject = gitMaybe(["log", "-1", "--format=%s"], { cwd: ctx.repoRoot });
  return subject === null || subject === "" ? null : subject;
}

/* ------------------------------------------------------------------- update */

export function cmdPrUpdate(ctx: Ctx, prefix: string, opts: GlobalFlags): void {
  const entity = resolveEntity(loadRepo(ctx), prefix, "pr");
  if (entity.status !== "open")
    fail(`#${entity.id} is ${entity.status}; only open pull requests take updates`);

  const head = resolveSha(ctx.repoRoot, "HEAD");
  if (!head) fail("this branch has no commits yet");
  const target = typeof entity.fm.target === "string" ? entity.fm.target : null;
  const base = target ? mergeBase(ctx.repoRoot, "HEAD", target) : null;
  if (!base) fail(`could not compute a merge base with '${target ?? "the target branch"}'`);

  let plan: ReturnType<typeof planPrUpdate>;
  try {
    plan = planPrUpdate(entity, { head, base, date: nowIso(ctx) });
  } catch (error) {
    if (error instanceof RevisionUnchangedError) fail(error.message);
    throw error;
  }

  runPlan(ctx, plan, { commit: opts.commit });
  const count = readRevisions(entity.fm).length + 1;
  ctx.stdout.write(`Recorded revision ${count} of #${entity.id}  head ${head.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

/* ------------------------------------------------------------------- review */

export interface ReviewOptions extends GlobalFlags {
  approve?: boolean;
  requestChanges?: boolean;
  message?: string;
  revision?: string;
  file?: string;
  line?: string;
}

export function cmdPrReview(ctx: Ctx, prefix: string, opts: ReviewOptions): void {
  const repo = loadRepo(ctx);
  const entity = resolveEntity(repo, prefix, "pr");
  if (opts.approve && opts.requestChanges) {
    fail("choose either --approve or --request-changes, not both");
  }

  const revisions = readRevisions(entity.fm);
  const latest = revisions[revisions.length - 1];
  const revision = opts.revision ? resolveRevision(entity, opts.revision) : latest?.head;
  if (!revision) fail(`#${entity.id} has no recorded revision to bind this review to`);
  if (opts.line && !opts.file) fail("--line needs --file");

  const verdict: Verdict | undefined = opts.approve
    ? "approve"
    : opts.requestChanges
      ? "request-changes"
      : undefined;
  const isReview = verdict !== undefined || opts.file !== undefined;

  const base: NewCommentInput = {
    author: currentAuthor(ctx),
    body: "",
    ...(verdict ? { verdict } : {}),
    ...(isReview ? { revision } : {}),
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.line ? { line: opts.line } : {}),
  };

  const composed = composeFile(ctx, {
    message: opts.message,
    bufferName: "NAVBOOK_REVIEW.md",
    noun: verdict ? "review" : "comment",
    render: (body) => newCommentFile({ ...base, body }),
    validate: (parsed) => validateComment(parsed, { onPr: true }),
  });

  const id = ctx.mintId(new Set(allIds(repo).map((entry) => entry.id)));
  const { plan, path } = planComment(entity, id, ctx.now(), composed.content, {
    review: isReview,
  });
  runPlan(ctx, plan, { commit: opts.commit });

  const label = verdict ? `Reviewed (${verdict})` : "Commented on";
  ctx.stdout.write(`${label} #${entity.id}  ${NAVBOOK_ROOT}/${path}  (#${id})\n`);
  if (isReview) ctx.stdout.write(`Bound to revision ${revision.slice(0, 12)}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(plan)}\n`);
}

/** Accept a full SHA or an unambiguous prefix of a recorded revision head. */
function resolveRevision(entity: EntityRecord, wanted: string): string {
  const heads = readRevisions(entity.fm).map((revision) => revision.head);
  const matches = heads.filter((head) => head.startsWith(wanted.toLowerCase()));
  if (matches.length === 1) return matches[0] as string;
  if (matches.length === 0) {
    fail(`#${entity.id} has no recorded revision starting with '${wanted}'`, [
      ...heads.map((head) => `  ${head}`),
    ]);
  }
  fail(`'${wanted}' matches ${matches.length} recorded revisions of #${entity.id}`);
}

/* --------------------------------------------------------------------- list */

export interface PrListOptions extends ListOptions {
  allRefs?: boolean;
}

export function cmdPrList(ctx: Ctx, terms: string[], opts: PrListOptions): void {
  const extraColumns = [
    { header: "target", value: (entity: EntityRecord) => stringField(entity, "target") },
  ];
  if (!opts.allRefs) {
    cmdList(ctx, "pr", terms, { ...opts, extraColumns });
    return;
  }

  const query = parseQuery(terms, "pr");
  if (isQueryError(query)) fail(query.message);

  const found = scanRefsForOpenPrs(ctx);
  const matched = found.filter((entry) => matchesQuery(query, entry.entity));

  if (opts.json) {
    if (matched.length === 0) return;
    ctx.stdout.write(
      `${toNdjson(matched.map((entry) => entityJson(entry.entity, { refs: entry.refs })))}\n`,
    );
    return;
  }
  if (matched.length === 0) {
    ctx.stdout.write("No pull requests match this query on any fetched branch.\n");
    return;
  }

  cmdList(ctx, "pr", terms, {
    ...opts,
    entities: matched.map((entry) => entry.entity),
    extraColumns: [
      ...extraColumns,
      {
        header: "refs",
        value: (entity: EntityRecord) =>
          (matched.find((entry) => entry.entity.id === entity.id)?.refs ?? []).join(","),
      },
    ],
  });
}

interface FoundPr {
  entity: EntityRecord;
  refs: string[];
}

/**
 * Enumerate open pull requests across local and fetched remote branches.
 *
 * The target branch does not show open PRs — they live on their source branches
 * — so this is how they are discovered (spec 03 §3.5). Local refs win when the
 * same PR appears on several, and every ref it was found on is reported: this
 * is the state of the branches you have fetched, not an aggregate truth.
 */
function scanRefsForOpenPrs(ctx: Ctx): FoundPr[] {
  const cwd = ctx.repoRoot;
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
        byId.set(entity.id, { entity, refs: [ref.short] });
      } else {
        existing.refs.push(ref.short);
        // Prefer the copy from a local branch: it is the one you can act on.
        if (!ref.remote && existing.refs[0]?.includes("/")) existing.entity = entity;
      }
    }
  }
  return [...byId.values()];
}

function stringField(entity: EntityRecord, key: string): string {
  const value = entity.fm[key];
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------- merge */

export interface MergeOptions extends GlobalFlags {
  noFf?: boolean;
  continue?: boolean;
}

export function cmdPrMerge(ctx: Ctx, prefix: string | undefined, opts: MergeOptions): void {
  if (opts.continue) {
    finishMerge(ctx, prefix);
    return;
  }
  if (!prefix) fail("nav pr merge needs the ID of the pull request to merge");

  if (isMergeInProgress(ctx.repoRoot)) {
    fail("a merge is already in progress", [
      "finish it with 'nav pr merge --continue', or 'git merge --abort'",
    ]);
  }
  if (!isTreeClean(ctx.repoRoot)) {
    fail("the working tree has changes; commit or stash them before merging");
  }

  const branch = currentBranch(ctx.repoRoot);
  if (!branch) fail("HEAD is detached; check out the target branch");

  const found = locatePr(ctx, prefix);
  const { entity, sourceRef } = found;
  const target = stringField(entity, "target");
  if (target !== branch) {
    fail(`#${entity.id} targets '${target}', but '${branch}' is checked out`, [
      `run 'git checkout ${target}' first`,
    ]);
  }
  if (isAlreadyMerged(ctx.repoRoot, sourceRef)) {
    fail(`#${entity.id} is already contained in ${branch}`, [
      "if it merged without being archived, run 'nav doctor --fix'",
    ]);
  }

  const title = stringField(entity, "title");
  const message = composeMessage(`Merge #${entity.id}: ${title}`, [{ key: "Refs", id: entity.id }]);

  if (!opts.noFf && canFastForward(ctx.repoRoot, sourceRef)) {
    // A fast-forward creates no commit to carry the move, so the archive
    // happens in the immediate follow-up commit that spec 02 §2.8 allows.
    fastForward(ctx.repoRoot, sourceRef);
    archiveAndRecord(ctx, entity.id, null);
    return;
  }

  if (mergeNoCommit(ctx.repoRoot, sourceRef) === "conflict") reportConflict(ctx, entity.id);
  const mergeSha = commitMerge(ctx.repoRoot, message);
  archiveAndRecord(ctx, entity.id, mergeSha);
}

/** Finish a merge that was interrupted by conflicts. */
function finishMerge(ctx: Ctx, prefix: string | undefined): void {
  if (isMergeInProgress(ctx.repoRoot)) {
    const conflicts = conflictedPaths(ctx.repoRoot);
    if (conflicts.length > 0) {
      fail("the merge still has unresolved conflicts", [
        ...conflicts.map((path) => `  ${path}`),
        "resolve them, 'git add' each one, then run 'nav pr merge --continue' again",
      ]);
    }
  }

  const entity = pendingMergePr(ctx, prefix);
  const title = stringField(entity, "title");
  const message = composeMessage(`Merge #${entity.id}: ${title}`, [{ key: "Refs", id: entity.id }]);

  const mergeSha = isMergeInProgress(ctx.repoRoot)
    ? commitMerge(ctx.repoRoot, message)
    : (resolveSha(ctx.repoRoot, "HEAD") ?? null);
  archiveAndRecord(ctx, entity.id, mergeSha);
}

/** The PR whose source branch this in-progress merge is bringing in. */
function pendingMergePr(ctx: Ctx, prefix: string | undefined): EntityRecord {
  if (prefix) return locatePr(ctx, prefix).entity;

  const incoming = mergeHead(ctx.repoRoot);
  if (!incoming) {
    fail("no merge is in progress and no pull request was named", [
      "pass the ID: nav pr merge --continue <id>",
    ]);
  }
  const candidates = scanRefsForOpenPrs(ctx).filter((entry) => {
    const revisions = readRevisions(entry.entity.fm);
    const head = revisions[revisions.length - 1]?.head;
    return (
      head !== undefined &&
      objectExists(ctx.repoRoot, head) &&
      isAncestor(ctx.repoRoot, head, incoming)
    );
  });
  const first = candidates[0];
  if (!first || candidates.length > 1) {
    fail("could not tell which pull request this merge belongs to", [
      "pass the ID: nav pr merge --continue <id>",
    ]);
  }
  return first.entity;
}

/**
 * Move the PR into `prs/merged/` and record the `merged:` block.
 *
 * The merge commit's own SHA cannot be known inside that commit, so the block
 * is written in a follow-up commit (spec 02 §2.7).
 */
function archiveAndRecord(ctx: Ctx, id: string, mergeSha: string | null): void {
  const repo = loadRepo(ctx);
  const entity = repo.byId.get(id);
  if (entity?.kind !== "pr") {
    fail(`#${id} did not arrive on this branch; the merge may not have carried its files`);
  }
  if (entity.status === "merged") {
    ctx.stdout.write(`#${id} is already archived under ${NAVBOOK_ROOT}/prs/merged/\n`);
    return;
  }

  const identity = ctx.identity();
  const merged: MergedBlock = {
    date: nowIso(ctx),
    by: identity.name ? `${identity.name} <${identity.email}>` : identity.email,
    ...(mergeSha ? { commit: mergeSha } : {}),
  };

  const targetDir = `prs/merged/${entity.dirName}`;
  applyOps(ctx, [
    { op: "move", from: entity.dirPath, to: targetDir },
    ...planMergedBlock({ ...entity, dirPath: targetDir, filePath: `${targetDir}/pr.md` }, merged)
      .ops,
  ]);
  stage(ctx, [repoPath(entity.dirPath), repoPath(targetDir)]);
  const message = composeMessage(`nb: merge #${id}`, [{ key: "Refs", id }]);
  commit(ctx.repoRoot, message);

  ctx.stdout.write(`Merged #${id}  ${NAVBOOK_ROOT}/${targetDir}/\n`);
  if (mergeSha) ctx.stdout.write(`Merge commit ${mergeSha.slice(0, 12)}\n`);
}

/**
 * Leave the merge in progress and say exactly how to finish it. The merge is
 * not aborted: the author's conflict resolution is worth keeping, and
 * `--continue` performs the archive step they would otherwise have to remember.
 */
function reportConflict(ctx: Ctx, id: string): never {
  fail(`merging #${id} produced conflicts`, [
    ...conflictedPaths(ctx.repoRoot).map((path) => `  ${path}`),
    "resolve them, 'git add' each one, then run 'nav pr merge --continue'",
    "or abandon the merge with 'git merge --abort'",
  ]);
}

interface LocatedPr {
  entity: EntityRecord;
  sourceRef: string;
}

/**
 * Find a pull request for merging. It normally lives on another branch, so the
 * working tree is searched first and the refs afterwards.
 */
function locatePr(ctx: Ctx, prefix: string): LocatedPr {
  const found = scanRefsForOpenPrs(ctx);
  const matches = found.filter((entry) => entry.entity.id.startsWith(prefix.toLowerCase()));
  if (matches.length === 0) fail(`no open pull request matches '${prefix}' on any fetched branch`);
  if (matches.length > 1) {
    fail(
      `'${prefix}' is ambiguous`,
      matches.map((entry) => `  #${entry.entity.id}  ${stringField(entry.entity, "title")}`),
    );
  }

  const entry = matches[0] as FoundPr;
  const declared = stringField(entry.entity, "source");
  const ref =
    entry.refs.find((candidate) => candidate === declared) ??
    entry.refs.find((candidate) => !candidate.includes("/")) ??
    (entry.refs[0] as string);
  return { entity: entry.entity, sourceRef: ref };
}

/* --------------------------------------------------------------------- close */

/**
 * Decline a pull request.
 *
 * Its files usually live on the source branch, so when the ID is not in the
 * current tree the directory is first checked out from the ref that has it —
 * which is exactly the manual recipe spec 02 §2.8 describes for keeping a
 * durable record of a declined PR on the default branch.
 */
export function cmdPrClose(ctx: Ctx, prefix: string, opts: CloseOptions): void {
  const repo = loadRepo(ctx, { includeComments: false });
  const present = allEntities(repo).some(
    (entity) => entity.kind === "pr" && entity.id.startsWith(prefix.toLowerCase()),
  );
  if (!present) {
    const materialized = materializeFromRef(ctx, prefix);
    ctx.stdout.write(
      `Brought #${materialized.id} onto this branch from ${materialized.ref} so it can be recorded\n`,
    );
  }
  cmdClose(ctx, "pr", prefix, opts);
}

interface Materialized {
  id: string;
  ref: string;
}

/** Check a pull request's directory out of the branch that carries it. */
function materializeFromRef(ctx: Ctx, prefix: string): Materialized {
  const { entity, sourceRef } = locatePr(ctx, prefix);
  const path = `${NAVBOOK_ROOT}/${entity.dirPath}`;
  if (gitMaybe(["checkout", sourceRef, "--", path], { cwd: ctx.repoRoot }) === null) {
    fail(`could not read ${path} from '${sourceRef}'`);
  }
  add(ctx.repoRoot, [path]);
  return { id: entity.id, ref: sourceRef };
}

export { scanRefsForOpenPrs };
