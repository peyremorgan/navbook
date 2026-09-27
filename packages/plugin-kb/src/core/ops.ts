/**
 * Feature operations — spec 02 §2.11 and spec 04 §4.3.
 *
 * A feature is a standing concept rather than a unit of work, so it has none of
 * the lifecycle verbs an entity has: no close, no reopen, no comments. What it
 * has is an identity card, the documents that describe it, and — derived, never
 * stored — the issues, pull requests and commits that have touched it.
 *
 * Every mutation here returns a `Plan` and hands it to the host's `runPlan`.
 * That is not a formality: it is how a plugin's changes get `--commit`, the
 * staged-changes guard and the commit-message conventions without implementing
 * any of them. The plan names the paths it will touch, and the guard allows
 * exactly those.
 */

import { readFileSync } from "node:fs";
import type * as NavbookCore from "@navbook/core";
import type { EntityRecord, Plan, Repo, RunPlanResult, WsCtx } from "@navbook/core";
import {
  FEATURE_FILE,
  isSpecFileName,
  readFeatures,
  SLUG_PATTERN,
  SPECS_DIR,
  validateFeature,
  validateSpec,
} from "./files.ts";
import type { FeatureRecord, SpecRecord } from "./tree.ts";
import { kbOf } from "./tree.ts";

/** The core this plugin runs against: the host's copy, handed to `activate`. */
export type Core = typeof NavbookCore;

export interface CommitOptions {
  commit?: boolean;
}

/* --------------------------------------------------------------------- read */

/** Load the tree once, with no comments: nothing here reads one. */
function tree(core: Core, ws: WsCtx): Repo {
  return core.loadRepo(ws, { comments: "none" });
}

/** Every feature in the working tree, in slug order. */
export function listFeatures(core: Core, ws: WsCtx): FeatureRecord[] {
  return kbOf(tree(core, ws).ext).features;
}

/** Resolve a feature by slug against the working tree. */
export function findFeature(core: Core, ws: WsCtx, slug: string): FeatureRecord {
  return resolveFeature(core, tree(core, ws), slug);
}

/**
 * Resolve a feature by slug, or say what is wrong with the name.
 *
 * A name that is not a slug at all is a different fault from one that names no
 * directory, and the messages say so: the first is something to retype, the
 * second something to create.
 */
export function resolveFeature(core: Core, repo: Repo, slug: string): FeatureRecord {
  const kb = kbOf(repo.ext);
  const feature = kb.featureBySlug.get(slug);
  if (feature) return feature;
  if (!SLUG_PATTERN.test(slug)) {
    core.wsFail(
      "invalid-input",
      `'${slug}' is not a feature slug: lowercase letters, digits and single hyphens`,
    );
  }
  core.wsFail("not-found", `no feature named '${slug}' in ${SPECS_DIR}/`, [
    ...kb.features.map((f) => `${f.slug}  ${f.title}`),
  ]);
}

/**
 * Resolve one of a feature's documents by file name.
 *
 * By lookup rather than by joining the name onto a path: the record was parsed
 * from a file this tree holds, so its path cannot be anything the caller made
 * up. That is what makes serving a document by name safe over an API.
 */
export function resolveSpec(core: Core, feature: FeatureRecord, fileName: string): SpecRecord {
  const spec = feature.specs.find((s) => s.fileName === fileName);
  if (spec) return spec;
  core.wsFail(
    "not-found",
    `feature '${feature.slug}' has no document named '${fileName}'`,
    feature.specs.map((s) => s.fileName),
  );
}

/** Refuse a document name a tool must not create (§2.11). */
export function requireSpecFileName(core: Core, fileName: string): string {
  if (isSpecFileName(fileName)) return fileName;
  core.wsFail(
    "invalid-input",
    `'${fileName}' is not a document name this tool will create: expected a slug and '.md', and not 'feature.md'`,
  );
}

/** The issues and pull requests that name a feature, newest first. */
export function featureMembers(
  core: Core,
  repo: Repo,
  slug: string,
): { issues: EntityRecord[]; prs: EntityRecord[] } {
  const belongs = (entity: EntityRecord): boolean => readFeatures(entity.fm).includes(slug);
  return {
    issues: core.sortEntities(repo.issues.filter(belongs)),
    prs: core.sortEntities(repo.prs.filter(belongs)),
  };
}

