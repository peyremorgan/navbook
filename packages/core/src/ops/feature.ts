/**
 * Feature operations — spec 02 §2.11 and spec 04 §4.3.
 *
 * A feature is a standing concept rather than a unit of work, so it has none of
 * the lifecycle verbs an entity has: no close, no reopen, no comments. What it
 * has is an identity card, the documents that describe it, and — derived, never
 * stored — the issues, pull requests and commits that have touched it.
 */

import { readFileSync } from "node:fs";
import {
  FEATURE_FILE,
  type ParsedFile,
  parseFile,
  readFeatures,
  validateFeature,
  validateSpec,
} from "../core/files.ts";
import {
  type Plan,
  planFeatureCreate,
  planFeatureEdit,
  planSpecAdd,
  planSpecEdit,
} from "../core/ops.ts";
import { extractProseRefs, extractTrailerRefs } from "../core/refs.ts";
import { SLUG_PATTERN, slugify } from "../core/slug.ts";
import {
  allEntities,
  type EntityRecord,
  type FeatureRecord,
  type Repo,
  SPECS_DIR,
  type SpecRecord,
} from "../core/tree.ts";
import { type CommitSummary, searchCommits } from "../git/history.ts";
import { hashObject } from "../git/index-ops.ts";
import {
  absPath,
  loadRepo,
  type RunPlanResult,
  repoPath,
  requireNavbook,
  requireSpecFileName,
  resolveFeature,
  resolveSpec,
  runPlan,
  type WsCtx,
  wsFail,
} from "../workspace/index.ts";
import type { CommitOptions } from "./entity.ts";
import { sortEntities } from "./entity.ts";

/* --------------------------------------------------------------------- read */

/** Every feature in the working tree, in slug order. */
export function listFeatures(ws: WsCtx): FeatureRecord[] {
  return loadRepo(ws, { includeComments: false }).features;
}

/** Resolve a feature by slug against the working tree. */
export function findFeature(ws: WsCtx, slug: string): FeatureRecord {
  return resolveFeature(loadRepo(ws, { includeComments: false }), slug);
}

