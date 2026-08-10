/**
 * Issue operations — spec 04 §4.3.
 *
 * Issues have decomposition of their own; everything else they do is a shared
 * verb from `entity.ts`.
 */

import { parseFile, readParent, readSubtasks } from "../core/files.ts";
import { linkRefusal, listersOf, parentOf } from "../core/links.ts";
import { type Plan, planAddSubtask, planLink, planPaths, planUnlink } from "../core/ops.ts";
import type { EntityRecord } from "../core/tree.ts";
import {
  assertNoUnrelatedStaged,
  loadRepo,
  type RunPlanResult,
  repoPath,
  resolveEntity,
  runPlan,
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

export interface OpenIssueResult extends OpenEntityResult {
  /** The issue it was filed under, when the composed file names one. */
  parent?: EntityRecord;
}

/**
 * File a new issue from a composed file.
 *
 * The parent's side of the link joins the same plan, so an issue opened as a
 * subtask is never momentarily orphaned: one commit, both files. No loop is
 * possible — the id was minted a moment ago and nothing can descend from it.
 *
 * Which parent is read back out of the composed file, exactly as the title is:
 * `--parent` seeds the buffer, and an author who edited or removed the key in
 * `$EDITOR` meant it. The tree is re-read at the same moment, so the parent's
 * file is rewritten from what it says now rather than from a snapshot taken
 * before the editor opened.
 */
export function openIssue(ws: WsCtx, input: OpenInput, opts: CommitOptions): OpenIssueResult {
  let parent: EntityRecord | undefined;
  const result = openEntity(ws, "issue", input, opts, (plan, id) => {
    parent = composedParent(ws, input.content);
    if (!parent) return plan;
    const filedUnder = parent;
    // Through rewritePlan, so a parent whose own link keys cannot be read is
    // reported the way `nav issue link` reports it: naming the file, and what
    // to do about it.
    return rewritePlan(filedUnder, () => ({
      ...plan,
      ops: [...plan.ops, ...planAddSubtask(filedUnder, id)],
      trailers: [...plan.trailers, { key: "Refs", id: filedUnder.id }],
    }));
  });
  return { ...result, ...(parent ? { parent } : {}) };
}

/** The issue a composed `issue.md` names as its parent, when it is in the tree. */
function composedParent(ws: WsCtx, content: string): EntityRecord | undefined {
  let parentId: string | null;
  try {
    parentId = readParent(parseFile(content).fm);
  } catch {
    // An unparseable buffer is the composer's business; it never gets this far.
    return undefined;
  }
  if (parentId === null) return undefined;
  const found = loadRepo(ws).byId.get(parentId);
  // A parent that is not here, or is not an issue, leaves the link one-sided
  // for `doctor` to report rather than being quietly rewritten into something
  // the author did not ask for.
  return found?.kind === "issue" ? found : undefined;
}

/** Resolve the issue named by `--parent`, failing before anything is composed. */
export function findParentIssue(ws: WsCtx, ref: string): EntityRecord {
  return resolveEntity(loadRepo(ws), ref, "issue");
}

/* --------------------------------------------------------------- link */

export interface IssueLinkPlan {
  child: EntityRecord;
  parent: EntityRecord;
  /** The id the child recorded before, when it named a different issue. */
  previousParentId?: string;
  /** That issue, when it is in this tree; a dangling one has no record. */
  previousParent?: EntityRecord;
  plan: Plan;
}

/**
 * Describe filing one issue under another — spec 04 §4.3.
 *
 * Split from {@link executeIssueLink} because moving a subtask that already has
 * a parent is a decision only the caller can put to the user, and the staged
 * guard belongs before that question: being told a `--commit` cannot run is
 * better than confirming one that then refuses.
 */
export function planIssueLink(
  ws: WsCtx,
  childRef: string,
  parentRef: string,
  opts: CommitOptions,
): IssueLinkPlan {
  const repo = loadRepo(ws);
  const child = resolveEntity(repo, childRef, "issue");
  const parent = resolveEntity(repo, parentRef, "issue");

  const refusal = linkRefusal(repo, child, parent);
  if (refusal?.kind === "self") {
    wsFail("precondition", `#${child.id} cannot be a subtask of itself`);
  }
  if (refusal?.kind === "cycle") {
    wsFail(
      "precondition",
      `#${parent.id} is already below #${child.id}, so the link would form a loop`,
      [refusal.chain.map((id) => `#${id}`).join(" -> ")],
    );
  }
  if (refusal?.kind === "already-linked") {
    wsFail("precondition", `#${child.id} is already a subtask of #${parent.id}`);
  }

  const previousParentId = readParent(child.fm);
  const previousParent = parentOf(repo, child);
  const staleListers = listersOf(repo, child.id).filter((entity) => entity.id !== parent.id);

  const plan = rewritePlan(child, () => planLink(child, parent, staleListers));
  if (opts.commit) assertNoUnrelatedStaged(ws, planPaths(plan).map(repoPath));

  return {
    child,
    parent,
    ...(previousParentId !== null && previousParentId !== parent.id ? { previousParentId } : {}),
    ...(previousParent && previousParent.id !== parent.id ? { previousParent } : {}),
    plan,
  };
}

/** Carry out a link the caller has decided to go ahead with. */
export function executeIssueLink(
  ws: WsCtx,
  link: IssueLinkPlan,
  opts: CommitOptions,
): RunPlanResult {
  return runPlan(ws, link.plan, { commit: opts.commit });
}

/* ------------------------------------------------------------- unlink */

export interface IssueUnlinkResult {
  child: EntityRecord;
  /** The id the child recorded, when it recorded one. */
  parentId?: string;
  run: RunPlanResult;
}

/**
 * Detach an issue from its parent — spec 04 §4.3.
 *
 * Every claim on the issue goes, not only the one it agreed with: afterwards no
 * issue lists it, which is the only reading of "unlinked" that leaves nothing
 * for `doctor` to report. That also makes this the way out of a link a person
 * broke by hand.
 */
export function unlinkIssue(ws: WsCtx, ref: string, opts: CommitOptions): IssueUnlinkResult {
  const repo = loadRepo(ws);
  const child = resolveEntity(repo, ref, "issue");
  const parentId = readParent(child.fm);
  const listers = listersOf(repo, child.id).filter((entity) => entity.id !== child.id);

  const selfListed = readSubtasks(child.fm).includes(child.id);
  if (parentId === null && listers.length === 0 && !selfListed) {
    wsFail("precondition", `#${child.id} is not a subtask of any issue`);
  }

  const plan = rewritePlan(child, () => planUnlink(child, listers));
  return {
    child,
    ...(parentId !== null ? { parentId } : {}),
    run: runPlan(ws, plan, { commit: opts.commit }),
  };
}
