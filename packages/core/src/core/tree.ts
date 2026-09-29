/**
 * The in-memory model of a `.navbook/` tree — spec 02 §2.1 and §2.11.
 *
 * Input is a flat map of paths (relative to `.navbook/`) to file contents, so
 * the model works equally well over a working tree, a git index, or the blobs
 * of a branch that is not checked out.
 */

import { parseCommentFileName } from "./comments.ts";
import { type CoreExtensions, NO_EXTENSIONS } from "./extensions.ts";
import { type ParsedFile, parseFile, readMerged, readPersonList } from "./files.ts";
import { blobSha } from "./hash.ts";
import { dedupePeople, type Person, parsePerson } from "./person.ts";
import { type PluginDeclarationReading, parsePluginDeclaration } from "./plugins.ts";
import {
  type MarkerVersionFault,
  type MergePolicyReading,
  parseMarkerVersion,
  parseMergePolicy,
  parseReviewPolicy,
  type ReviewPolicyReading,
} from "./policy.ts";
import { parseDirName } from "./slug.ts";

/**
 * A Navbook directory as a set of paths whose contents can be asked for.
 *
 * Two operations rather than a `Map` because a reader may not want to have read
 * everything: `parseTree` asks for the content of the files it parses and of no
 * others, so a lazy implementation never opens an extension namespace (§2.12)
 * or a feature's images (§2.11), whose bytes nothing here interprets. A
 * `Map<string, string>` satisfies it, which is what keeps the eager readers —
 * the index, the blobs of another branch — as they are.
 */
export interface NavTree {
  keys(): Iterable<string>;
  get(path: string): string | undefined;
}

export type EntityKind = "issue" | "pr";
export type Status = "open" | "closed" | "merged";

/**
 * The file that marks a directory as the Navbook root (spec 02 §2.10).
 *
 * It lives at the top of the Navbook directory and is what makes the directory
 * findable when it is not called `.navbook`. Its location is what the *file
 * system* layer reads meaning into; its content carries the review policy
 * (§2.10), which is the only part of it `parseTree` interprets.
 */
export const NAV_MARKER = "navbook.json";

export const ISSUE_STATUSES: readonly Status[] = ["open", "closed"];
export const PR_STATUSES: readonly Status[] = ["open", "merged", "closed"];

/** The directory each entity kind lives under, at the top of the Navbook root. */
export const ENTITY_DIR: Record<EntityKind, string> = { issue: "issues", pr: "prs" };

/** Whose `comments/` directories a tree read opened (see `readNavTree`). */
export type CommentScope = "all" | "prs" | "none";

/**
 * Whether a read with `scope` opens the comments of the entity at `dirPath`.
 *
 * One rule for the walk that skips the directories and for the records that
 * say they were skipped, so the two cannot disagree. An archived pull request
 * lives under `archive/`, not `prs/`, and is outside `prs` like any issue.
 */
export function commentsInScope(scope: CommentScope, dirPath: string): boolean {
  if (scope === "all") return true;
  return scope === "prs" && dirPath.startsWith(`${ENTITY_DIR.pr}/`);
}

/**
 * Whether `dirPath` is where an entity lives, so that its `comments/` holds
 * comments: `[archive/<year>/]{issues,prs}/<status>/<dir>` (§2.1, §2.9).
 *
 * The same name anywhere else — inside a plugin's directory, or an entity's
 * extension namespace (§2.12) — is somebody's data, not the format's.
 */
export function isEntityDirPath(dirPath: string): boolean {
  const segments = dirPath.split("/");
  const rest = segments[0] === "archive" ? segments.slice(2) : segments;
  return rest.length === 3 && (rest[0] === ENTITY_DIR.issue || rest[0] === ENTITY_DIR.pr);
}

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
  /**
   * The hash of that file's text, exactly as it was parsed (`core/hash.ts`).
   *
   * What an editor hands back to say which version it started from. It is of
   * the text this record was built from, so a record and its hash can never
   * disagree — which a hash taken from the file afterwards could.
   */
  blobSha: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  body: string;
  title: string;
  comments: CommentRecord[];
  /**
   * False when the read this record came from left its comments out, so that
   * `comments` is empty for that reason rather than because there are none.
   * `withComments` reads them.
   */
  commentsLoaded: boolean;
  /** Extra files inside the entity directory, preserved untouched (§2.1). */
  extraFiles: string[];
  /**
   * What each registered entity location built from this entity's directory,
   * by the location's name (§2.12). Its paths are not in `extraFiles`.
   *
   * Opaque here, as `Repo.ext` is: only the plugin that registered the
   * location knows what is in it. Empty when nothing is registered.
   */
  ext: ReadonlyMap<string, unknown>;
}

