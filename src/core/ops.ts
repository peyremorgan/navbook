/**
 * Operation planners.
 *
 * Every mutating Navbook command is a pure function from the current tree to a
 * list of {@link FileOp}s plus a commit plan. Nothing here touches the file
 * system or git, which keeps the whole mutation surface testable in memory and
 * gives the future Rust rewrite a function-for-function target.
 */

import { commentFileName } from "./comments.ts";
import { type Revision, readRevisions } from "./files.ts";
import { appendListItem, parseDoc, patchDoc, serializeDoc } from "./frontmatter.ts";
import { dirName as makeDirName, slugify } from "./slug.ts";
import { type EntityKind, type EntityRecord, type Status, statusDir } from "./tree.ts";

export type FileOp =
  | { op: "write"; path: string; content: string }
  | { op: "move-dir"; from: string; to: string };

export interface Trailer {
  key: "Refs" | "Closes";
  id: string;
}

export interface Plan {
  ops: FileOp[];
  message: string;
  trailers: Trailer[];
}

/** Paths (relative to `.navbook/`) an operation may legitimately touch. */
export function planPaths(plan: Plan): string[] {
  const paths = new Set<string>();
  for (const op of plan.ops) {
    if (op.op === "write") paths.add(op.path);
    else {
      paths.add(op.from);
      paths.add(op.to);
    }
  }
  return [...paths];
}

/* --------------------------------------------------------------------- init */

/** The `.navbook/` skeleton, with `.gitkeep` files so empty status dirs commit. */
export function planInit(): Plan {
  const dirs = ["issues/open", "issues/closed", "prs/open", "prs/merged", "prs/closed"];
  return {
    ops: dirs.map((dir) => ({ op: "write" as const, path: `${dir}/.gitkeep`, content: "" })),
    message: "nb: initialize navbook",
    trailers: [],
  };
}

/* ------------------------------------------------------------------- issues */

export interface OpenResult {
  plan: Plan;
  id: string;
  slug: string;
  dirPath: string;
  filePath: string;
}

/**
 * Create an entity directory holding the given file text.
 *
 * The caller renders the file (with {@link newIssueFile}/{@link newPrFile}, or
 * straight from an editor buffer) and passes the title that names the slug, so
 * a title edited in the buffer still decides the directory name.
 */
export function planEntityOpen(
  kind: EntityKind,
  id: string,
  title: string,
  content: string,
): OpenResult {
  const slug = slugify(title);
  const dirPath = `${statusDir(kind, "open")}/${makeDirName(id, slug)}`;
  const filePath = `${dirPath}/${kind === "issue" ? "issue.md" : "pr.md"}`;
  return {
    plan: {
      ops: [{ op: "write", path: filePath, content }],
      message: `nb: open #${id}`,
      trailers: [],
    },
    id,
    slug,
    dirPath,
    filePath,
  };
}

/* ----------------------------------------------------------------- comments */

export interface CommentResult {
  plan: Plan;
  id: string;
  path: string;
}

/** Add a comment (or review) file to an entity's `comments/` directory. */
export function planComment(
  entity: EntityRecord,
  id: string,
  date: Date,
  content: string,
  opts: { review?: boolean } = {},
): CommentResult {
  const path = `${entity.dirPath}/comments/${commentFileName(date, id)}`;
  return {
    plan: {
      ops: [{ op: "write", path, content }],
      message: `nb: ${opts.review ? "review" : "comment on"} #${entity.id}`,
      trailers: [{ key: "Refs", id: entity.id }],
    },
    id,
    path,
  };
}

/* --------------------------------------------------------- status movements */

export interface CloseInput {
  resolution?: string;
  duplicateOf?: string;
}

/** Move an entity to `closed/`, optionally recording a resolution. */
export function planClose(entity: EntityRecord, input: CloseInput = {}): Plan {
  const resolution = input.resolution ?? (input.duplicateOf ? "duplicate" : undefined);
  const changes: Record<string, unknown> = {};
  if (resolution) changes.resolution = resolution;
  if (input.duplicateOf) changes["duplicate-of"] = input.duplicateOf;
  return {
    ops: moveWithFrontmatter(entity, "closed", changes),
    message: `nb: close #${entity.id}`,
    trailers: [{ key: "Closes", id: entity.id }],
  };
}

