/**
 * The in-memory model of a `.navbook/` tree — spec 02 §2.1.
 *
 * Input is a flat map of paths (relative to `.navbook/`) to file contents, so
 * the model works equally well over a working tree, a git index, or the blobs
 * of a branch that is not checked out.
 */

import { parseCommentFileName } from "./comments.ts";
import { type ParsedFile, parseFile } from "./files.ts";
import { parseDirName } from "./slug.ts";

export type NavTree = ReadonlyMap<string, string>;

export type EntityKind = "issue" | "pr";
export type Status = "open" | "closed" | "merged";

export const ISSUE_STATUSES: readonly Status[] = ["open", "closed"];
export const PR_STATUSES: readonly Status[] = ["open", "merged", "closed"];

export interface CommentRecord {
  id: string;
  fileName: string;
  /** Path relative to `.navbook/`. */
  path: string;
  stamp: string;
  date: Date;
  author: string;
  replyTo?: string;
  body: string;
  parsed: ParsedFile;
}

export interface EntityRecord {
  kind: EntityKind;
  id: string;
  slug: string;
  dirName: string;
  status: Status;
  /** True when the entity lives under `.navbook/archive/` (spec 03 §3.6). */
  archived: boolean;
  archiveYear?: string;
  /** Directory path relative to `.navbook/`. */
  dirPath: string;
  /** Path of `issue.md` or `pr.md`, relative to `.navbook/`. */
  filePath: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  body: string;
  title: string;
  comments: CommentRecord[];
  /** Extra files inside the entity directory, preserved untouched (§2.1). */
  extraFiles: string[];
}

export interface StructuralProblem {
  path: string;
  message: string;
}

export interface Repo {
  issues: EntityRecord[];
  prs: EntityRecord[];
  /** Every entity by ID; when IDs collide the first one encountered wins. */
  byId: Map<string, EntityRecord>;
  /** Grammar and layout faults found while walking the tree (doctor check D1). */
  problems: StructuralProblem[];
  /** False when the caller deliberately skipped reading comment files. */
  commentsLoaded: boolean;
  /** Paths that were tolerated but not interpreted (reserved names, §2.10). */
  reserved: string[];
}

interface EntityDraft {
  kind: EntityKind;
  status: Status;
  archived: boolean;
  archiveYear?: string;
  dirPath: string;
  dirName: string;
  entityFile?: string;
  comments: Map<string, string>;
  extraFiles: string[];
}

/** Build a {@link Repo} from a flat path→content map. */
export function parseTree(files: NavTree, opts: { commentsLoaded?: boolean } = {}): Repo {
  const problems: StructuralProblem[] = [];
  const reserved: string[] = [];
  const drafts = new Map<string, EntityDraft>();

  for (const path of [...files.keys()].sort()) {
    classify(path, drafts, problems, reserved);
  }

  const issues: EntityRecord[] = [];
  const prs: EntityRecord[] = [];
  const byId = new Map<string, EntityRecord>();

  for (const draft of [...drafts.values()].sort((a, b) => (a.dirPath < b.dirPath ? -1 : 1))) {
    const record = materialize(draft, files, problems);
    if (!record) continue;
    (record.kind === "issue" ? issues : prs).push(record);
    if (!byId.has(record.id)) byId.set(record.id, record);
  }

  return {
    issues,
    prs,
    byId,
    problems,
    commentsLoaded: opts.commentsLoaded !== false,
    reserved,
  };
}