/** The `ext` of every entity when no entity location applies: shared, so it costs nothing. */
const NO_ENTITY_EXT: ReadonlyMap<string, unknown> = new Map();

/** A grammar or layout fault found while walking the tree (check D1). */
export interface StructuralProblem {
  path: string;
  message: string;
}

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
  /** Grammar and layout faults found while walking the tree (doctor check D1). */
  problems: StructuralProblem[];
  /** Well-named directories that hold no entity file (spec 03 §3.3.1). */
  orphans: OrphanDirectory[];
  /** Whose comment files the caller read; the rest were never opened. */
  commentsLoaded: CommentScope;
  /** Paths that were tolerated but not interpreted (reserved names, §2.10). */
  reserved: string[];
  /** The review policy the marker declares, and what was wrong with it (§2.10). */
  reviewPolicy: ReviewPolicyReading;
  /** The merge policy the marker declares, and what was wrong with it (§2.10). */
  mergePolicy: MergePolicyReading;
  /** The plugins the marker declares, and what was wrong with it (§2.12). */
  plugins: PluginDeclarationReading;
  /** A marker `version` this tool cannot take at its word (§2.10, D15/D16). */
  versionFault: MarkerVersionFault | null;
  /**
   * What each registered tree location built, by its directory name (§2.12).
   *
   * Opaque here: core routes the paths and holds the result, and only the
   * plugin that registered the location knows what is in it.
   */
  ext: Map<string, unknown>;
  /** Layout faults each location reported, by directory name; the plugin reports them. */
  extProblems: Map<string, StructuralProblem[]>;
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
  /** Paths under a registered entity location, by the location's name. */
  extPaths: Map<string, string[]>;
}

/** Build a {@link Repo} from a tree, reading only the files it parses. */
export function parseTree(
  files: NavTree,
  opts: { commentsLoaded?: CommentScope; ext?: CoreExtensions } = {},
): Repo {
  const extensions = opts.ext ?? NO_EXTENSIONS;
  const scope = opts.commentsLoaded ?? "all";
  const { drafts, problems, reserved, extPaths } = classifyAll(files.keys(), extensions);

  const issues: EntityRecord[] = [];
  const prs: EntityRecord[] = [];
  const byId = new Map<string, EntityRecord>();

  const orphans: OrphanDirectory[] = [];
  const extProblems = new Map<string, StructuralProblem[]>();
  for (const draft of [...drafts.values()].sort((a, b) => (a.dirPath < b.dirPath ? -1 : 1))) {
    const record = materialize(draft, files, problems, orphans, scope, extensions, extProblems);
    if (!record) continue;
    (record.kind === "issue" ? issues : prs).push(record);
    if (!byId.has(record.id)) byId.set(record.id, record);
  }

  const ext = new Map<string, unknown>();
  for (const location of extensions.treeLocations) {
    const paths = extPaths.get(location.dir) ?? [];
    const built = location.build(files, paths);
    ext.set(location.dir, built.model);
    addProblems(extProblems, location.dir, built.problems);
  }

  const markerText = files.get(NAV_MARKER);
  return {
    issues,
    prs,
    byId,
    problems,
    orphans,
    commentsLoaded: scope,
    reserved,
    reviewPolicy: parseReviewPolicy(markerText),
    mergePolicy: parseMergePolicy(markerText),
    plugins: parsePluginDeclaration(markerText),
    versionFault: parseMarkerVersion(markerText),
    ext,
    extProblems,
  };
}

/**
 * Append a location's faults under its name. A plugin may register a tree
 * location and an entity location of one name, and reports both from one
 * check, so the two share the key.
 */
function addProblems(
  into: Map<string, StructuralProblem[]>,
  dir: string,
  found: readonly StructuralProblem[],
): void {
  if (found.length === 0) return;
  const list = into.get(dir);
  if (list === undefined) into.set(dir, [...found]);
  else list.push(...found);
}

