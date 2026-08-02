/**
 * Reading and mutating the `.navbook/` working tree.
 *
 * Core plans; this module executes. Every write goes through {@link applyOps}
 * so the set of touched paths is known exactly — which is what makes the
 * `--commit` guard of spec 04 §4.2 precise rather than approximate.
 */

import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { NAVBOOK_ROOT } from "../core/json.ts";
import type { FileOp } from "../core/ops.ts";
import { needsComments, type Query } from "../core/query.ts";
import { type NavTree, parseTree, type Repo } from "../core/tree.ts";
import { gitMaybe } from "../git/exec.ts";
import { add } from "../git/index-ops.ts";
import type { Ctx } from "./context.ts";
import { fail } from "./errors.ts";

export interface ReadTreeOptions {
  /** Skip `comments/` directories when the command cannot need them. */
  includeComments?: boolean;
}

/** Read `.navbook/` into a flat path→content map. */
export function readNavTree(navRoot: string, opts: ReadTreeOptions = {}): NavTree {
  const includeComments = opts.includeComments !== false;
  const files = new Map<string, string>();
  if (!existsSync(navRoot)) return files;
  walk(navRoot, "", files, includeComments);
  return files;
}

function walk(
  absolute: string,
  rel: string,
  files: Map<string, string>,
  includeComments: boolean,
): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(absolute, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const childAbs = join(absolute, entry.name);
    if (entry.isDirectory()) {
      if (!includeComments && entry.name === "comments") continue;
      walk(childAbs, childRel, files, includeComments);
    } else if (entry.isFile()) {
      files.set(childRel, readFileSync(childAbs, "utf8"));
    }
  }
}

/** Load the repository model from the working tree. */
export function loadRepo(ctx: Ctx, opts: ReadTreeOptions = {}): Repo {
  requireNavbook(ctx);
  const includeComments = opts.includeComments !== false;
  const files = readNavTree(ctx.navRoot, { includeComments });
  return parseTree(files, { commentsLoaded: includeComments });
}

/** Load the repository, reading comment bodies only when the query needs them. */
export function loadRepoForQuery(ctx: Ctx, query: Query): Repo {
  return loadRepo(ctx, { includeComments: needsComments(query) });
}

/** Fail with a helpful message when the repository has no `.navbook/` yet. */
export function requireNavbook(ctx: Ctx): void {
  if (!ctx.hasNavbook) {
    fail(`not a Navbook repository: no ${NAVBOOK_ROOT}/ at the repository root`, [
      "run 'nav init' to create it",
    ]);
  }
}

/** Convert a path relative to `.navbook/` into a repository-relative path. */
export function repoPath(navRelative: string): string {
  return posix.join(NAVBOOK_ROOT, navRelative);
}

/** Absolute filesystem path for a path relative to `.navbook/`. */
export function absPath(ctx: Ctx, navRelative: string): string {
  return join(ctx.navRoot, ...navRelative.split("/"));
}

export interface ApplyResult {
  /** Repository-relative paths the operation created, rewrote or moved. */
  touched: string[];
}

/**
 * Execute file operations in order, then stage exactly the paths involved.
 *
 * Renames are performed as a filesystem move followed by `git add`, which
 * produces the same index state as `git mv` while also working on entities that
 * have not been committed yet.
 */
export function applyOps(ctx: Ctx, ops: readonly FileOp[]): ApplyResult {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.op === "write") {
      const target = absPath(ctx, op.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.content, "utf8");
      touched.add(repoPath(op.path));
      continue;
    }
    const from = absPath(ctx, op.from);
    const to = absPath(ctx, op.to);
    if (!existsSync(from)) fail(`cannot move ${repoPath(op.from)}: it does not exist`);
    if (existsSync(to)) fail(`cannot move ${repoPath(op.from)}: ${repoPath(op.to)} already exists`);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    pruneEmptyParents(ctx, dirname(from));
    touched.add(repoPath(op.from));
    touched.add(repoPath(op.to));
  }
  stage(ctx, [...touched]);
  return { touched: [...touched].sort() };
}

/**
 * Remove directories left empty by a move, up to (but never including) the
 * `.navbook/` root. Git does not track empty directories, so leaving them
 * behind would make the working tree disagree with a fresh clone.
 */
function pruneEmptyParents(ctx: Ctx, startDir: string): void {
  let current = startDir;
  while (current.startsWith(ctx.navRoot) && current !== ctx.navRoot) {
    try {
      if (readdirSync(current).length > 0) return;
      rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/** Stage paths, tolerating those that no longer exist and were never tracked. */
export function stage(ctx: Ctx, paths: readonly string[]): void {
  const stageable = paths.filter((path) => {
    if (existsSync(join(ctx.repoRoot, ...path.split("/")))) return true;
    const tracked = gitMaybe(["ls-files", "--", path], { cwd: ctx.repoRoot });
    return tracked !== null && tracked !== "";
  });
  add(ctx.repoRoot, stageable);
}

/** Repository-relative path of an absolute path, in POSIX form. */
export function toRepoRelative(ctx: Ctx, absolute: string): string {
  return relative(ctx.repoRoot, absolute).split(sep).join("/");
}
