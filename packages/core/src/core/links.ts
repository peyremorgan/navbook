/**
 * Issue decomposition — the `parent`/`subtasks` link graph of spec 02 §2.5.
 *
 * The two sides of a link are deliberately redundant: a child names its parent
 * and a parent lists its subtasks, so either file answers its own question
 * without opening the other. Redundancy has a price, which is that the sides
 * can disagree; everything needed to detect that, and to work out what the
 * tree should have looked like, lives here.
 *
 * The `parent` scalar is the authoritative direction. It is a single value, so
 * it can express "this issue belongs to exactly one other" — which is what
 * makes the structure a tree rather than an arbitrary graph — and it is what
 * {@link descendantsOf} and the cycle check walk.
 */

import { readParent, readSubtasks } from "./files.ts";
import type { LinkRepair } from "./ops.ts";
import type { EntityRecord, Repo } from "./tree.ts";

/** Issues only: pull requests never take part in decomposition (§2.5). */
function issueById(repo: Repo, id: string): EntityRecord | undefined {
  const entity = repo.byId.get(id);
  return entity?.kind === "issue" ? entity : undefined;
}

/** The issue an issue names as its parent, when that issue is in this tree. */
export function parentOf(repo: Repo, issue: EntityRecord): EntityRecord | undefined {
  const id = readParent(issue.fm);
  if (id === null || id === issue.id) return undefined;
  return issueById(repo, id);
}

/** An issue's ancestors, nearest first, stopping at a cycle or a dangling id. */
export function ancestorsOf(repo: Repo, issue: EntityRecord): EntityRecord[] {
  const out: EntityRecord[] = [];
  const seen = new Set<string>([issue.id]);
  let current = parentOf(repo, issue);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current);
    current = parentOf(repo, current);
  }
  return out;
}

/** True when `ancestorId` is `issue` itself or one of its ancestors. */
export function inParentChain(repo: Repo, issue: EntityRecord, ancestorId: string): boolean {
  if (issue.id === ancestorId) return true;
  return ancestorsOf(repo, issue).some((entity) => entity.id === ancestorId);
}

/**
 * Every issue below `root` in the parent chain, nearest generation first.
 *
 * Membership follows `parent` rather than `subtasks` because that is the
 * authoritative side: an issue is a descendant when it says so. A stray
 * `subtasks` entry naming an issue that does not agree is a broken link for
 * `doctor` to report, not a reason to treat that issue as part of the subtree.
 */