/**
 * The paths whose content {@link parseTree} may ask a tree with these keys for.
 *
 * The marker, each entity's file and comments, and whatever lies under a
 * registered location, whose plugin decides what it opens — for an entity
 * location, the paths its `reads` accepts. Everything else — an entity's
 * extension namespace (§2.12) nobody registered, an unregistered directory —
 * is listed and never read. Worked out by the same classification `parseTree`
 * runs, so a reader that must fetch in advance, like the scan of other
 * branches, has no second copy of the directory grammar to drift from it.
 */
export function parsedPaths(keys: Iterable<string>, opts: { ext?: CoreExtensions } = {}): string[] {
  const listed = [...keys];
  const extensions = opts.ext ?? NO_EXTENSIONS;
  const { drafts, extPaths } = classifyAll(listed, extensions);
  const paths: string[] = [];
  for (const draft of drafts.values()) {
    if (draft.entityFile !== undefined) paths.push(draft.entityFile);
    paths.push(...draft.comments.values());
    for (const location of extensions.entityLocations) {
      const bucket = draft.extPaths.get(location.dir) ?? [];
      paths.push(...(location.reads ? bucket.filter((path) => location.reads?.(path)) : bucket));
    }
  }
  for (const bucket of extPaths.values()) paths.push(...bucket);
  if (listed.includes(NAV_MARKER)) paths.push(NAV_MARKER);
  return paths.sort();
}

interface Classified {
  drafts: Map<string, EntityDraft>;
  problems: StructuralProblem[];
  reserved: string[];
  extPaths: Map<string, string[]>;
}

function classifyAll(keys: Iterable<string>, extensions: CoreExtensions): Classified {
  const problems: StructuralProblem[] = [];
  const reserved: string[] = [];
  const drafts = new Map<string, EntityDraft>();
  // One bucket per registered location, made up front so a location that
  // matches nothing still builds — an empty `specs/` is a real state, and a
  // plugin that never heard about it could not report the difference between
  // no features and no directory.
  const extPaths = new Map<string, string[]>(
    extensions.treeLocations.map((location) => [location.dir, []]),
  );
  const entityDirs: Record<EntityKind, Set<string>> = { issue: new Set(), pr: new Set() };
  for (const location of extensions.entityLocations) {
    for (const kind of location.kinds) entityDirs[kind].add(location.dir);
  }
  for (const path of [...keys].sort()) {
    classify(path, drafts, problems, reserved, extPaths, entityDirs);
  }
  return { drafts, problems, reserved, extPaths };
}

