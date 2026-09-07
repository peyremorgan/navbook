/**
 * The in-memory model of a `.navbook/` tree — spec 02 §2.1 and §2.11.
 *
 * Input is a flat map of paths (relative to `.navbook/`) to file contents, so
 * the model works equally well over a working tree, a git index, or the blobs
 * of a branch that is not checked out.
 */

import { parseCommentFileName } from "./comments.ts";
import { FEATURE_FILE, type ParsedFile, parseFile } from "./files.ts";
import { parseDirName, SLUG_PATTERN } from "./slug.ts";

export type NavTree = ReadonlyMap<string, string>;

export type EntityKind = "issue" | "pr";
export type Status = "open" | "closed" | "merged";

/**
 * The file that marks a directory as the Navbook root (spec 02 §2.10).
 *
 * It lives at the top of the Navbook directory and is what makes the directory
 * findable when it is not called `.navbook`. `parseTree` does not interpret it:
 * like any other reserved name it is preserved untouched, and it is the *file
 * system* layer that reads meaning into its location.
 */
export const NAV_MARKER = "navbook.json";

export const ISSUE_STATUSES: readonly Status[] = ["open", "closed"];
export const PR_STATUSES: readonly Status[] = ["open", "merged", "closed"];

/** The directory holding one subdirectory per feature (spec 02 §2.11). */
export const SPECS_DIR = "specs";

/** The directory each entity kind lives under, at the top of the Navbook root. */
export const ENTITY_DIR: Record<EntityKind, string> = { issue: "issues", pr: "prs" };

/** Whose `comments/` directories a tree read opened (see `readNavTree`). */
export type CommentScope = "all" | "prs" | "none";

export interface CommentRecord {
  id: string;
  fileName: string;
  /** Path relative to the Navbook directory. */
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
  /** True when the entity lives under the Navbook directory's `archive/` (spec 03 §3.6). */
  archived: boolean;
  archiveYear?: string;
  /** Directory path relative to the Navbook directory. */
  dirPath: string;
  /** Path of `issue.md` or `pr.md`, relative to the Navbook directory. */
  filePath: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  body: string;
  title: string;
  comments: CommentRecord[];
  /** Extra files inside the entity directory, preserved untouched (§2.1). */
  extraFiles: string[];
}

/** One specification document inside a feature directory (spec 02 §2.11). */
export interface SpecRecord {
  fileName: string;
  /** Path relative to the Navbook directory. */
  path: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  body: string;
  title: string;
}

/**
 * A feature: a standing concept that issues attach to, and the specification
 * documents that describe it (spec 02 §2.11).
 *
 * A feature has no ID and no status. Its directory name is its identity, which
 * is what an entity's `feature:` key names, and there is no list of members
 * here: membership is asserted by the entity alone (spec 06 §6.6).
 */
export interface FeatureRecord {
  slug: string;
  /** Directory path relative to the Navbook directory. */
  dirPath: string;
  /** Path of `feature.md`, relative to the Navbook directory. */
  filePath: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  body: string;
  title: string;
  specs: SpecRecord[];
  /** Other files and subdirectories, preserved untouched (§2.11). */
  extraFiles: string[];
}

export interface StructuralProblem {
  path: string;
  message: string;
}

/**
 * An entity directory whose name is well formed but which has no `issue.md` /
 * `pr.md`. The usual cause is a comment stranded by a merge (spec 03 §3.3.1);
 * recording the stray files lets `doctor --fix` reunite them with their entity.
 */
export interface OrphanDirectory {
  kind: EntityKind;
  id: string;
  dirName: string;
  dirPath: string;
  status: Status;
  archived: boolean;
  /** Comment files found under the orphaned directory. */
  commentPaths: string[];
}

export interface Repo {
  issues: EntityRecord[];
  prs: EntityRecord[];
  /** Every entity by ID; when IDs collide the first one encountered wins. */
  byId: Map<string, EntityRecord>;
  /** Features by slug, in slug order (spec 02 §2.11). */
  features: FeatureRecord[];
  featureBySlug: Map<string, FeatureRecord>;
  /** Grammar and layout faults found while walking the tree (doctor check D1). */
  problems: StructuralProblem[];
  /** Layout faults inside `specs/` (doctor check D13), kept apart from D1's. */
  featureProblems: StructuralProblem[];
  /** Well-named directories that hold no entity file (spec 03 §3.3.1). */
  orphans: OrphanDirectory[];
  /** Whose comment files the caller read; the rest were never opened. */
  commentsLoaded: CommentScope;
  /** Paths that were tolerated but not interpreted (reserved names, §2.10). */
  reserved: string[];
}

