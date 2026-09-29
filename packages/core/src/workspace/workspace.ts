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
  lstatSync,
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
import type { CoreExtensions } from "../core/extensions.ts";
import type { FileOp } from "../core/ops.ts";
import { type PluginDeclarationReading, parsePluginDeclaration } from "../core/plugins.ts";
import {
  type MarkerVersionFault,
  type MergePolicyReading,
  parseMarkerVersion,
  parseMergePolicy,
  parseReviewPolicy,
  type ReviewPolicyReading,
} from "../core/policy.ts";
import { needsComments, type Query } from "../core/query.ts";
import { parseDirName } from "../core/slug.ts";
import {
  type CommentScope,
  commentRecords,
  commentsInScope,
  type EntityKind,
  type EntityRecord,
  isEntityDirPath,
  NAV_MARKER,
  type NavTree,
  parseTree,
  type Repo,
} from "../core/tree.ts";
import { gitMaybe } from "../git/exec.ts";
import { add } from "../git/index-ops.ts";
import type { WsCtx } from "./ctx.ts";
import { wsFail } from "./errors.ts";

export interface ReadTreeOptions {
  /**
   * Whose `comments/` directories to read; the others are never opened.
   *
   * Reading them all is what a text search and `show` need, and what the 1000-
   * issue budget of spec 05 §5.2 cannot afford for a listing that does not.
   * `prs` is the middle case a pull-request listing wants: it derives a review
   * state from the verdicts (spec 02 §2.7), and there are only ever a handful
   * of open pull requests, while the issue comments beside them are the bulk.
   */
  comments?: CommentScope;
}

/**
 * The Navbook directory's paths, with each file read when it is asked for.
 *
 * Walking is eager and reading is not: `parseTree` asks for what it parses, so
 * an extension namespace (§2.12) or a feature's image (§2.11) is listed — which
 * is what `Repo.reserved` and `extraFiles` are made of — and never opened. A
 * read is remembered, since an entity file is asked for twice (to parse it and
 * to hash it).
 *
 * A file that is asked for and cannot be read throws, as the eager read did:
 * answering `undefined` would drop the entity from a tree that the server
 * caches until HEAD moves, and that a mutation would then plan against. What
 * changes is only that a file nobody asks for can no longer fail the command.
 */
export function readNavTree(navRoot: string, opts: ReadTreeOptions = {}): NavTree {
  const paths = new Set<string>();
  if (existsSync(navRoot)) walk(navRoot, "", paths, opts.comments ?? "all");
  const contents = new Map<string, string>();
  return {
    keys: () => paths,
    get(path) {
      if (!paths.has(path)) return undefined;
      let text = contents.get(path);
      if (text === undefined) {
        text = readFileSync(join(navRoot, ...path.split("/")), "utf8");
        contents.set(path, text);
      }
      return text;
    },
  };
}

function walk(absolute: string, rel: string, paths: Set<string>, comments: CommentScope): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(absolute, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    // Only a directory that went away between its parent's listing and its own
    // is skipped. One that cannot be read throws, as an unreadable file does:
    // skipping it would drop its entities from the tree without a problem.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      const skipped =
        entry.name === "comments" && isEntityDirPath(rel) && !commentsInScope(comments, rel);
      if (skipped) continue;
      walk(join(absolute, entry.name), childRel, paths, comments);
    } else if (entry.isFile()) {
      paths.add(childRel);
    }
  }
}

/**
 * The entity with its comments, reading them when its tree left them out.
 *
 * For a reader that loaded the tree without comments, which is most of what a
 * load costs (#esqpmn7i), and then needs one entity's. They are read from the
 * working tree as it is now, so call it where the tree is held still. A comment
 * that does not parse is left out, as a full load leaves it out; reporting it
 * is `doctor`'s job, and `doctor` always reads everything.
 */