export interface FeatureCommitOptions {
  limit?: number;
}

const DEFAULT_COMMIT_LIMIT = 100;

/**
 * The commits that touched a feature, newest first.
 *
 * Three things count, and the third is why this is not one `git log`. A commit
 * counts when it changed the feature's own documents, when it changed one of
 * its members' directories, or when its message references a member by ID —
 * which is how a commit that only touches code joins the story, through the
 * `Closes:` trailer it already carries (§2.9).
 *
 * git ANDs `--grep` with a pathspec, so the union takes two walks. Each is cut
 * to `limit`, which is exact rather than approximate: a commit outside a walk's
 * newest `limit` has `limit` newer commits in the union too, so it could not
 * have been in the union's newest `limit` either.
 *
 * The grep only narrows. Whether a message really references a member is then
 * decided by the reference grammar itself, so `#bqlybac0x` and a bare id inside
 * a word are excluded by the same code that excludes them everywhere else.
 */
export function featureCommits(
  core: Core,
  ws: WsCtx,
  feature: FeatureRecord,
  members: { issues: readonly EntityRecord[]; prs: readonly EntityRecord[] },
  opts: FeatureCommitOptions = {},
): NavbookCore.CommitSummary[] {
  const limit = opts.limit ?? DEFAULT_COMMIT_LIMIT;
  if (limit <= 0) return [];

  const entities = [...members.issues, ...members.prs];
  const paths = [
    core.repoPath(ws.navDir, feature.dirPath),
    ...entities.map((entity) => core.repoPath(ws.navDir, entity.dirPath)),
  ];
  const ids = new Set(entities.map((entity) => entity.id));

  // Each walk comes back in git's own order, and that order is kept: a walk
  // knows which of two commits made in the same second came second, and an
  // author date rounded to the second does not. So the position within a walk
  // is the tie-break, and the sha only settles a tie between the two walks.
  const found = new Map<string, { commit: NavbookCore.CommitSummary; order: number }>();
  const collect = (
    commits: readonly NavbookCore.CommitSummary[],
    keep: (c: NavbookCore.CommitSummary) => boolean,
  ): void => {
    let order = 0;
    for (const commit of commits) {
      if (!keep(commit)) continue;
      if (!found.has(commit.sha)) found.set(commit.sha, { commit, order });
      order++;
    }
  };

  collect(core.searchCommits(ws.repoRoot, { paths, limit }), () => true);
  if (ids.size > 0) {
    const grep = [...ids].join("|");
    collect(core.searchCommits(ws.repoRoot, { grep, limit }), (commit) =>
      referencesAny(core, commit.message, ids),
    );
  }

  return [...found.values()]
    .sort((a, b) => {
      const difference = b.commit.date.getTime() - a.commit.date.getTime();
      if (difference !== 0) return difference;
      if (a.order !== b.order) return a.order - b.order;
      return a.commit.sha < b.commit.sha ? -1 : a.commit.sha > b.commit.sha ? 1 : 0;
    })
    .map((entry) => entry.commit)
    .slice(0, limit);
}

/** True when a commit message references one of these IDs (§2.9). */
function referencesAny(core: Core, message: string, ids: ReadonlySet<string>): boolean {
  const trailers = core.extractTrailerRefs(message);
  const named = [...core.extractProseRefs(message), ...trailers.refs, ...trailers.closes];
  return named.some((id) => ids.has(id));
}

/** Feature slugs any entity in the tree names, whether or not they exist. */
export function referencedFeatures(core: Core, repo: Repo): string[] {
  const slugs = new Set<string>(kbOf(repo.ext).features.map((f) => f.slug));
  for (const entity of core.allEntities(repo)) {
    for (const slug of readFeatures(entity.fm)) slugs.add(slug);
  }
  return [...slugs].sort();
}

/* -------------------------------------------------------------------- plans */

/** The commit subject a change to a feature takes (spec 03 §3.2). */
function subject(core: Core, action: string, slug: string, file?: string): string {
  return core.docsScopedSubject("feature", action, slug, file);
}

export interface FeatureOpenResult {
  plan: Plan;
  slug: string;
  dirPath: string;
  filePath: string;
}