/** The issues and pull requests that name a feature, newest first. */
export function featureMembers(
  repo: Repo,
  slug: string,
): { issues: EntityRecord[]; prs: EntityRecord[] } {
  const belongs = (entity: EntityRecord): boolean => readFeatures(entity.fm).includes(slug);
  return {
    issues: sortEntities(repo.issues.filter(belongs)),
    prs: sortEntities(repo.prs.filter(belongs)),
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
 * `Closes:` trailer it already carries (spec 02 §2.9).
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
  ws: WsCtx,
  feature: FeatureRecord,
  members: { issues: readonly EntityRecord[]; prs: readonly EntityRecord[] },
  opts: FeatureCommitOptions = {},
): CommitSummary[] {
  const limit = opts.limit ?? DEFAULT_COMMIT_LIMIT;
  if (limit <= 0) return [];

  const entities = [...members.issues, ...members.prs];
  const paths = [
    repoPath(ws.navDir, feature.dirPath),
    ...entities.map((entity) => repoPath(ws.navDir, entity.dirPath)),
  ];
  const ids = new Set(entities.map((entity) => entity.id));

  // Each walk comes back in git's own order, and that order is kept: a walk
  // knows which of two commits made in the same second came second, and an
  // author date rounded to the second does not. So the position within a walk
  // is the tie-break, and the sha only settles a tie between the two walks.
  const found = new Map<string, { commit: CommitSummary; order: number }>();
  const collect = (
    commits: readonly CommitSummary[],
    keep: (c: CommitSummary) => boolean,
  ): void => {
    let order = 0;
    for (const commit of commits) {
      if (!keep(commit)) continue;
      if (!found.has(commit.sha)) found.set(commit.sha, { commit, order });
      order++;
    }
  };

  collect(searchCommits(ws.repoRoot, { paths, limit }), () => true);
  if (ids.size > 0) {
    const grep = [...ids].join("|");
    collect(searchCommits(ws.repoRoot, { grep, limit }), (commit) =>
      referencesAny(commit.message, ids),
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

/** True when a commit message references one of these IDs (spec 02 §2.9). */
function referencesAny(message: string, ids: ReadonlySet<string>): boolean {
  const trailers = extractTrailerRefs(message);
  const named = [...extractProseRefs(message), ...trailers.refs, ...trailers.closes];
  return named.some((id) => ids.has(id));
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
  ws: WsCtx,
  input: CreateFeatureInput,
  opts: CommitOptions,
): CreateFeatureResult {
  requireNavbook(ws);
  const slug = requireSlug(input.slug ?? slugify(titleOf(input.content) ?? input.fallbackTitle));
  const repo = loadRepo(ws, { includeComments: false });
  if (repo.featureBySlug.has(slug)) {
    wsFail("already-exists", `feature '${slug}' already exists at ${SPECS_DIR}/${slug}/`);
  }
  const { plan, dirPath } = planFeatureCreate(slug, input.content);
  return { slug, dirPath, run: runPlan(ws, plan, { commit: opts.commit }) };
}

export interface AddSpecInput {
  /** The complete document, frontmatter included. */
  content: string;
  /** The file to write it to; derived from the title when absent. */
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
  ws: WsCtx,
  slug: string,
  input: AddSpecInput,
  opts: CommitOptions,
): AddSpecResult {
  const feature = findFeature(ws, slug);
  const fileName = requireSpecFileName(input.fileName);
  if (feature.specs.some((spec) => spec.fileName === fileName)) {
    wsFail("already-exists", `feature '${feature.slug}' already has a '${fileName}'`);
  }
  return {
    feature,
    fileName,
    path: `${feature.dirPath}/${fileName}`,
    run: runPlan(ws, planSpecAdd(feature, fileName, input.content), { commit: opts.commit }),
  };
}

export interface EditOptions extends CommitOptions {
  /**
   * The blob hash the editor started from.
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
  ws: WsCtx,
  slug: string,
  content: string,
  opts: EditOptions,
): { feature: FeatureRecord; run: RunPlanResult } {
  const feature = findFeature(ws, slug);
  assertUnchanged(ws, feature.filePath, `${feature.slug}/${FEATURE_FILE}`, opts.baseSha);
  return {
    feature,
    run: runPlan(ws, planFeatureEdit(feature, content), { commit: opts.commit }),
  };
}

/** Replace one of a feature's documents with composed content. */
export function editSpec(
  ws: WsCtx,
  slug: string,
  fileName: string,
  content: string,
  opts: EditOptions,
): { feature: FeatureRecord; spec: SpecRecord; run: RunPlanResult } {
  const feature = findFeature(ws, slug);
  const spec = resolveSpec(feature, fileName);
  assertUnchanged(ws, spec.path, `${feature.slug}/${spec.fileName}`, opts.baseSha);
  return {
    feature,
    spec,
    run: runPlan(ws, planSpecEdit(feature, spec, content), { commit: opts.commit }),
  };
}

/**
 * Refuse a write whose author was looking at an older version of the file.
 *
 * Checked before anything is written, so a refusal leaves the tree exactly as
 * it was and the caller still holds the only copy of what they wrote.
 */
function assertUnchanged(
  ws: WsCtx,
  filePath: string,
  describe: string,
  baseSha: string | undefined,
): void {
  if (baseSha === undefined) return;
  // A file that has gone is not the file the editor started from either, so a
  // hash git cannot work out counts as changed rather than as unchanged.
  const current = hashObject(ws.repoRoot, absPath(ws, filePath));
  if (current !== null && current === baseSha) return;
  wsFail("stale-content", `${describe} changed since you opened it`, [
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
  ws: WsCtx,
  slug: string,
  fileName?: string,
): FeatureEditTarget {
  const feature = findFeature(ws, slug);
  if (fileName === undefined) {
    return { feature, path: absPath(ws, feature.filePath), filePath: feature.filePath };
  }
  const spec = resolveSpec(feature, fileName);
  return { feature, spec, path: absPath(ws, spec.path), filePath: spec.path };
}

/** Schema problems in an edited feature file, as messages. */
export function revalidateFeatureFile(path: string, isSpec: boolean): string[] {
  let parsed: ParsedFile;
  try {
    parsed = parseFile(readFileSync(path, "utf8"));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return (isSpec ? validateSpec(parsed) : validateFeature(parsed)).map((p) => p.message);
}

/** Record an edit already made to a feature's file or one of its documents. */
export function applyFeatureEdit(
  ws: WsCtx,
  target: FeatureEditTarget,
  opts: CommitOptions,
): RunPlanResult {
  // The edited file is the operation's own output, so it belongs in the plan:
  // that is what tells the --commit guard which staged path is expected.
  const content = readFileSync(target.path, "utf8");
  const plan: Plan = target.spec
    ? planSpecEdit(target.feature, target.spec, content)
    : planFeatureEdit(target.feature, content);
  return runPlan(ws, plan, { commit: opts.commit });
}

/* ------------------------------------------------------------------ helpers */

function requireSlug(slug: string): string {
  if (SLUG_PATTERN.test(slug)) return slug;
  wsFail(
    "invalid-input",
    `'${slug}' is not a feature slug: lowercase letters, digits and single hyphens`,
  );
}

function titleOf(content: string): string | null {
  try {
    const { fm } = parseFile(content);
    return typeof fm.title === "string" ? fm.title : null;
  } catch {
    return null;
  }
}

/** Feature slugs any entity in the tree names, whether or not they exist. */
export function referencedFeatures(repo: Repo): string[] {
  const slugs = new Set<string>(repo.features.map((f) => f.slug));
  for (const entity of allEntities(repo)) {
    for (const slug of readFeatures(entity.fm)) slugs.add(slug);
  }
  return [...slugs].sort();
}