function classify(
  path: string,
  drafts: Map<string, EntityDraft>,
  problems: StructuralProblem[],
  reserved: string[],
): void {
  const segments = path.split("/");
  const base = segments[segments.length - 1] as string;
  if (base === ".gitkeep") return;

  let rest = segments;
  let archived = false;
  let archiveYear: string | undefined;

  if (segments[0] === "archive") {
    if (segments.length < 2) return;
    archived = true;
    archiveYear = segments[1];
    rest = segments.slice(2);
    if (rest.length === 0) return;
  }

  const root = rest[0];
  if (root === undefined) return;
  if (root !== "issues" && root !== "prs") {
    // Reserved and unknown names are tolerated and preserved untouched (§2.10).
    reserved.push(path);
    return;
  }

  const kind: EntityKind = root === "issues" ? "issue" : "pr";
  const allowed = kind === "issue" ? ISSUE_STATUSES : PR_STATUSES;
  const status = rest[1];

  if (status === undefined) return;
  if (!allowed.includes(status as Status)) {
    problems.push({
      path,
      message: `'${root}/' must contain only ${allowed.map((s) => `${s}/`).join(", ")} (§2.1)`,
    });
    return;
  }

  const dirName = rest[2];
  if (dirName === undefined) return;
  if (rest.length === 3) {
    problems.push({
      path,
      message: `'${root}/${status}/' must contain entity directories, not files (§2.1)`,
    });
    return;
  }
  if (!parseDirName(dirName)) {
    problems.push({
      path,
      message: `entity directory name '${dirName}' does not match <id>-<slug> (§2.3)`,
    });
    return;
  }

  const dirPath = segments.slice(0, segments.length - (rest.length - 3)).join("/");
  const key = dirPath;
  let draft = drafts.get(key);
  if (!draft) {
    draft = {
      kind,
      status: status as Status,
      archived,
      archiveYear,
      dirPath,
      dirName,
      comments: new Map(),
      extraFiles: [],
    };
    drafts.set(key, draft);
  }

  const inner = rest.slice(3);
  const expectedFile = kind === "issue" ? "issue.md" : "pr.md";
  if (inner.length === 1 && inner[0] === expectedFile) {
    draft.entityFile = path;
    return;
  }
  if (inner.length === 2 && inner[0] === "comments") {
    const name = inner[1] as string;
    if (!parseCommentFileName(name)) {
      problems.push({
        path,
        message: `comment filename '${name}' does not match <timestamp>-<id>.md (§2.6)`,
      });
      return;
    }
    draft.comments.set(name, path);
    return;
  }
  draft.extraFiles.push(path);
}

function materialize(
  draft: EntityDraft,
  files: NavTree,
  problems: StructuralProblem[],
): EntityRecord | null {
  const expectedFile = draft.kind === "issue" ? "issue.md" : "pr.md";
  if (!draft.entityFile) {
    problems.push({
      path: draft.dirPath,
      message: `entity directory is missing its ${expectedFile} (§2.1)`,
    });
    return null;
  }
  const parsedName = parseDirName(draft.dirName);
  if (!parsedName) return null;

  const text = files.get(draft.entityFile) ?? "";
  let parsed: ParsedFile;
  try {
    parsed = parseFile(text);
  } catch (error) {
    problems.push({
      path: draft.entityFile,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const comments: CommentRecord[] = [];
  for (const name of [...draft.comments.keys()].sort()) {
    const path = draft.comments.get(name) as string;
    const meta = parseCommentFileName(name);
    if (!meta) continue;
    let commentParsed: ParsedFile;
    try {
      commentParsed = parseFile(files.get(path) ?? "");
    } catch (error) {
      problems.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const replyTo = commentParsed.fm["reply-to"];
    const commentAuthor = commentParsed.fm.author;
    comments.push({
      id: meta.id,
      fileName: name,
      path,
      stamp: meta.stamp,
      date: meta.date,
      author: typeof commentAuthor === "string" ? commentAuthor : "",
      replyTo: typeof replyTo === "string" ? replyTo : undefined,
      body: commentParsed.body,
      parsed: commentParsed,
    });
  }

  return {
    kind: draft.kind,
    id: parsedName.id,
    slug: parsedName.slug,
    dirName: draft.dirName,
    status: draft.status,
    archived: draft.archived,
    archiveYear: draft.archiveYear,
    dirPath: draft.dirPath,
    filePath: draft.entityFile,
    parsed,
    fm: parsed.fm,
    body: parsed.body,
    title: typeof parsed.fm.title === "string" ? parsed.fm.title : "",
    comments,
    extraFiles: draft.extraFiles.sort(),
  };
}

/** Every entity in the repository, issues first. */
export function allEntities(repo: Repo): EntityRecord[] {
  return [...repo.issues, ...repo.prs];
}

/** Every ID in the repository: entities and comments alike (doctor check D3). */
export function allIds(repo: Repo): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  for (const entity of allEntities(repo)) {
    out.push({ id: entity.id, path: entity.dirPath });
    for (const comment of entity.comments) out.push({ id: comment.id, path: comment.path });
  }
  return out;
}

/** Directory path for an entity of the given kind, status and directory name. */
export function statusDir(kind: EntityKind, status: Status): string {
  return `${kind === "issue" ? "issues" : "prs"}/${status}`;
}

/** Locate an entity by exact ID across both kinds. */
export function findById(repo: Repo, id: string): EntityRecord | undefined {
  return repo.byId.get(id);
}
