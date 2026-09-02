/**
 * The `doctor` check — spec 04 §4.3.
 *
 * Doctor enforces the specification, not a house style: hand edits that are
 * unusual but valid must pass. What counts as an error and what counts as a
 * warning is decided in `core/validate.ts`; this module gathers the tree those
 * checks judge, and applies the repairs they offer.
 */

import type { FileOp } from "../core/ops.ts";
import { parseTree, type Repo } from "../core/tree.ts";
import { type Diagnostic, sortDiagnostics, validateRepo } from "../core/validate.ts";
import { git, gitMaybe, splitNul } from "../git/exec.ts";
import { stagedContent, stagedPaths } from "../git/index-ops.ts";
import {
  applyOps,
  loadRepo,
  repoPath,
  requireNavbook,
  resolveLinkConflicts,
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
      // Repairs are planned only for a run that can apply them, and a disputed
      // subtask is settled only where there is history to justify removing
      // somebody's assertion. --staged has neither: the commit under test does
      // not exist yet, and its tree came from the index (see below).
      ...(opts.fix
        ? { linkRepairs: opts.staged ? {} : { conflictWinners: resolveLinkConflicts(ws, repo) } }
        : {}),
    }),
    // History-dependent checks are skipped for --staged: the commit being made
    // does not exist yet, so there is nothing for them to read.
    ...(opts.staged ? [] : runHistoryChecks(ws, repo)),
  ]);

  if (!opts.fix) return { diagnostics, applied: [] };
  const repairable = opts.staged ? diagnostics.map(withoutRewrites) : diagnostics;
  return {
    diagnostics: repairable.filter((d) => !d.fix),
    applied: applyFixes(ws, repairable),
  };
}

/**
 * Withdraw a repair that would write file content, as `--staged` requires.
 *
 * Under `--staged` the tree being judged was read out of the index, so content
 * derived from it does not describe what is on disk: writing it back would
 * silently discard whatever the author has not staged yet. Moving a file is
 * safe, since it carries whatever the working tree holds.
 */
function withoutRewrites(diagnostic: Diagnostic): Diagnostic {
  if (!diagnostic.fix?.some((op) => op.op === "write")) return diagnostic;
  const { fix: _withheld, ...rest } = diagnostic;
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
  // Keyed by what the operation acts on, not by its content: two diagnostics
  // that name one path offer the same repair for it, which is what the merge
  // in check D11 guarantees.
  const target = (op: FileOp): string =>
    op.op === "move" ? `move\0${op.from}\0${op.to}` : `${op.op}\0${op.path}`;

  for (const diagnostic of diagnostics) {
    const fresh = (diagnostic.fix ?? []).filter((op) => !done.has(target(op)));
    if (fresh.length === 0) continue;
    applyOps(ws, fresh);
    for (const op of fresh) {
      done.add(target(op));
      applied.push(describeFix(ws.navDir, op));
    }
  }
  return applied;
}

function describeFix(navDir: string, op: FileOp): string {
  switch (op.op) {
    case "move":
      return `moved ${repoPath(navDir, op.from)} to ${repoPath(navDir, op.to)}`;
    case "remove":
      return `removed ${repoPath(navDir, op.path)}`;
    default:
      return `wrote ${repoPath(navDir, op.path)}`;
  }
}

/** Build the repository model from what is staged rather than the working tree. */
function stagedRepo(ws: WsCtx): Repo {
  const prefix = `${ws.navDir}/`;
  const paths = allIndexedNavPaths(ws).filter((path) => path.startsWith(prefix));
  const files = new Map<string, string>();
  for (const path of paths) {
    const content = stagedContent(ws.repoRoot, path);
    if (content !== null) files.set(path.slice(prefix.length), content);
  }
  return parseTree(files);
}

/**
 * Every Navbook path in the index. The pre-commit hook needs the whole
 * indexed tree, not only the changed paths: checks like ID uniqueness and
 * reply-to resolution are properties of the tree the commit will create.
 */
function allIndexedNavPaths(ws: WsCtx): string[] {
  const listed = splitNul(
    git(["ls-files", "--cached", "-z", "--", ws.navDir], { cwd: ws.repoRoot }),
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