/** Move an entity back to `open/`, clearing the resolution it was closed with. */
export function planReopen(entity: EntityRecord): Plan {
  const changes: Record<string, unknown> = { resolution: undefined };
  if (entity.fm.resolution === "duplicate") changes["duplicate-of"] = undefined;
  if (entity.fm.resolution === "superseded") changes["superseded-by"] = undefined;
  return {
    ops: moveWithFrontmatter(entity, "open", changes),
    message: `nb: reopen #${entity.id}`,
    trailers: [{ key: "Refs", id: entity.id }],
  };
}

/** Move a merged pull request into `prs/merged/` (spec 03 §3.5). */
export function planArchiveMerged(entity: EntityRecord): Plan {
  return {
    ops: moveWithFrontmatter(entity, "merged", {}),
    message: `nb: archive merged #${entity.id}`,
    trailers: [{ key: "Refs", id: entity.id }],
  };
}

/**
 * Move an entity between status directories, applying frontmatter changes to
 * the file at its *new* location so the ops apply in order.
 */
function moveWithFrontmatter(
  entity: EntityRecord,
  status: Status,
  changes: Record<string, unknown>,
): FileOp[] {
  const ops: FileOp[] = [];
  const targetDir = `${statusDir(entity.kind, status)}/${entity.dirName}`;
  const moved = targetDir !== entity.dirPath;
  if (moved) ops.push({ op: "move-dir", from: entity.dirPath, to: targetDir });

  const fileName = entity.kind === "issue" ? "issue.md" : "pr.md";
  const rewritten = rewriteFrontmatter(entity, changes);
  if (rewritten !== null) {
    ops.push({ op: "write", path: `${targetDir}/${fileName}`, content: rewritten });
  }
  return ops;
}

/** Apply frontmatter changes to an entity file, or null when nothing changes. */
export function rewriteFrontmatter(
  entity: EntityRecord,
  changes: Record<string, unknown>,
): string | null {
  const meaningful = Object.entries(changes).filter(([key, value]) =>
    value === undefined ? entity.fm[key] !== undefined : entity.fm[key] !== value,
  );
  if (meaningful.length === 0) return null;
  const nav = parseDoc(serializeDoc(entity.parsed.nav));
  patchDoc(nav, Object.fromEntries(meaningful));
  return serializeDoc(nav);
}

/* ------------------------------------------------------------ pull requests */

export class RevisionUnchangedError extends Error {}

/** Append a revision entry; entries are append-only (§2.7). */
export function planPrUpdate(entity: EntityRecord, revision: Revision): Plan {
  const existing = readRevisions(entity.fm);
  const last = existing[existing.length - 1];
  if (last && last.head === revision.head) {
    throw new RevisionUnchangedError(
      `HEAD ${revision.head.slice(0, 8)} is already the latest recorded revision of #${entity.id}`,
    );
  }
  const nav = parseDoc(serializeDoc(entity.parsed.nav));
  appendListItem(nav, "revisions", revision);
  return {
    ops: [{ op: "write", path: entity.filePath, content: serializeDoc(nav) }],
    message: `nb: update #${entity.id}`,
    trailers: [{ key: "Refs", id: entity.id }],
  };
}

export interface MergedBlock {
  date: string;
  by: string;
  commit: string;
}

/** Record the `merged:` block after the merge commit exists (§2.7). */
export function planMergedBlock(entity: EntityRecord, merged: MergedBlock): Plan {
  const nav = parseDoc(serializeDoc(entity.parsed.nav));
  patchDoc(nav, { merged });
  return {
    ops: [{ op: "write", path: entity.filePath, content: serializeDoc(nav) }],
    message: `nb: merge #${entity.id}`,
    trailers: [{ key: "Refs", id: entity.id }],
  };
}