export function withComments(ws: WsCtx, entity: EntityRecord): EntityRecord {
  if (entity.commentsLoaded) return entity;
  const dir = `${entity.dirPath}/comments`;
  const files = new Map<string, string>();
  const paths = new Map<string, string>();
  let entries: Dirent<string>[] = [];
  try {
    entries = readdirSync(join(ws.navRoot, dir), { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    // No `comments/` at all, which is an entity nobody has commented on yet.
    // Anything else is a directory that could not be read, which a full load
    // reports (`walk`), and must not be served as "no comments".
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = `${dir}/${entry.name}`;
    files.set(path, readFileSync(join(ws.navRoot, dir, entry.name), "utf8"));
    paths.set(entry.name, path);
  }
  return { ...entity, comments: commentRecords(paths, files, []), commentsLoaded: true };
}

/** Load the repository model from the working tree. */
export function loadRepo(ws: WsCtx, opts: ReadTreeOptions = {}): Repo {
  requireNavbook(ws);
  const comments = opts.comments ?? "all";
  return parseTree(readNavTree(ws.navRoot, { comments }), {
    commentsLoaded: comments,
    ext: ws.ext,
  });
}

/**
 * Whose comments a listing of `kind` matching `query` needs read.
 *
 * A listing only ever examines entities of its own kind, so nothing else's
 * comments can change its answer. A pull-request listing always needs its own,
 * since it reports a derived review state (spec 02 §2.7); an issue listing
 * needs them only to search their text, or when a term a plugin registered
 * says it reads them (spec 02 §2.12).
 *
 * `ext` is required rather than defaulted: a caller that forgot it would read
 * no comments for such a term, and the term would silently match wrongly.
 */
export function commentScopeFor(query: Query, kind: EntityKind, ext: CoreExtensions): CommentScope {
  if (kind === "pr") return "prs";
  return needsComments(query, ext) ? "all" : "none";
}

/** Load the repository for a listing of `kind`, reading the comments it needs. */
export function loadRepoForQuery(ws: WsCtx, query: Query, kind: EntityKind): Repo {
  return loadRepo(ws, { comments: commentScopeFor(query, kind, ws.ext) });
}

/**
 * Read the review policy the marker declares (spec 02 §2.10).
 *
 * For the callers that need the policy without needing the tree: merging,
 * reviewing, and any listing whose records came from a ref rather than from
 * here. A repository with no marker declares nothing, which is not a fault.
 *
 * The policy is always the working tree's, including for records read out of
 * other branches: it is how *this* checkout counts, and a pull request read
 * from a ref would otherwise be counted by whatever its own branch happened to
 * say, which is a second answer to a question that has one.
 *
 * A path that cannot be read as a file — a directory wearing the name, or one
 * the process has no permission for — is treated as no marker at all. For the
 * directory that is exactly what `readNavTree` concludes: it lists files, so
 * the path is simply absent from the tree `parseTree` judges. Agreeing with that
 * matters more than reporting it, since a repository whose `doctor` and whose
 * `pr list` disagreed about whether a policy exists would be worse than one
 * quietly counting by the defaults.
 */
export function readReviewPolicy(ws: WsCtx): ReviewPolicyReading {
  return parseReviewPolicy(readMarker(ws));
}

/**
 * Read the merge policy the marker declares (spec 02 §2.10).
 *
 * Read from the working tree for the same reason {@link readReviewPolicy} is:
 * the method belongs to the repository somebody is merging *in*, not to
 * whichever branch the pull request was written on. A source branch that
 * declared `squash` cannot decide how the target lands it.
 */
export function readMergePolicy(ws: WsCtx): MergePolicyReading {
  return parseMergePolicy(readMarker(ws));
}

/**
 * Read the plugin declaration the marker carries (spec 02 §2.12).
 *
 * The counterpart of {@link readReviewPolicy}, for the caller that needs to
 * know which plugins a tree was written by *before* it has a tree — which is
 * every front end at startup, since what it reads here decides what parses the
 * tree afterwards. An unreadable marker declares nothing, for the reason given
 * above: agreeing with what `parseTree` will conclude matters more than
 * reporting it twice.
 */
export function readPluginDeclaration(ws: WsCtx): PluginDeclarationReading {
  return parsePluginDeclaration(readMarker(ws));
}

/**
 * What this tool cannot take at its word in the marker's `version` (spec 02
 * §2.10), read from the working tree like the policies beside it.
 */
export function readMarkerVersion(ws: WsCtx): MarkerVersionFault | null {
  return parseMarkerVersion(readMarker(ws));
}

/** The marker's text, or undefined when there is none to read. */
function readMarker(ws: WsCtx): string | undefined {
  const path = join(ws.navRoot, NAV_MARKER);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
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
    if (op.op === "write" || op.op === "write-bytes") {
      const target = absPath(ws, op.path);
      refuseLinks(ws, op.path);
      mkdirSync(dirname(target), { recursive: true });
      if (op.op === "write") writeFileSync(target, op.content, "utf8");
      else writeFileSync(target, op.bytes);
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
    refuseLinks(ws, op.to);
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
 * Refuse a write that would pass through a symbolic link below the Navbook
 * root. The tree is whatever was pushed, and the tree walker never follows a
 * link, so none belongs there; one committed where a write lands would carry
 * the bytes out of the repository — into `.git/config`, say, on a server that
 * writes what a client sent. Checked from the root down, stopping at the first
 * part that does not exist yet, below which nothing can be a link.
 */
function refuseLinks(ws: WsCtx, navRelative: string): void {
  let path = ws.navRoot;
  const parts = navRelative.split("/").filter((part) => part !== "");
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    let link: boolean;
    try {
      link = lstatSync(path).isSymbolicLink();
    } catch {
      return;
    }
    if (link) {
      wsFail(
        "precondition",
        `will not write through ${repoPath(ws.navDir, parts.slice(0, index + 1).join("/"))}, which is a symbolic link`,
      );
    }
  }
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
