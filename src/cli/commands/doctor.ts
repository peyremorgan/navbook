/**
 * `nav doctor` — spec 04 §4.3.
 *
 * Doctor enforces the specification, not a house style: hand edits that are
 * unusual but valid must pass. Errors (exit 2) are format violations; warnings
 * (exit 0) are things worth a look that may be perfectly deliberate.
 */

import { NAVBOOK_ROOT } from "../../core/json.ts";
import type { FileOp } from "../../core/ops.ts";
import { parseTree, type Repo } from "../../core/tree.ts";
import { type Diagnostic, hasErrors, sortDiagnostics, validateRepo } from "../../core/validate.ts";
import { git, gitMaybe, splitNul } from "../../git/exec.ts";
import { stagedContent, stagedPaths } from "../../git/index-ops.ts";
import type { Ctx } from "../context.ts";
import { NavError } from "../errors.ts";
import { runHistoryChecks } from "../history-checks.ts";
import { applyOps, loadRepo, repoPath, requireNavbook } from "../workspace.ts";

export interface DoctorOptions {
  staged?: boolean;
  fix?: boolean;
  json?: boolean;
}

export function cmdDoctor(ctx: Ctx, opts: DoctorOptions): void {
  requireNavbook(ctx);
  const repo = opts.staged ? stagedRepo(ctx) : loadRepo(ctx);
  const diagnostics = sortDiagnostics([
    ...validateRepo(repo, { commitMessages: recentCommitMessages(ctx, opts) }),
    // History-dependent checks are skipped for --staged: the commit being made
    // does not exist yet, so there is nothing for them to read.
    ...(opts.staged ? [] : runHistoryChecks(ctx, repo)),
  ]);

  const applied = opts.fix ? applyFixes(ctx, diagnostics) : [];
  const remaining = opts.fix ? diagnostics.filter((d) => !d.fix) : diagnostics;

  if (opts.json) {
    for (const diagnostic of remaining) {
      ctx.stdout.write(`${JSON.stringify(toJson(diagnostic))}\n`);
    }
  } else {
    report(ctx, remaining, applied);
  }

  if (hasErrors(remaining)) {
    throw new NavError(`${countErrors(remaining)} format violation(s) found`, { exitCode: 2 });
  }
}

function toJson(diagnostic: Diagnostic): Record<string, unknown> {
  return {
    check: diagnostic.check,
    level: diagnostic.level,
    path: diagnostic.path === "" ? "" : `${NAVBOOK_ROOT}/${diagnostic.path}`,
    message: diagnostic.message,
  };
}

function report(ctx: Ctx, diagnostics: readonly Diagnostic[], applied: readonly string[]): void {
  const c = ctx.colors;
  for (const line of applied) ctx.stdout.write(`${c.green("fixed")}  ${line}\n`);

  for (const diagnostic of diagnostics) {
    const level = diagnostic.level === "error" ? c.red("error") : c.yellow("warning");
    const where = diagnostic.path === "" ? "" : `${NAVBOOK_ROOT}/${diagnostic.path}: `;
    ctx.stdout.write(`${level}  ${c.dim(diagnostic.check)}  ${where}${diagnostic.message}\n`);
  }

  const errors = countErrors(diagnostics);
  const warnings = diagnostics.length - errors;
  if (errors === 0 && warnings === 0) {
    ctx.stdout.write(applied.length > 0 ? "No problems remain.\n" : "No problems found.\n");
    return;
  }
  ctx.stdout.write(`${plural(errors, "error")}, ${plural(warnings, "warning")}\n`);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function countErrors(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((d) => d.level === "error").length;
}

/** Apply every mechanical repair a diagnostic offers, reporting each one. */
function applyFixes(ctx: Ctx, diagnostics: readonly Diagnostic[]): string[] {
  const applied: string[] = [];
  for (const diagnostic of diagnostics) {
    if (!diagnostic.fix || diagnostic.fix.length === 0) continue;
    applyOps(ctx, diagnostic.fix);
    for (const op of diagnostic.fix) applied.push(describeFix(op));
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
function stagedRepo(ctx: Ctx): Repo {
  const prefix = `${NAVBOOK_ROOT}/`;
  const paths = allIndexedNavPaths(ctx).filter((path) => path.startsWith(prefix));
  const files = new Map<string, string>();
  for (const path of paths) {
    const content = stagedContent(ctx.repoRoot, path);
    if (content !== null) files.set(path.slice(prefix.length), content);
  }
  return parseTree(files);
}

/**
 * Every `.navbook/` path in the index. The pre-commit hook needs the whole
 * indexed tree, not only the changed paths: checks like ID uniqueness and
 * reply-to resolution are properties of the tree the commit will create.
 */
function allIndexedNavPaths(ctx: Ctx): string[] {
  const listed = splitNul(
    git(["ls-files", "--cached", "-z", "--", NAVBOOK_ROOT], { cwd: ctx.repoRoot }),
  );
  return listed.length > 0 ? listed : stagedPaths(ctx.repoRoot);
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

function recentCommitMessages(ctx: Ctx, opts: DoctorOptions): string[] {
  if (opts.staged) return [];
  const output = gitMaybe(["log", "--format=%B%x00", "-n", String(TRAILER_SCAN_DEPTH)], {
    cwd: ctx.repoRoot,
  });
  if (output === null) return [];
  return output.split("\0").filter((message) => message.trim() !== "");
}