function classify(
  path: string,
  drafts: Map<string, EntityDraft>,
  problems: StructuralProblem[],
  reserved: string[],
  extPaths: Map<string, string[]>,
  entityDirs: Record<EntityKind, ReadonlySet<string>>,
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
  if (root !== ENTITY_DIR.issue && root !== ENTITY_DIR.pr) {
    // A directory a plugin registered is that plugin's to read (§2.12). Not
    // when archived, for the reason `specs/` is not: an archived copy of an
    // extension's directory is not a shape anything defines, so it stays
    // reserved rather than being read as live data under another name.
    const bucket = !archived && rest.length > 1 ? extPaths.get(root) : undefined;
    if (bucket !== undefined) {
      bucket.push(path);
      return;
    }
    // Reserved and unknown names are tolerated and preserved untouched (§2.10).
    // The marker is not among them: it is read for its review policy, and
    // listing it as uninterpreted would say the opposite of what happens.
    if (path !== NAV_MARKER) reserved.push(path);
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
      extPaths: new Map(),
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
  // A directory a plugin registered for this kind is that plugin's to read
  // (§2.12); the same name in the other kind is nobody's, and stays extra.
  const namespace = inner[0] as string;
  if (inner.length >= 2 && entityDirs[kind].has(namespace)) {
    const bucket = draft.extPaths.get(namespace);
    if (bucket === undefined) draft.extPaths.set(namespace, [path]);
    else bucket.push(path);
    return;
  }
  draft.extraFiles.push(path);
}

/**
 * Parse a file, recording a structural problem when it cannot be read at all.
 *
 * `ext` is passed for an entity file and withheld everywhere else, because a
 * registered key names the kind it belongs to and both kinds are entities: a
 * comment has no kind for one to name.
 */
function parseOrReport(
  files: NavTree,
  path: string,
  problems: StructuralProblem[],
  ext?: CoreExtensions,
): ParsedFile | null {
  // Read outside the `try`: a file that cannot be read is not one that failed
  // to parse, and must fail the load rather than drop the entity from it.
  const text = files.get(path) ?? "";
  try {
    return parseFile(text, ext);
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
  scope: CommentScope,
  ext: CoreExtensions,
  extProblems: Map<string, StructuralProblem[]>,
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

  const parsed = parseOrReport(files, draft.entityFile, problems, ext);
  if (!parsed) return null;

  const comments = commentRecords(draft.comments, files, problems);

  const record: Omit<EntityRecord, "ext"> = {
    kind: draft.kind,
    id: parsedName.id,
    slug: parsedName.slug,
    dirName: draft.dirName,
    status: draft.status,
    archived: draft.archived,
    archiveYear: draft.archiveYear,
    dirPath: draft.dirPath,
    filePath: draft.entityFile,
    blobSha: blobSha(files.get(draft.entityFile) ?? ""),
    parsed,
    fm: parsed.fm,
    body: parsed.body,
    title: typeof parsed.fm.title === "string" ? parsed.fm.title : "",
    comments,
    commentsLoaded: commentsInScope(scope, draft.dirPath),
    extraFiles: draft.extraFiles.sort(),
  };
  return { ...record, ext: entityExt(record, draft, files, ext, extProblems) };
}

/**
 * What the entity locations registered for this entity's kind built from its
 * directory. Every applicable location builds, even with no paths, so a plugin
 * can tell "nothing recorded" from "not asked" (as a tree location can).
 */
function entityExt(
  record: Omit<EntityRecord, "ext">,
  draft: EntityDraft,
  files: NavTree,
  ext: CoreExtensions,
  extProblems: Map<string, StructuralProblem[]>,
): ReadonlyMap<string, unknown> {
  const locations = ext.entityLocations.filter((location) => location.kinds.includes(record.kind));
  if (locations.length === 0) return NO_ENTITY_EXT;
  const models = new Map<string, unknown>();
  for (const location of locations) {
    const paths = (draft.extPaths.get(location.dir) ?? []).sort();
    const built = location.build(files, record, paths);
    models.set(location.dir, built.model);
    addProblems(extProblems, location.dir, built.problems);
  }
  return models;
}

/**
 * One entity's comments, oldest first, from the files named in `paths`.
 *
 * `paths` maps each comment's file name to its path in `files`. A name that is
 * not a comment's, or a file that does not parse, is left out; the parse
 * failure goes to `problems`.
 */
export function commentRecords(
  paths: ReadonlyMap<string, string>,
  files: NavTree,
  problems: StructuralProblem[],
): CommentRecord[] {
  const comments: CommentRecord[] = [];
  for (const name of [...paths.keys()].sort()) {
    const path = paths.get(name) as string;
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
  return comments;
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

/**
 * Everyone the tree names, in the order the addresses first appear.
 *
 * Read defensively, as every frontmatter reader here is: a value that is not a
 * person is skipped rather than reported, because this is a directory of who
 * is around and not a check on whether the files are well formed — `doctor`
 * has that job, and it would say the same thing twice.
 *
 * `merged.by` is in it because merging a pull request is work somebody did
 * (spec 02 §2.7), and comment authors are because saying something about an
 * issue is the commonest way to be somebody this repository knows of.
 */
export function treePeople(repo: Repo): Person[] {
  const found: Person[] = [];
  const add = (field: unknown): void => {
    if (typeof field !== "string") return;
    const person = parsePerson(field);
    if (person !== null) found.push(person);
  };

  for (const entity of allEntities(repo)) {
    add(entity.fm.author);
    for (const value of readPersonList(entity.fm, "assignee")) add(value);
    for (const value of readPersonList(entity.fm, "reviewer")) add(value);
    add(readMerged(entity.fm)?.by);
    for (const comment of entity.comments) add(comment.author);
  }

  return dedupePeople(found);
}