/** Create a feature directory and its identity card. */
export function planFeatureCreate(core: Core, slug: string, content: string): FeatureOpenResult {
  const dirPath = `${SPECS_DIR}/${slug}`;
  const filePath = `${dirPath}/${FEATURE_FILE}`;
  return {
    plan: {
      ops: [{ op: "write", path: filePath, content }],
      message: subject(core, "create", slug),
      trailers: [],
    },
    slug,
    dirPath,
    filePath,
  };
}

/** Record an edit to a feature's identity card. */
export function planFeatureEdit(core: Core, feature: FeatureRecord, content: string): Plan {
  return {
    ops: [{ op: "write", path: feature.filePath, content }],
    message: subject(core, "edit", feature.slug),
    trailers: [],
  };
}

/** Add a specification document to a feature. */
export function planSpecAdd(
  core: Core,
  feature: FeatureRecord,
  fileName: string,
  content: string,
): Plan {
  return {
    ops: [{ op: "write", path: `${feature.dirPath}/${fileName}`, content }],
    message: subject(core, "add", feature.slug, fileName),
    trailers: [],
  };
}

/** Record an edit to one of a feature's documents. */
export function planSpecEdit(
  core: Core,
  feature: FeatureRecord,
  spec: SpecRecord,
  content: string,
): Plan {
  return {
    ops: [{ op: "write", path: spec.path, content }],
    message: subject(core, "edit", feature.slug, spec.fileName),
    trailers: [],
  };
}

/* -------------------------------------------------------------------- write */

export interface CreateFeatureInput {
  /** The complete `feature.md`, frontmatter included. */
  content: string;
  /** The slug to file it under; derived from the title when absent. */
  slug?: string;
  /** Title to slug with when neither `slug` nor the file's own title serves. */
  fallbackTitle: string;
}

export interface CreateFeatureResult {
  slug: string;
  /** The new directory, relative to the Navbook directory. */
  dirPath: string;
  run: RunPlanResult;
}

/** Create a feature from a composed `feature.md`. */
export function createFeature(
  core: Core,
  ws: WsCtx,
  input: CreateFeatureInput,
  opts: CommitOptions,
): CreateFeatureResult {
  core.requireNavbook(ws);
  const slug = requireSlug(
    core,
    core.slugify(titleOf(core, input.content) ?? input.fallbackTitle),
    input.slug,
  );
  const repo = tree(core, ws);
  if (kbOf(repo.ext).featureBySlug.has(slug)) {
    core.wsFail("already-exists", `feature '${slug}' already exists at ${SPECS_DIR}/${slug}/`);
  }
  const { plan, dirPath } = planFeatureCreate(core, slug, input.content);
  return { slug, dirPath, run: core.runPlan(ws, plan, { commit: opts.commit }) };
}

export interface AddSpecInput {
  /** The complete document, frontmatter included. */
  content: string;
  /** The file to write it to. */
  fileName: string;
}

export interface AddSpecResult {
  feature: FeatureRecord;
  fileName: string;
  /** The new file, relative to the Navbook directory. */
  path: string;
  run: RunPlanResult;
}

/** Add a specification document to a feature. */
export function addSpec(
  core: Core,
  ws: WsCtx,
  slug: string,
  input: AddSpecInput,
  opts: CommitOptions,
): AddSpecResult {
  const feature = findFeature(core, ws, slug);
  const fileName = requireSpecFileName(core, input.fileName);
  if (feature.specs.some((spec) => spec.fileName === fileName)) {
    core.wsFail("already-exists", `feature '${feature.slug}' already has a '${fileName}'`);
  }
  return {
    feature,
    fileName,
    path: `${feature.dirPath}/${fileName}`,
    run: core.runPlan(ws, planSpecAdd(core, feature, fileName, input.content), {
      commit: opts.commit,
    }),
  };
}

export interface EditOptions extends CommitOptions {
  /**
   * The `baseSha` the editor started from: `blobSha` of the text it read, as
   * the record carries it — not `git hash-object`, which differs in a
   * repository with filters, end-of-line conversion or SHA-256 objects.
   *
   * Given, a write that would overwrite somebody else's is refused instead
   * (spec 06 §6.3: conflicts surface, they are not resolved). Absent, the write
   * is unconditional — which is what an editor session on a checkout is, since
   * the person doing it is looking at the file.
   */
  baseSha?: string;
}

