/**
 * Operation planners.
 *
 * Every mutating Navbook command is a pure function from the current tree to a
 * list of {@link FileOp}s plus a commit plan. Nothing here touches the file
 * system or git, which keeps the whole mutation surface testable in memory and
 * gives the future Rust rewrite a function-for-function target.
 */

import { commentFileName } from "./comments.ts";
import { type Revision, readParent, readRevisions, readSubtasks } from "./files.ts";
import {
  appendListItem,
  FrontmatterError,
  parseDoc,
  patchDoc,
  serializeDoc,
  setFlowList,
} from "./frontmatter.ts";
import { isId } from "./id.ts";
import type { LinkEdit, LinkRepair } from "./links.ts";
import { dirName as makeDirName, slugify } from "./slug.ts";
import { type EntityKind, type EntityRecord, NAV_MARKER, type Status, statusDir } from "./tree.ts";

export type FileOp =
  /** Create or overwrite a file, creating parent directories as needed. */
  | { op: "write"; path: string; content: string }
  /** Rename a file or a whole directory; refuses when the destination exists. */
  | { op: "move"; from: string; to: string }
  /** Delete a file, or a directory and everything under it. */
  | { op: "remove"; path: string };

export interface Trailer {
  key: "Refs" | "Closes" | "Deletes";
  id: string;
}

export interface Plan {
  ops: FileOp[];
  message: string;
  trailers: Trailer[];
}

/**
 * Paths (relative to the Navbook directory) an operation may legitimately touch.
 *
 * A directory stands for everything beneath it: the `--commit` guard treats a
 * staged path as related when it is one of these or lives under one.
 */
export function planPaths(plan: Plan): string[] {
  const paths = new Set<string>();
  for (const op of plan.ops) {
    if (op.op === "move") {
      paths.add(op.from);
      paths.add(op.to);
    } else {
      paths.add(op.path);
    }
  }
  return [...paths];
}

/**
 * Commit subject for a change to one entity, e.g. `docs(issue): close #bqlybac0`.
 *
 * Conventional Commits, scoped by entity kind: history readers filter Navbook's
 * commits with the same `docs` type they already use for documentation, and the
 * scope says at a glance whether an issue or a pull request moved (spec 03 §3.2).
 */
export function docsSubject(kind: EntityKind, action: string, id: string): string {
  return `docs(${kind}): ${action} #${id}`;
}

/* --------------------------------------------------------------------- init */

/**
 * The Navbook skeleton: the marker that makes the directory findable, and
 * `.gitkeep` files so empty status directories commit.
 *
 * Paths are relative to the Navbook directory, so the plan is identical
 * whatever that directory is named — `repoPath` applies the name.
 */
export function planInit(): Plan {
  const dirs = ["issues/open", "issues/closed", "prs/open", "prs/merged", "prs/closed"];
  return {
    ops: [
      {
        op: "write" as const,
        path: NAV_MARKER,
        content: `${JSON.stringify({ version: 1 }, null, 2)}\n`,
      },
      ...dirs.map((dir) => ({ op: "write" as const, path: `${dir}/.gitkeep`, content: "" })),
    ],
    // No entity to scope to: init creates the whole skeleton.
    message: "docs: initialize navbook",
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
      message: docsSubject(kind, "open", id),
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
      message: docsSubject(entity.kind, opts.review ? "review" : "comment on", entity.id),
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
    message: docsSubject(entity.kind, "close", entity.id),
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
    message: docsSubject(entity.kind, "reopen", entity.id),
    trailers: [{ key: "Refs", id: entity.id }],
  };
}