export function descendantsOf(repo: Repo, root: EntityRecord): EntityRecord[] {
  const childrenByParent = new Map<string, EntityRecord[]>();
  for (const issue of repo.issues) {
    const parentId = readParent(issue.fm);
    if (parentId === null || parentId === issue.id) continue;
    const bucket = childrenByParent.get(parentId);
    if (bucket) bucket.push(issue);
    else childrenByParent.set(parentId, [issue]);
  }

  const out: EntityRecord[] = [];
  const seen = new Set<string>([root.id]);
  let frontier = [root];
  while (frontier.length > 0) {
    const next: EntityRecord[] = [];
    for (const issue of frontier) {
      for (const child of childrenByParent.get(issue.id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return out;
}

/** Every issue whose `subtasks` list names `id`, whether or not `id` agrees. */
export function listersOf(repo: Repo, id: string): EntityRecord[] {
  return repo.issues.filter((issue) => readSubtasks(issue.fm).includes(id));
}

/** {@link listersOf} for every id at once, in one pass over the tree. */
function listerIndex(repo: Repo): Map<string, EntityRecord[]> {
  const index = new Map<string, EntityRecord[]>();
  for (const issue of repo.issues) {
    for (const id of new Set(readSubtasks(issue.fm))) {
      const bucket = index.get(id);
      if (bucket) bucket.push(issue);
      else index.set(id, [issue]);
    }
  }
  return index;
}

/* ------------------------------------------------------------ link guards */

export type LinkRefusal =
  /** An issue cannot be its own parent. */
  | { kind: "self" }
  /** The link already exists on both sides; there is nothing to do. */
  | { kind: "already-linked" }
  /** The proposed parent is a descendant, so the link would close a loop. */
  | { kind: "cycle"; chain: string[] };

/**
 * Why `child` may not be filed under `parent`, or null when the link is fine.
 *
 * Shared by every entry point that creates a link, so `open --parent` and
 * `link` can never disagree about what is allowed.
 */
export function linkRefusal(
  repo: Repo,
  child: EntityRecord,
  parent: EntityRecord,
): LinkRefusal | null {
  if (child.id === parent.id) return { kind: "self" };
  if (inParentChain(repo, parent, child.id)) {
    const chain = [parent, ...ancestorsOf(repo, parent)];
    const upToChild = chain.slice(0, chain.findIndex((entity) => entity.id === child.id) + 1);
    return { kind: "cycle", chain: upToChild.map((entity) => entity.id) };
  }
  // "Already linked" has to mean there is nothing left to mend, or the verb
  // that exists to put a link right would refuse the one case it is needed for.
  if (
    readParent(child.fm) === parent.id &&
    readSubtasks(parent.fm).includes(child.id) &&
    !readSubtasks(child.fm).includes(parent.id)
  ) {
    return { kind: "already-linked" };
  }
  return null;
}

/* ------------------------------------------------------- broken links */

/**
 * A disagreement between the two sides of a link, or an entry that cannot mean
 * what it says. Each one names the file a repair would write.
 */
export type LinkFault =
  /** The child names a parent whose `subtasks` does not list it back. */
  | { kind: "parent-missing-child"; child: EntityRecord; parent: EntityRecord }
  /** A parent lists a child that records no parent of its own. */
  | { kind: "child-missing-parent"; child: EntityRecord; parent: EntityRecord }
  /** Several issues claim the same child, or the child names a different one. */
  | { kind: "conflict"; child: EntityRecord; claimants: string[]; listers: EntityRecord[] }
  /** One `subtasks` list names the same issue more than once. */
  | { kind: "duplicate"; parent: EntityRecord; childId: string }
  /** A link names a pull request; decomposition relates issues only (§2.5). */
  | { kind: "not-an-issue"; holder: EntityRecord; key: "parent" | "subtasks"; otherId: string };

/** The file a fault is reported against, and that repairing it would rewrite. */
export function faultPath(fault: LinkFault): string {
  switch (fault.kind) {
    case "parent-missing-child":
      return fault.parent.filePath;
    case "duplicate":
      return fault.parent.filePath;
    case "not-an-issue":
      return fault.holder.filePath;
    default:
      return fault.child.filePath;
  }
}

/**
 * Every way the link graph disagrees with itself.
 *
 * The unit of judgement is the child, not the pair: an issue has at most one
 * parent, so every claim about it — its own `parent` key and every `subtasks`
 * list naming it — is an answer to a single question. Deciding them together
 * is what stops a repair of one pair from breaking another.
 *
 * Ids that match nothing in the tree are left alone: the target may live on a
 * branch nobody has fetched, which is check D8's business and not an error.
 */
export function findLinkFaults(repo: Repo): LinkFault[] {
  const faults: LinkFault[] = [];
  // Indexed once: asking the tree per issue who claims it would make the check
  // quadratic, and doctor runs over every issue there is.
  const listers = listerIndex(repo);

  for (const parent of repo.issues) {
    const seen = new Set<string>();
    for (const id of readSubtasks(parent.fm)) {
      if (id === parent.id) continue; // a loop of one: check D12 reports it
      if (seen.has(id)) {
        if (
          !faults.some((f) => f.kind === "duplicate" && f.parent === parent && f.childId === id)
        ) {
          faults.push({ kind: "duplicate", parent, childId: id });
        }
        continue;
      }
      seen.add(id);
      const target = repo.byId.get(id);
      if (target && target.kind !== "issue") {
        faults.push({ kind: "not-an-issue", holder: parent, key: "subtasks", otherId: id });
      }
    }
  }

  for (const child of repo.issues) {
    const claimedId = readParent(child.fm);
    if (claimedId === child.id) continue; // a loop of one: check D12 reports it

    const claimed = claimedId === null ? undefined : repo.byId.get(claimedId);
    if (claimed && claimed.kind !== "issue") {
      faults.push({ kind: "not-an-issue", holder: child, key: "parent", otherId: claimed.id });
      continue; // the claim is void; resolving the rest would be guesswork
    }

    const claimants = (listers.get(child.id) ?? []).filter((e) => e.id !== child.id);
    const candidates = [
      ...new Set([...(claimedId === null ? [] : [claimedId]), ...claimants.map((e) => e.id)]),
    ];
    if (candidates.length === 0) continue;

    if (candidates.length > 1) {
      faults.push({ kind: "conflict", child, claimants: candidates.sort(), listers: claimants });
      continue;
    }
    const only = candidates[0] as string;
    if (claimedId !== only) {
      const parent = claimants[0] as EntityRecord;
      faults.push({ kind: "child-missing-parent", child, parent });
      continue;
    }
    // The child's own claim stands alone — nothing lists it, or the index
    // would have made the parent a claimant too. Only an in-tree parent can be
    // asked to confirm it; one on an unfetched branch cannot, and is no fault.
    const parent = issueById(repo, only);
    if (parent && claimants.length === 0) {
      faults.push({ kind: "parent-missing-child", child, parent });
    }
  }

  return faults;
}

/** Why a fault was left alone, so a report can say which it was. */
export type RepairRefusal =
  /** A link names a pull request; nothing about it can be mended mechanically. */
  | "not-an-issue"
  /** A claim names an issue this tree does not hold, so it cannot be weighed. */
  | "off-tree-claimant"
  /** A file the repair would rewrite has link keys nothing can read (D2). */
  | "unreadable"
  /** History did not say which of the competing claims was made last. */
  | "undecided"
  /** The repair would file an issue below itself. */
  | "would-loop";

export type FaultRepair =
  | { ok: true; repairs: LinkRepair[] }
  | { ok: false; reason: RepairRefusal };

/**
 * How to mend one fault, or why it was left for a person.
 *
 * `decideConflict` is consulted only where the claims genuinely disagree; it
 * returns the id of the claimant whose word should stand, or null when history
 * cannot say. Everything else is decidable from the tree: adding a reciprocal
 * entry and dropping a repeated one both preserve every assertion the files
 * make, which is what makes them safe to apply unasked.
 */
export function planFaultRepair(
  repo: Repo,
  fault: LinkFault,
  decideConflict: (fault: LinkConflict) => string | null,
): FaultRepair {
  switch (fault.kind) {
    case "not-an-issue":
      return { ok: false, reason: "not-an-issue" };
    case "duplicate":
      return { ok: true, repairs: [{ entity: fault.parent, edit: {} }] };
    case "parent-missing-child":
      return {
        ok: true,
        repairs: [{ entity: fault.parent, edit: { addSubtasks: [fault.child.id] } }],
      };
    case "child-missing-parent": {
      if (inParentChain(repo, fault.parent, fault.child.id)) {
        return { ok: false, reason: "would-loop" };
      }
      return { ok: true, repairs: [{ entity: fault.child, edit: { parent: fault.parent.id } }] };
    }
    default: {
      // A claim on an issue nobody here can see is not one this tree may
      // overrule. The absent issue may well be the right parent, on a branch
      // that has not been fetched — §2.5 exempts exactly that from D11 — and a
      // repair would delete the only record that it exists.
      if (fault.claimants.some((id) => issueById(repo, id) === undefined)) {
        return { ok: false, reason: "off-tree-claimant" };
      }
      const winner = decideConflict(fault);
      if (winner === null) return { ok: false, reason: "undecided" };
      const parent = issueById(repo, winner);
      if (!parent) return { ok: false, reason: "off-tree-claimant" };
      if (inParentChain(repo, parent, fault.child.id)) return { ok: false, reason: "would-loop" };
      return {
        ok: true,
        repairs: [
          { entity: fault.child, edit: { parent: parent.id } },
          { entity: parent, edit: { addSubtasks: [fault.child.id] } },
          ...fault.listers
            .filter((entity) => entity.id !== parent.id)
            .map((entity) => ({ entity, edit: { removeSubtasks: [fault.child.id] } })),
        ],
      };
    }
  }
}

export type LinkConflict = Extract<LinkFault, { kind: "conflict" }>;

/* ----------------------------------------------------------------- loops */

export interface LinkLoop {
  /** The issues on the loop, smallest id first, or the one issue naming itself. */
  ids: string[];
  path: string;
  /** Which key closes the loop: a `parent` chain, or an issue listing itself. */
  via: "parent" | "subtasks";
}

/**
 * Loops in the decomposition graph — the one thing a tree may never contain.
 *
 * Walking `parent` finds every loop of length two or more; an issue naming
 * itself in either key is the degenerate case of the same fault. No repair is
 * offered: every link on a loop is equally suspect, and only its author knows
 * which one was the mistake.
 */
export function findLinkLoops(repo: Repo): LinkLoop[] {
  const loops: LinkLoop[] = [];
  const found = new Set<string>();
  const record = (ids: string[], via: LinkLoop["via"]): void => {
    const canonical = canonicalLoop(ids);
    const key = `${via}:${canonical.join(",")}`;
    if (found.has(key)) return;
    found.add(key);
    const first = issueById(repo, canonical[0] as string);
    loops.push({ ids: canonical, path: first?.filePath ?? "", via });
  };

  for (const issue of repo.issues) {
    if (readSubtasks(issue.fm).includes(issue.id)) record([issue.id], "subtasks");
  }

  const settled = new Set<string>();
  for (const start of repo.issues) {
    if (settled.has(start.id)) continue;
    const walk: string[] = [];
    const onWalk = new Map<string, number>();
    let current: EntityRecord | undefined = start;
    while (current && !settled.has(current.id)) {
      const at = onWalk.get(current.id);
      if (at !== undefined) {
        record(walk.slice(at), "parent");
        break;
      }
      onWalk.set(current.id, walk.length);
      walk.push(current.id);
      const nextId: string | null = readParent(current.fm);
      current = nextId === null ? undefined : issueById(repo, nextId);
    }
    for (const id of walk) settled.add(id);
  }
  return loops;
}

/** Rotate a loop so the smallest id leads, making the same loop one finding. */
function canonicalLoop(ids: string[]): string[] {
  let smallest = 0;
  for (let i = 1; i < ids.length; i++) {
    if ((ids[i] as string) < (ids[smallest] as string)) smallest = i;
  }
  return [...ids.slice(smallest), ...ids.slice(0, smallest)];
}

/* ------------------------------------------------------- rendering a tree */

export interface LinkNode {
  id: string;
  /** Absent when the id matches no issue in this tree. */
  entity?: EntityRecord;
  /** The id names a pull request, which decomposition never relates (§2.5). */
  notAnIssue?: boolean;
  /** The id is an ancestor of itself: the chain loops here. */
  cycle?: boolean;
  /** Already expanded elsewhere in this render; not expanded again. */
  repeated?: boolean;
  children: LinkNode[];
}

/**
 * One end of a link as something a reader can be shown.
 *
 * "Not here" and "here but not an issue" are different things to be told, so
 * they are different nodes rather than one absence.
 */
function linkNode(repo: Repo, id: string): LinkNode {
  const entity = repo.byId.get(id);
  if (!entity) return { id, children: [] };
  if (entity.kind !== "issue") return { id, notAnIssue: true, children: [] };
  return { id, entity, children: [] };
}

/** The issue's parent as a renderable node, or undefined when it names none. */
export function parentNode(repo: Repo, issue: EntityRecord): LinkNode | undefined {
  const id = readParent(issue.fm);
  return id === null ? undefined : linkNode(repo, id);
}

/**
 * The subtask forest under an issue, `depth` levels deep.
 *
 * Rendered from each issue's own `subtasks` list, in the order the file gives,
 * because that is what the file says; a list that disagrees with the children's
 * own `parent` keys is a broken link for `doctor` to report, not something a
 * renderer should quietly paper over. Each issue is expanded at most once, so
 * neither a loop nor a diamond can make the output grow without bound.
 */
export function subtaskTree(repo: Repo, issue: EntityRecord, depth: number): LinkNode[] {
  const expanded = new Set<string>([issue.id]);

  const build = (
    parent: EntityRecord,
    remaining: number,
    path: ReadonlySet<string>,
  ): LinkNode[] => {
    if (remaining <= 0) return [];
    return readSubtasks(parent.fm).map((id) => {
      const node = linkNode(repo, id);
      const entity = node.entity;
      if (!entity) return node;
      if (path.has(id)) return { ...node, cycle: true };
      // At the limit nothing below is shown for anyone, so this occurrence
      // hides nothing and must not claim the issue: a shallower one further
      // along the list still has room to expand it.
      if (remaining <= 1) return node;
      if (expanded.has(id)) return { ...node, repeated: true };
      expanded.add(id);
      return { ...node, children: build(entity, remaining - 1, new Set([...path, id])) };
    });
  };

  return build(issue, depth, new Set([issue.id]));
}