/** Replace a feature's identity card with composed content. */
export function editFeature(
  core: Core,
  ws: WsCtx,
  slug: string,
  content: string,
  opts: EditOptions,
): { feature: FeatureRecord; run: RunPlanResult } {
  const feature = findFeature(core, ws, slug);
  assertUnchanged(core, feature.blobSha, `${feature.slug}/${FEATURE_FILE}`, opts.baseSha);
  return {
    feature,
    run: core.runPlan(ws, planFeatureEdit(core, feature, content), { commit: opts.commit }),
  };
}

/** Replace one of a feature's documents with composed content. */
export function editSpec(
  core: Core,
  ws: WsCtx,
  slug: string,
  fileName: string,
  content: string,
  opts: EditOptions,
): { feature: FeatureRecord; spec: SpecRecord; run: RunPlanResult } {
  const feature = findFeature(core, ws, slug);
  const spec = resolveSpec(core, feature, fileName);
  assertUnchanged(core, spec.blobSha, `${feature.slug}/${spec.fileName}`, opts.baseSha);
  return {
    feature,
    spec,
    run: core.runPlan(ws, planSpecEdit(core, feature, spec, content), { commit: opts.commit }),
  };
}

/**
 * Refuse a write whose author was looking at an older version of the file.
 *
 * Checked before anything is written, so a refusal leaves the tree exactly as
 * it was and the caller still holds the only copy of what they wrote.
 *
 * `current` is the hash the record carries, taken of the text this very load
 * parsed: there is no second read to disagree with the first, and it is the
 * same token an entity's `baseSha` is, worked out the same way.
 */
function assertUnchanged(
  core: Core,
  current: string,
  describe: string,
  baseSha: string | undefined,
): void {
  if (baseSha === undefined) return;
  if (current === baseSha) return;
  core.wsFail("stale-content", `${describe} changed since you opened it`, [
    "reload it and apply your change to what it says now",
  ]);
}

/* --------------------------------------------------------------- edit in place */

export interface FeatureEditTarget {
  feature: FeatureRecord;
  spec?: SpecRecord;
  /** Absolute path of the file to edit — the real file, not a scratch buffer. */
  path: string;
  /** Path relative to the Navbook directory. */
  filePath: string;
}

/** Locate a feature's file, or one of its documents, so a caller can edit it. */
export function resolveFeatureForEdit(
  core: Core,
  ws: WsCtx,
  slug: string,
  fileName?: string,
): FeatureEditTarget {
  const feature = findFeature(core, ws, slug);
  if (fileName === undefined) {
    return { feature, path: core.absPath(ws, feature.filePath), filePath: feature.filePath };
  }
  const spec = resolveSpec(core, feature, fileName);
  return { feature, spec, path: core.absPath(ws, spec.path), filePath: spec.path };
}

/** Schema problems in an edited feature file, as messages. */
export function revalidateFeatureFile(core: Core, path: string, isSpec: boolean): string[] {
  let parsed: NavbookCore.ParsedFile;
  try {
    parsed = core.parseFile(readFileSync(path, "utf8"));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return (isSpec ? validateSpec(parsed) : validateFeature(parsed)).map((p) => p.message);
}

/** Record an edit already made to a feature's file or one of its documents. */
export function applyFeatureEdit(
  core: Core,
  ws: WsCtx,
  target: FeatureEditTarget,
  opts: CommitOptions,
): RunPlanResult {
  // The edited file is the operation's own output, so it belongs in the plan:
  // that is what tells the --commit guard which staged path is expected.
  const content = readFileSync(target.path, "utf8");
  const plan: Plan = target.spec
    ? planSpecEdit(core, target.feature, target.spec, content)
    : planFeatureEdit(core, target.feature, content);
  return core.runPlan(ws, plan, { commit: opts.commit });
}

/* ------------------------------------------------------------------ helpers */

function requireSlug(core: Core, derived: string, given?: string): string {
  const slug = given ?? derived;
  if (SLUG_PATTERN.test(slug)) return slug;
  core.wsFail(
    "invalid-input",
    `'${slug}' is not a feature slug: lowercase letters, digits and single hyphens`,
  );
}

function titleOf(core: Core, content: string): string | null {
  try {
    const { fm } = core.parseFile(content);
    return typeof fm.title === "string" ? fm.title : null;
  } catch {
    return null;
  }
}