/** Move a merged pull request into `prs/merged/` (spec 03 §3.5). */
export function planArchiveMerged(entity: EntityRecord): Plan {
  return {
    ops: moveWithFrontmatter(entity, "merged", {}),
    message: docsSubject(entity.kind, "archive merged", entity.id),
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
  if (moved) ops.push({ op: "move", from: entity.dirPath, to: targetDir });

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

/* -------------------------------------------------------- decomposition */

/**
 * Apply link-key changes to an issue file, or null when nothing changes.
 *
 * Separate from {@link rewriteFrontmatter} because `subtasks` is a list:
 * comparing the value that was asked for against the one already there decides
 * nothing when both are arrays, and writing an unchanged list would churn every
 * file a repair walked past. The list is also deduplicated on every write —
 * an entry cannot mean anything twice, and dropping the repeat loses nothing.
 *
 * Refuses a file whose link keys are malformed rather than quietly discarding
 * what it could not read: that is a fault for `doctor` to report and a person
 * to resolve.
 */
export function rewriteLinks(entity: EntityRecord, edit: LinkEdit): string | null {
  const unreadable = unreadableLinkKey(entity);
  if (unreadable) throw new FrontmatterError(unreadable);

  const before = readSubtasks(entity.fm);
  const after: string[] = [];
  for (const id of before) {
    if (edit.removeSubtasks?.includes(id) || after.includes(id)) continue;
    after.push(id);
  }
  for (const id of edit.addSubtasks ?? []) if (!after.includes(id)) after.push(id);

  const parentBefore = readParent(entity.fm) ?? undefined;
  const parentAfter = edit.parent === undefined ? parentBefore : (edit.parent ?? undefined);

  const listChanged = after.length !== before.length || after.some((id, i) => id !== before[i]);
  if (!listChanged && parentAfter === parentBefore) return null;

  const nav = parseDoc(serializeDoc(entity.parsed.nav));
  if (parentAfter !== parentBefore) patchDoc(nav, { parent: parentAfter ?? undefined });
  if (listChanged) {
    if (after.length === 0) patchDoc(nav, { subtasks: undefined });
    else setFlowList(nav, "subtasks", after);
  }
  return serializeDoc(nav);
}

/** True when {@link rewriteLinks} could rewrite this file's link keys. */
export function linksReadable(entity: EntityRecord): boolean {
  return unreadableLinkKey(entity) === null;
}

/**
 * Why this file's link keys cannot be rewritten, or null when they can.
 *
 * A rewrite has to give back everything it read, so a key holding something
 * that is not an ID stops it: silently dropping what could not be understood
 * would lose an assertion somebody made. Check D2 reports the same fault.
 */
function unreadableLinkKey(entity: EntityRecord): string | null {
  const parent = entity.fm.parent;
  if (parent !== undefined && parent !== null && (typeof parent !== "string" || !isId(parent))) {
    return "'parent' is not a Navbook ID and cannot be rewritten";
  }
  const subtasks = entity.fm.subtasks;
  if (subtasks === undefined || subtasks === null) return null;
  if (!Array.isArray(subtasks) || subtasks.some((id) => typeof id !== "string" || !isId(id))) {
    return "'subtasks' is not a list of Navbook IDs and cannot be rewritten";
  }
  return null;
}

/**
 * A file whose link keys could not be read well enough to rewrite. Carries the
 * path so the caller can name the file that actually needs attention, which is
 * rarely the one the command was pointed at.
 */
export class LinkRewriteError extends FrontmatterError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "LinkRewriteError";
    this.path = path;
  }
}

/** Write ops for a set of link repairs, skipping the ones that change nothing. */
export function linkRepairOps(repairs: readonly LinkRepair[]): FileOp[] {
  const ops: FileOp[] = [];
  for (const { entity, edit } of repairs) {
    let content: string | null;
    try {
      content = rewriteLinks(entity, edit);
    } catch (error) {
      if (!(error instanceof FrontmatterError)) throw error;
      throw new LinkRewriteError(entity.filePath, error.message);
    }
    if (content !== null) ops.push({ op: "write", path: entity.filePath, content });
  }
  return ops;
}

/**
 * File an issue under a parent, writing both sides of the link (§2.5).
 *
 * `staleListers` are the issues that claimed the child before and no longer
 * should. Passing them here rather than only the previous parent is what makes
 * the postcondition exact: afterwards the child names one parent, and that
 * parent is the only issue listing it.
 */
