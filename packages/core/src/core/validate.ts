/**
 * Format validation — the `nav doctor` checks of spec 04 §4.3.
 *
 * Checks D1–D6 and D8 are decidable from the tree alone and live here. D7, D9
 * and D10 need git archaeology; their tree-side halves live here and the
 * history queries are supplied by the CLI.
 */

import { parseCommentFileName } from "./comments.ts";
import {
  type Revision,
  readRevisions,
  readSubtasks,
  validateComment,
  validateIssue,
  validatePr,
} from "./files.ts";
import { isId } from "./id.ts";
import {
  faultPath,
  findLinkFaults,
  findLinkLoops,
  type LinkConflict,
  type LinkFault,
  planFaultRepair,
} from "./links.ts";
import { type FileOp, type LinkRepair, linkRepairOps } from "./ops.ts";
import { extractDeletedIds, extractProseRefs, extractTrailerRefs } from "./refs.ts";
import { parseDirName } from "./slug.ts";
import {
  allEntities,
  type EntityRecord,
  type NavTree,
  parseTree,
  type Repo,
  statusDir,
} from "./tree.ts";

export const CHECKS = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "D7",
  "D8",
  "D9",
  "D10",
  "D11",
  "D12",
] as const;
export type Check = (typeof CHECKS)[number];

export type Level = "error" | "warning";

export interface Diagnostic {
  check: Check;
  level: Level;
  /** Path relative to `.navbook/`, or "" for repository-wide findings. */
  path: string;
  message: string;
  /** Mechanical repair offered by `doctor --fix`. */
  fix?: FileOp[];
}

export const CHECK_LEVEL: Record<Check, Level> = {
  D1: "error",
  D2: "error",
  D3: "error",
  D4: "error",
  D5: "error",
  D6: "error",
  D7: "error",
  D8: "warning",
  D9: "warning",
  D10: "warning",
  D11: "error",
  D12: "error",
};

export interface ValidateOptions {
  /** Commit messages to scan for `Refs:`/`Closes:` trailers (check D8). */
  commitMessages?: readonly string[];
  /**
   * Which claimant wins when several issues claim the same subtask (check
   * D11). Only git history can answer that, so the tree-only caller leaves it
   * out and those conflicts are reported without a repair.
   */
  decideLinkConflict?: (fault: LinkConflict) => string | null;
}

/** Run every tree-decidable check. */
export function validateTree(files: NavTree, opts: ValidateOptions = {}): Diagnostic[] {
  return validateRepo(parseTree(files), opts);
}

/** Run every tree-decidable check against an already-parsed repository. */
export function validateRepo(repo: Repo, opts: ValidateOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  out.push(...checkNames(repo));
  out.push(...checkFrontmatter(repo));
  const { duplicates, uniqueIds } = collectIds(repo);
  out.push(...duplicates);
  out.push(...checkStatusUniqueness(repo));
  out.push(...checkReplyTargets(repo));
  out.push(...checkReviewRevisions(repo));
  out.push(...checkDanglingRefs(repo, uniqueIds, opts.commitMessages ?? []));
  out.push(...checkLinks(repo, opts));
  out.push(...checkLinkLoops(repo));
  return sortDiagnostics(out);
}

/** Stable ordering: by check, then path, then message. */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.check !== b.check) return CHECKS.indexOf(a.check) - CHECKS.indexOf(b.check);
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/** True when any diagnostic is an error (drives exit code 2). */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.level === "error");
}

/* --------------------------------------------------------------- D1 : names */

function checkNames(repo: Repo): Diagnostic[] {
  const fixes = new Map<string, FileOp[]>();
  for (const orphan of repo.orphans) {
    const entity = repo.byId.get(orphan.id);
    if (!entity || entity.kind !== orphan.kind || orphan.commentPaths.length === 0) continue;
    // The entity lives elsewhere: the stray comments belong with it (03 §3.3.1).
    fixes.set(
      orphan.dirPath,
      orphan.commentPaths.map((path) => ({
        op: "move" as const,
        from: path,
        to: `${entity.dirPath}/comments/${path.slice(path.lastIndexOf("/") + 1)}`,
      })),
    );
  }

  return repo.problems.map((problem) => {
    const fix = fixes.get(problem.path);
    const orphan = repo.orphans.find((o) => o.dirPath === problem.path);
    const entity = orphan ? repo.byId.get(orphan.id) : undefined;
    return {
      check: "D1" as const,
      level: "error" as const,
      path: problem.path,
      message:
        fix && entity
          ? `${problem.message}; #${orphan?.id} lives at ${entity.dirPath}, so its ${fix.length} stray comment file(s) belong there`
          : problem.message,
      ...(fix ? { fix } : {}),
    };
  });
}