interface FeatureDraft {
  slug: string;
  dirPath: string;
  featureFile?: string;
  specs: Map<string, string>;
  extraFiles: string[];
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
export function parseTree(files: NavTree, opts: { commentsLoaded?: CommentScope } = {}): Repo {
  const problems: StructuralProblem[] = [];
  const featureProblems: StructuralProblem[] = [];
  const reserved: string[] = [];
  const drafts = new Map<string, EntityDraft>();
  const featureDrafts = new Map<string, FeatureDraft>();

  for (const path of [...files.keys()].sort()) {
    classify(path, drafts, featureDrafts, problems, featureProblems, reserved);
  }

  const issues: EntityRecord[] = [];
  const prs: EntityRecord[] = [];
  const byId = new Map<string, EntityRecord>();

  const orphans: OrphanDirectory[] = [];
  for (const draft of [...drafts.values()].sort((a, b) => (a.dirPath < b.dirPath ? -1 : 1))) {
    const record = materialize(draft, files, problems, orphans);
    if (!record) continue;
    (record.kind === "issue" ? issues : prs).push(record);
    if (!byId.has(record.id)) byId.set(record.id, record);
  }

  const features: FeatureRecord[] = [];
  const featureBySlug = new Map<string, FeatureRecord>();
  for (const draft of [...featureDrafts.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const record = materializeFeature(draft, files, featureProblems);
    if (!record) continue;
    features.push(record);
    featureBySlug.set(record.slug, record);
  }

  return {
    issues,
    prs,
    byId,
    features,
    featureBySlug,
    problems,
    featureProblems,
    orphans,
    commentsLoaded: opts.commentsLoaded ?? "all",
    reserved,
  };
}

function classify(
  path: string,
  drafts: Map<string, EntityDraft>,
  featureDrafts: Map<string, FeatureDraft>,
  problems: StructuralProblem[],
  featureProblems: StructuralProblem[],
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
  // `specs/` holds features, which have no status and are never archived: an
  // archived copy of one is not a shape this revision defines, so it stays
  // reserved rather than being read as a feature under another name.
  if (root === SPECS_DIR && !archived && rest.length > 1) {
    classifyFeature(path, rest, featureDrafts, featureProblems);
    return;
  }
  if (root !== ENTITY_DIR.issue && root !== ENTITY_DIR.pr) {
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

/**
 * Route one path inside `specs/` to its feature draft.
 *
 * A spec file is any `*.md` beside `feature.md`. Its name is not constrained:
 * nothing resolves a spec by constructing a path from it — a caller names a
 * file and the record it already parsed answers — so an unusual name is a
 * display question rather than a safety one, and §2.11 leaves it to taste.
 * Everything else the directory holds is preserved without being read.
 */
function classifyFeature(
  path: string,
  segments: readonly string[],
  featureDrafts: Map<string, FeatureDraft>,
  featureProblems: StructuralProblem[],
): void {
  const slug = segments[1] as string;
  if (segments.length === 2) {
    featureProblems.push({
      path,
      message: `'${SPECS_DIR}/' must contain feature directories, not files (§2.11)`,
    });
    return;
  }
  if (!SLUG_PATTERN.test(slug)) {
    featureProblems.push({
      path,
      message: `feature directory name '${slug}' does not match the slug grammar (§2.11)`,
    });
    return;
  }

  const dirPath = `${SPECS_DIR}/${slug}`;
  let draft = featureDrafts.get(slug);
  if (!draft) {
    draft = { slug, dirPath, specs: new Map(), extraFiles: [] };
    featureDrafts.set(slug, draft);
  }

  const inner = segments.slice(2);
  const name = inner[0] as string;
  if (inner.length === 1 && name === FEATURE_FILE) {
    draft.featureFile = path;
    return;
  }
  if (inner.length === 1 && name.endsWith(".md")) {
    draft.specs.set(name, path);
    return;
  }
  draft.extraFiles.push(path);
}

function materializeFeature(
  draft: FeatureDraft,
  files: NavTree,
  featureProblems: StructuralProblem[],
): FeatureRecord | null {
  if (!draft.featureFile) {
    featureProblems.push({
      path: draft.dirPath,
      message: `feature directory is missing its ${FEATURE_FILE} (§2.11)`,
    });
    return null;
  }

  const parsed = parseOrReport(files, draft.featureFile, featureProblems);
  if (!parsed) return null;

  const specs: SpecRecord[] = [];
  for (const fileName of [...draft.specs.keys()].sort()) {
    const path = draft.specs.get(fileName) as string;
    const specParsed = parseOrReport(files, path, featureProblems);
    if (!specParsed) continue;
    specs.push({
      fileName,
      path,
      parsed: specParsed,
      fm: specParsed.fm,
      body: specParsed.body,
      title: typeof specParsed.fm.title === "string" ? specParsed.fm.title : "",
    });
  }

  return {
    slug: draft.slug,
    dirPath: draft.dirPath,
    filePath: draft.featureFile,
    parsed,
    fm: parsed.fm,
    body: parsed.body,
    title: typeof parsed.fm.title === "string" ? parsed.fm.title : "",
    specs,
    extraFiles: draft.extraFiles.sort(),
  };
}

/** Parse a file, recording a structural problem when it cannot be read at all. */
function parseOrReport(
  files: NavTree,
  path: string,
  problems: StructuralProblem[],
): ParsedFile | null {
  try {
    return parseFile(files.get(path) ?? "");
  } catch (error) {
    problems.push({ path, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function materialize(
  draft: EntityDraft,
  files: NavTree,
  problems: StructuralProblem[],
  orphans: OrphanDirectory[],
): EntityRecord | null {
  const parsedName = parseDirName(draft.dirName);
  if (!parsedName) return null;

  const expectedFile = draft.kind === "issue" ? "issue.md" : "pr.md";
  if (!draft.entityFile) {
    problems.push({
      path: draft.dirPath,
      message: `entity directory is missing its ${expectedFile} (§2.1)`,
    });
    orphans.push({
      kind: draft.kind,
      id: parsedName.id,
      dirName: draft.dirName,
      dirPath: draft.dirPath,
      status: draft.status,
      archived: draft.archived,
      commentPaths: [...draft.comments.values()].sort(),
    });
    return null;
  }

  const parsed = parseOrReport(files, draft.entityFile, problems);
  if (!parsed) return null;

  const comments: CommentRecord[] = [];
  for (const name of [...draft.comments.keys()].sort()) {
    const path = draft.comments.get(name) as string;
    const meta = parseCommentFileName(name);
    if (!meta) continue;
    const commentParsed = parseOrReport(files, path, problems);
    if (!commentParsed) continue;
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
  return `${ENTITY_DIR[kind]}/${status}`;
}

/** Locate an entity by exact ID across both kinds. */
export function findById(repo: Repo, id: string): EntityRecord | undefined {
  return repo.byId.get(id);
}