export function planLink(
  child: EntityRecord,
  parent: EntityRecord,
  staleListers: readonly EntityRecord[] = [],
): Plan {
  const repairs: LinkRepair[] = [
    // The child drops any claim on its new parent, or on itself, along the
    // way: one issue cannot be both above and below another, and the caller
    // has just said which way round this pair goes.
    { entity: child, edit: { parent: parent.id, removeSubtasks: [parent.id, child.id] } },
    { entity: parent, edit: { addSubtasks: [child.id] } },
    ...staleListers
      .filter((entity) => entity.id !== parent.id && entity.id !== child.id)
      .map((entity) => ({ entity, edit: { removeSubtasks: [child.id] } })),
  ];
  return {
    ops: linkRepairOps(repairs),
    message: docsSubject("issue", "link", child.id),
    trailers: refsTo([child, parent, ...staleListers]),
  };
}

/**
 * Detach an issue from its parent, clearing every claim on it.
 *
 * "Unlinked" has to mean that nothing claims the issue any more, or the command
 * would leave exactly the half-link that check D11 exists to report — so a
 * `subtasks` entry no one meant, including the issue's own, goes with it.
 */
export function planUnlink(child: EntityRecord, listers: readonly EntityRecord[] = []): Plan {
  const repairs: LinkRepair[] = [
    { entity: child, edit: { parent: null, removeSubtasks: [child.id] } },
    ...listers
      .filter((entity) => entity.id !== child.id)
      .map((entity) => ({ entity, edit: { removeSubtasks: [child.id] } })),
  ];
  return {
    ops: linkRepairOps(repairs),
    message: docsSubject("issue", "unlink", child.id),
    trailers: refsTo([child, ...listers]),
  };
}

/** One `Refs:` trailer per entity the operation touched, in order, deduplicated. */
function refsTo(entities: readonly EntityRecord[]): Trailer[] {
  const seen = new Set<string>();
  const trailers: Trailer[] = [];
  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    trailers.push({ key: "Refs", id: entity.id });
  }
  return trailers;
}

/* ----------------------------------------------------------------- deletion */

/**
 * Remove an entity's directory outright — spec 04 §4.3.
 *
 * Closing records an outcome; deleting says the entity should never have
 * existed, which is why it takes the whole directory (comments and any extra
 * files with it) from wherever it sits, including `archive/`.
 *
 * The commit carries no trailer on purpose. Every other verb refers to the
 * entity it touched, but here the entity is gone by definition, so a `Refs:`
 * would be a dangling reference the moment it was written — exactly what
 * doctor check D8 exists to report. The subject still names the ID, which
 * keeps the deletion greppable without warning about itself.
 *
 * Links to the entity are severed in the same plan, and so in the same commit:
 * a tree that never holds a broken link is worth more than a delete that only
 * touches one directory.
 *
 * A recursive delete takes entities the subject does not name, so it records
 * them as `Deletes:` trailers. That is not a reference — it names what the
 * commit took away — and it is what lets doctor tell a subtask deliberately
 * removed with its parent from one that went missing.
 */
export function planDelete(entity: EntityRecord, links: DeleteLinks = {}): Plan {
  const alsoRemove = links.alsoRemove ?? [];
  return {
    ops: [
      ...linkRepairOps(links.repairs ?? []),
      ...[entity, ...alsoRemove].map((target) => ({
        op: "remove" as const,
        path: target.dirPath,
      })),
    ],
    message: docsSubject(entity.kind, "delete", entity.id),
    trailers: alsoRemove.map((target) => ({ key: "Deletes" as const, id: target.id })),
  };
}

export interface DeleteLinks {
  /** Further directories removed with it, as `--recursive` removes a subtree. */
  alsoRemove?: readonly EntityRecord[];
  /** Link keys mended on the issues that survive the deletion. */
  repairs?: readonly LinkRepair[];
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
    message: docsSubject(entity.kind, "update", entity.id),
    trailers: [{ key: "Refs", id: entity.id }],
  };
}

export interface MergedBlock {
  date: string;
  by: string;
  /** Absent after a fast-forward, which creates no merge commit to name. */
  commit?: string;
}

/** Record the `merged:` block after the merge commit exists (§2.7). */
export function planMergedBlock(entity: EntityRecord, merged: MergedBlock): Plan {
  const nav = parseDoc(serializeDoc(entity.parsed.nav));
  patchDoc(nav, { merged });
  return {
    ops: [{ op: "write", path: entity.filePath, content: serializeDoc(nav) }],
    message: docsSubject(entity.kind, "merge", entity.id),
    trailers: [{ key: "Refs", id: entity.id }],
  };
}