/* --------------------------------------------------------- D2 : frontmatter */

function checkFrontmatter(repo: Repo): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const entity of allEntities(repo)) {
    const problems =
      entity.kind === "issue" ? validateIssue(entity.parsed) : validatePr(entity.parsed);
    for (const problem of problems) {
      out.push({ check: "D2", level: "error", path: entity.filePath, message: problem.message });
    }
    for (const comment of entity.comments) {
      for (const problem of validateComment(comment.parsed, { onPr: entity.kind === "pr" })) {
        out.push({ check: "D2", level: "error", path: comment.path, message: problem.message });
      }
    }
  }
  return out;
}

/* -------------------------------------------------- D3 : ID uniqueness */

function collectIds(repo: Repo): { duplicates: Diagnostic[]; uniqueIds: Set<string> } {
  const seen = new Map<string, string[]>();
  const entityStatuses = new Map<string, Set<string>>();

  for (const entity of allEntities(repo)) {
    push(seen, entity.id, entity.dirPath);
    const key = `${entity.kind}/${entity.status}`;
    const bucket = entityStatuses.get(entity.id);
    if (bucket) bucket.add(key);
    else entityStatuses.set(entity.id, new Set([key]));
    for (const comment of entity.comments) push(seen, comment.id, comment.path);
  }

  const duplicates: Diagnostic[] = [];
  for (const [id, paths] of seen) {
    if (paths.length < 2) continue;
    // A single entity living in two status directories is reported by D4.
    if (
      (entityStatuses.get(id)?.size ?? 0) > 1 &&
      paths.length === (entityStatuses.get(id)?.size ?? 0)
    ) {
      continue;
    }
    duplicates.push({
      check: "D3",
      level: "error",
      path: paths.slice().sort()[0] as string,
      message: `id '${id}' is used ${paths.length} times: ${paths.slice().sort().join(", ")}`,
    });
  }
  return { duplicates, uniqueIds: new Set(seen.keys()) };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/* ------------------------------------------------ D4 : one status directory */

function checkStatusUniqueness(repo: Repo): Diagnostic[] {
  const byId = new Map<string, EntityRecord[]>();
  for (const entity of allEntities(repo)) {
    const bucket = byId.get(entity.id);
    if (bucket) bucket.push(entity);
    else byId.set(entity.id, [entity]);
  }
  const out: Diagnostic[] = [];
  for (const [id, records] of byId) {
    const locations = new Set(records.map((r) => `${r.kind}/${r.status}`));
    if (locations.size < 2) continue;
    const paths = records.map((r) => r.dirPath).sort();
    out.push({
      check: "D4",
      level: "error",
      path: paths[0] as string,
      message: `#${id} exists in more than one status directory: ${paths.join(", ")} (spec 03 §3.4)`,
    });
  }
  return out;
}

/* --------------------------------------------------------- D5 : reply-to */

function checkReplyTargets(repo: Repo): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const entity of allEntities(repo)) {
    const ids = new Set(entity.comments.map((c) => c.id));
    for (const comment of entity.comments) {
      if (!comment.replyTo) continue;
      if (comment.replyTo === comment.id) {
        out.push({
          check: "D5",
          level: "error",
          path: comment.path,
          message: `'reply-to' points at the comment itself (${comment.replyTo})`,
        });
        continue;
      }
      if (!ids.has(comment.replyTo)) {
        out.push({
          check: "D5",
          level: "error",
          path: comment.path,
          message: `'reply-to: ${comment.replyTo}' does not name a comment of #${entity.id}`,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------- D6 : review revisions */

function checkReviewRevisions(repo: Repo): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const pr of repo.prs) {
    const heads = new Set(readRevisions(pr.fm).map((r) => r.head));
    for (const comment of pr.comments) {
      const revision = comment.parsed.fm.revision;
      if (typeof revision !== "string") continue;
      if (!heads.has(revision)) {
        out.push({
          check: "D6",
          level: "error",
          path: comment.path,
          message: `revision ${revision.slice(0, 12)} is not a recorded revision head of #${pr.id} (spec 03 §3.5)`,
        });
      }
    }
  }
  return out;
}

/* ---------------------------------------------------- D8 : dangling refs */

function checkDanglingRefs(
  repo: Repo,
  knownIds: ReadonlySet<string>,
  commitMessages: readonly string[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const report = (path: string, ids: string[], kind: string): void => {
    for (const id of ids) {
      if (knownIds.has(id)) continue;
      out.push({
        check: "D8",
        level: "warning",
        path,
        message: `${kind} reference #${id} matches no entity or comment in this tree`,
      });
    }
  };

  for (const entity of allEntities(repo)) {
    report(entity.filePath, extractProseRefs(entity.body), "prose");
    for (const key of ["duplicate-of", "superseded-by", "parent"] as const) {
      const value = entity.fm[key];
      if (typeof value === "string" && isId(value) && !knownIds.has(value)) {
        out.push({
          check: "D8",
          level: "warning",
          path: entity.filePath,
          message: `'${key}: ${value}' matches no entity in this tree`,
        });
      }
    }
    for (const id of new Set(readSubtasks(entity.fm))) {
      if (knownIds.has(id)) continue;
      out.push({
        check: "D8",
        level: "warning",
        path: entity.filePath,
        message: `'subtasks' entry ${id} matches no entity in this tree`,
      });
    }
    for (const comment of entity.comments)
      report(comment.path, extractProseRefs(comment.body), "prose");
  }

  // An entity that a later commit deleted is absent on purpose. History cannot
  // be rewritten to match, so warning about the trailers that named it while it
  // existed would be standing noise about nothing anyone can fix. Prose and
  // frontmatter references to it are still reported: those live in files.
  const deleted = new Set<string>();
  for (const message of commitMessages) {
    for (const id of extractDeletedIds(message)) deleted.add(id);
  }

  const seen = new Set<string>();
  for (const message of commitMessages) {
    const { refs, closes } = extractTrailerRefs(message);
    for (const id of [...refs, ...closes]) {
      if (knownIds.has(id) || deleted.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({
        check: "D8",
        level: "warning",
        path: "",
        message: `commit trailer references #${id}, which matches no entity in this tree`,
      });
    }
  }
  return out;
}

/* --------------------------------------------- D11 : parent/subtask links */

/**
 * Both sides of every decomposition link must agree (§2.5).
 *
 * Repairs are planned for the whole tree before any diagnostic is given one, so
 * a file two faults implicate is written once, with the state both of them
 * wanted. Applying such a fix therefore settles its neighbour too — which is
 * exactly right, since `doctor --fix` applies them all in one pass.
 */
function checkLinks(repo: Repo, opts: ValidateOptions): Diagnostic[] {
  const decideConflict = opts.decideLinkConflict;
  const faults = findLinkFaults(repo);
  const merged = new Map<string, { entity: EntityRecord; edit: MutableLinkEdit }>();
  const repairs = faults.map((fault) => {
    const plan = planFaultRepair(repo, fault, decideConflict ?? (() => null));
    if (plan) for (const repair of plan) mergeEdit(merged, repair);
    return plan;
  });

  return faults.map((fault, index) => {
    const plan = repairs[index];
    const fix = plan ? renderLinkFix(plan, merged) : [];
    return {
      check: "D11" as const,
      level: "error" as const,
      path: faultPath(fault),
      message: linkFaultMessage(fault, {
        fixed: fix.length > 0,
        historyConsulted: decideConflict !== undefined,
      }),
      ...(fix.length > 0 ? { fix } : {}),
    };
  });
}

type MutableLinkEdit = { addSubtasks: string[]; removeSubtasks: string[]; parent?: string | null };

function mergeEdit(
  merged: Map<string, { entity: EntityRecord; edit: MutableLinkEdit }>,
  repair: LinkRepair,
): void {
  let entry = merged.get(repair.entity.id);
  if (!entry) {
    entry = { entity: repair.entity, edit: { addSubtasks: [], removeSubtasks: [] } };
    merged.set(repair.entity.id, entry);
  }
  entry.edit.addSubtasks.push(...(repair.edit.addSubtasks ?? []));
  entry.edit.removeSubtasks.push(...(repair.edit.removeSubtasks ?? []));
  if (repair.edit.parent !== undefined) entry.edit.parent = repair.edit.parent;
}

/**
 * The write ops one fault's repair needs, carrying each file's *final* content.
 *
 * A file cannot be written twice with different content by one `--fix` run, so
 * every diagnostic that touches it offers the same bytes.
 */
function renderLinkFix(
  plan: readonly LinkRepair[],
  merged: ReadonlyMap<string, { entity: EntityRecord; edit: MutableLinkEdit }>,
): FileOp[] {
  try {
    return linkRepairOps(plan.map(({ entity }) => merged.get(entity.id) ?? { entity, edit: {} }));
  } catch {
    // Link keys too malformed to rewrite: check D2 reports them, and a repair
    // that had to guess what the author meant would be worse than none.
    return [];
  }
}

interface FaultContext {
  /** A repair was planned, so the run has already said what it will do. */
  fixed: boolean;
  /** History was available to settle a conflict; without --fix it is not. */
  historyConsulted: boolean;
}

function linkFaultMessage(fault: LinkFault, ctx: FaultContext): string {
  switch (fault.kind) {
    case "parent-missing-child":
      return `#${fault.child.id} names this issue as its parent, but 'subtasks' does not list it`;
    case "child-missing-parent":
      return `#${fault.parent.id} lists this issue as a subtask, but 'parent' does not name it${
        ctx.fixed ? "" : "; linking it back would close a loop, so resolve it by hand"
      }`;
    case "duplicate":
      return `'subtasks' lists #${fault.childId} more than once`;
    case "not-an-issue":
      return `'${fault.key}' names #${fault.otherId}, which is a pull request; decomposition relates issues only (§2.5)`;
    default:
      return `${fault.claimants.map((id) => `#${id}`).join(" and ")} disagree about the parent of #${fault.child.id}${conflictAdvice(ctx)}`;
  }
}

function conflictAdvice(ctx: FaultContext): string {
  if (ctx.fixed) return "";
  if (!ctx.historyConsulted) return "; 'nav doctor --fix' settles it from git history";
  return "; git history does not say which claim came last, so settle it with 'nav issue link' or 'nav issue unlink'";
}

/* ------------------------------------------------ D12 : loops in the tree */

function checkLinkLoops(repo: Repo): Diagnostic[] {
  return findLinkLoops(repo).map((loop) => ({
    check: "D12" as const,
    level: "error" as const,
    path: loop.path,
    message:
      loop.via === "subtasks"
        ? `'subtasks' lists #${loop.ids[0]} itself; an issue cannot be its own subtask`
        : loop.ids.length === 1
          ? `'parent' names #${loop.ids[0]} itself; an issue cannot be its own parent`
          : `the 'parent' chain loops: ${[...loop.ids, loop.ids[0]].map((id) => `#${id}`).join(" -> ")}`,
  }));
}

/* ------------------------------------- D7 / D9 helpers (git-fed, pure core) */

/**
 * D7: each historical `revisions` list must be a prefix of the next one.
 * `versionsOldestFirst` holds the list as it stood in each commit that touched
 * the file, oldest first.
 */
export function checkRevisionsAppendOnly(
  versionsOldestFirst: readonly Revision[][],
): { ok: true } | { ok: false; index: number; message: string } {
  for (let i = 1; i < versionsOldestFirst.length; i++) {
    const before = versionsOldestFirst[i - 1] as Revision[];
    const after = versionsOldestFirst[i] as Revision[];
    if (after.length < before.length) {
      return {
        ok: false,
        index: i,
        message: `revisions list shrank from ${before.length} to ${after.length} entries`,
      };
    }
    for (let j = 0; j < before.length; j++) {
      const a = before[j] as Revision;
      const b = after[j] as Revision;
      if (a.head !== b.head || a.base !== b.base || a.date !== b.date) {
        return { ok: false, index: i, message: `revisions[${j}] was edited after being recorded` };
      }
    }
  }
  return { ok: true };
}

/** D10: is a frontmatter timestamp implausible next to the commit that added it? */
export function checkTimestampSkew(
  frontmatterIso: Date,
  gitAuthoredIso: Date,
  thresholdHours: number,
): boolean {
  const deltaHours = Math.abs(frontmatterIso.getTime() - gitAuthoredIso.getTime()) / 3_600_000;
  return deltaHours <= thresholdHours;
}

/** Where a merged-but-unarchived pull request should be moved (check D9). */
export function planD9Fix(entity: EntityRecord): FileOp[] {
  const target = `${statusDir("pr", "merged")}/${entity.dirName}`;
  return [{ op: "move", from: entity.dirPath, to: target }];
}

/** Validate a bare entity directory name, used by `doctor` on hand-made trees. */
export function isValidEntityDirName(name: string): boolean {
  const parsed = parseDirName(name);
  return parsed !== null && isId(parsed.id);
}

/** Validate a bare comment filename. */
export function isValidCommentFileName(name: string): boolean {
  return parseCommentFileName(name) !== null;
}
