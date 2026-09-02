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
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { parseCommentFileName } from "../core/comments.ts";
import type { FileOp } from "../core/ops.ts";
import { needsComments, type Query } from "../core/query.ts";
import { parseDirName } from "../core/slug.ts";
import { type NavTree, parseTree, type Repo } from "../core/tree.ts";
import { gitMaybe } from "../git/exec.ts";
import { add } from "../git/index-ops.ts";
import type { WsCtx } from "./ctx.ts";
import { wsFail } from "./errors.ts";

export interface ReadTreeOptions {
  /** Skip `comments/` directories when the command cannot need them. */
  includeComments?: boolean;
}

/** Read the Navbook directory into a flat path→content map. */
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
export function loadRepo(ws: WsCtx, opts: ReadTreeOptions = {}): Repo {
  requireNavbook(ws);
  const includeComments = opts.includeComments !== false;
  const files = readNavTree(ws.navRoot, { includeComments });
  return parseTree(files, { commentsLoaded: includeComments });
}

/** Load the repository, reading comment bodies only when the query needs them. */
export function loadRepoForQuery(ws: WsCtx, query: Query): Repo {
  return loadRepo(ws, { includeComments: needsComments(query) });
}

/** Fail with a helpful message when the repository has no Navbook directory yet. */
export function requireNavbook(ws: WsCtx): void {
  if (!ws.hasNavbook) {
    wsFail(
      "not-a-navbook-repo",
      `not a Navbook repository: no ${ws.navDir}/ at the repository root`,
      ["run 'nav init' to create it"],
    );
  }
}

/** Convert a path relative to the Navbook directory into a repository-relative one. */
export function repoPath(navDir: string, navRelative: string): string {
  return posix.join(navDir, navRelative);
}

/** Absolute filesystem path for a path relative to the Navbook directory. */
export function absPath(ws: WsCtx, navRelative: string): string {
  return join(ws.navRoot, ...navRelative.split("/"));
}

/** Repository-relative forms of several Navbook-relative paths. */
export function repoPaths(navDir: string, navRelatives: readonly string[]): string[] {
  return navRelatives.map((navRelative) => repoPath(navDir, navRelative));
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
export function applyOps(ws: WsCtx, ops: readonly FileOp[]): ApplyResult {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.op === "write") {
      const target = absPath(ws, op.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, op.content, "utf8");
      touched.add(repoPath(ws.navDir, op.path));
      continue;
    }
    if (op.op === "remove") {
      const target = absPath(ws, op.path);
      if (!existsSync(target)) {
        wsFail("missing-path", `cannot remove ${repoPath(ws.navDir, op.path)}: it does not exist`);
      }
      rmSync(target, { recursive: true });
      pruneEmptyParents(ws, dirname(target));
      touched.add(repoPath(ws.navDir, op.path));
      continue;
    }
    const from = absPath(ws, op.from);
    const to = absPath(ws, op.to);
    if (!existsSync(from)) {
      wsFail("missing-path", `cannot move ${repoPath(ws.navDir, op.from)}: it does not exist`);
    }
    if (existsSync(to)) {
      wsFail(
        "destination-exists",
        `cannot move ${repoPath(ws.navDir, op.from)}: ${repoPath(ws.navDir, op.to)} already exists`,
      );
    }
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    pruneEmptyParents(ws, dirname(from));
    touched.add(repoPath(ws.navDir, op.from));
    touched.add(repoPath(ws.navDir, op.to));
  }
  stage(ws, [...touched]);
  return { touched: [...touched].sort() };
}

/**
 * Remove directories left empty by a move or a removal, up to (but never
 * including) the Navbook root. Git does not track empty directories, so
 * leaving them behind would make the working tree disagree with a fresh clone.
 * The status directories survive because each holds a `.gitkeep`.
 */
function pruneEmptyParents(ws: WsCtx, startDir: string): void {
  let current = startDir;
  while (current.startsWith(ws.navRoot) && current !== ws.navRoot) {
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
export function stage(ws: WsCtx, paths: readonly string[]): void {
  const stageable = paths.filter((path) => {
    if (existsSync(join(ws.repoRoot, ...path.split("/")))) return true;
    const tracked = gitMaybe(["ls-files", "--", path], { cwd: ws.repoRoot });
    return tracked !== null && tracked !== "";
  });
  add(ws.repoRoot, stageable);
}

/**
 * Every ID in the repository, read from names alone.
 *
 * Entity IDs are in directory names and comment IDs are in filenames (§2.2,
 * §2.6), so uniqueness can be checked without opening a single file — which
 * keeps `open` fast while still honouring "unique across all entity and
 * comment IDs".
 */
export function scanAllIds(navRoot: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(navRoot)) return ids;

  const walk = (dir: string, depth: number): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const parsed = parseDirName(entry.name);
        if (parsed) ids.add(parsed.id);
        if (depth < 6) walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const comment = parseCommentFileName(entry.name);
        if (comment) ids.add(comment.id);
      }
    }
  };
  walk(navRoot, 0);
  return ids;
}

/** Repository-relative path of an absolute path, in POSIX form. */
export function toRepoRelative(ws: WsCtx, absolute: string): string {
  return relative(ws.repoRoot, absolute).split(sep).join("/");
}
