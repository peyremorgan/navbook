/**
 * The `doctor` check — spec 04 §4.3.
 *
 * Doctor enforces the specification, not a house style: hand edits that are
 * unusual but valid must pass. What counts as an error and what counts as a
 * warning is decided in `core/validate.ts`; this module gathers the tree those
 * checks judge, and applies the repairs they offer.
 */

import { NAVBOOK_ROOT } from "../core/json.ts";
import type { FileOp } from "../core/ops.ts";
import { parseTree, type Repo } from "../core/tree.ts";
import { type Diagnostic, sortDiagnostics, validateRepo } from "../core/validate.ts";
import { git, gitMaybe, splitNul } from "../git/exec.ts";
import { stagedContent, stagedPaths } from "../git/index-ops.ts";
import {
  applyOps,
  gitLinkConflictResolver,
  loadRepo,
  repoPath,
  requireNavbook,
  runHistoryChecks,
  type WsCtx,
} from "../workspace/index.ts";

export interface DoctorOptions {
  /** Check what is staged in the index rather than the working tree. */
  staged?: boolean;
  /** Apply the mechanical repairs the diagnostics offer. */
  fix?: boolean;
}

export interface DoctorReport {
  /** What is still wrong after any repairs were applied. */
  diagnostics: Diagnostic[];
  /** One line per repair made, in the order they were made. */
  applied: string[];
}

export function runDoctor(ws: WsCtx, opts: DoctorOptions = {}): DoctorReport {
  requireNavbook(ws);
  const repo = opts.staged ? stagedRepo(ws) : loadRepo(ws);
  const diagnostics = sortDiagnostics([
    ...validateRepo(repo, {
      commitMessages: recentCommitMessages(ws, opts),
      // Settling a disputed subtask means removing somebody's assertion, so it
      // is offered only when there is history to justify it and a --fix run to
      // apply it. --staged has neither: the commit under test does not exist.
      ...(opts.fix && !opts.staged ? { decideLinkConflict: gitLinkConflictResolver(ws) } : {}),
    }),
    // History-dependent checks are skipped for --staged: the commit being made
    // does not exist yet, so there is nothing for them to read.
    ...(opts.staged ? [] : runHistoryChecks(ws, repo)),
  ]);

  if (!opts.fix) return { diagnostics, applied: [] };
  // A link repair rewrites a whole file. Under --staged that file's content
  // came from the index, so writing it into the working tree would silently
  // discard whatever the author has not staged yet. Report, do not repair.
  const repairable = opts.staged ? diagnostics.map(withoutLinkRepair) : diagnostics;
  return {
    diagnostics: repairable.filter((d) => !d.fix),
    applied: applyFixes(ws, repairable),
  };
}

function withoutLinkRepair(diagnostic: Diagnostic): Diagnostic {
  if (diagnostic.check !== "D11" || !diagnostic.fix) return diagnostic;
  const { fix: _dropped, ...rest } = diagnostic;
  return rest;
}

/**
 * Apply every mechanical repair a diagnostic offers, reporting each one.
 *
 * Faults that share a file offer the same repair for it — the state every one
 * of them wanted — so an operation already carried out is skipped rather than
 * repeated, and the report says once what was done once.
 */
function applyFixes(ws: WsCtx, diagnostics: readonly Diagnostic[]): string[] {
  const applied: string[] = [];
  const done = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.fix || diagnostic.fix.length === 0) continue;
    const fresh = diagnostic.fix.filter((op) => !done.has(JSON.stringify(op)));
    if (fresh.length === 0) continue;
    applyOps(ws, fresh);
    for (const op of fresh) {
      done.add(JSON.stringify(op));
      applied.push(describeFix(op));
    }
  }
  return applied;
}

function describeFix(op: FileOp): string {
  switch (op.op) {
    case "move":
      return `moved ${repoPath(op.from)} to ${repoPath(op.to)}`;
    case "remove":
      return `removed ${repoPath(op.path)}`;
    default:
      return `wrote ${repoPath(op.path)}`;
  }
}

/** Build the repository model from what is staged rather than the working tree. */
function stagedRepo(ws: WsCtx): Repo {
  const prefix = `${NAVBOOK_ROOT}/`;
  const paths = allIndexedNavPaths(ws).filter((path) => path.startsWith(prefix));
  const files = new Map<string, string>();
  for (const path of paths) {
    const content = stagedContent(ws.repoRoot, path);
    if (content !== null) files.set(path.slice(prefix.length), content);
  }
  return parseTree(files);
}

/**
 * Every `.navbook/` path in the index. The pre-commit hook needs the whole
 * indexed tree, not only the changed paths: checks like ID uniqueness and
 * reply-to resolution are properties of the tree the commit will create.
 */
function allIndexedNavPaths(ws: WsCtx): string[] {
  const listed = splitNul(
    git(["ls-files", "--cached", "-z", "--", NAVBOOK_ROOT], { cwd: ws.repoRoot }),
  );
  return listed.length > 0 ? listed : stagedPaths(ws.repoRoot);
}

/**
 * Commit messages scanned for dangling trailers (check D8).
 *
 * Bounded to recent history: a trailer naming an entity that is not in this
 * tree is worth knowing about while the work is current, but the whole history
 * of a long-lived repository would produce standing noise for entities that
 * were legitimately archived or that live on a branch nobody has fetched.
 */
const TRAILER_SCAN_DEPTH = 100;

function recentCommitMessages(ws: WsCtx, opts: DoctorOptions): string[] {
  if (opts.staged) return [];
  const output = gitMaybe(["log", "--format=%B%x00", "-n", String(TRAILER_SCAN_DEPTH)], {
    cwd: ws.repoRoot,
  });
  if (output === null) return [];
  return output.split("\0").filter((message) => message.trim() !== "");
}
