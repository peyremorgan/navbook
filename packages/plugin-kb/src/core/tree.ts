/**
 * Reading `specs/` — spec 02 §2.11.
 *
 * The same code that used to sit in `@navbook/core`'s `tree.ts`, behind a
 * registered tree location instead. The host routes every path under `specs/`
 * here and holds what comes back in `Repo.ext`, opaquely; core no longer knows
 * what a feature is.
 *
 * One thing did change: where the faults go. They used to be
 * `Repo.featureProblems`, a field core carried for one check's benefit; they
 * now come back beside the model and this plugin's own D13 reports them. That
 * is what makes the arrangement general rather than a special case — an
 * extension's layout faults are the extension's to describe.
 */

import type { NavTree, ParsedFile, StructuralProblem } from "@navbook/core";
import { FEATURE_FILE, SLUG_PATTERN, SPECS_DIR } from "./files.ts";

/** One specification document inside a feature directory (§2.11). */
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
 * A feature: a standing concept that issues attach to, and the documents that
 * describe it (§2.11).
 *
 * It has no ID and no status. Its directory name is its identity, which is what
 * an entity's `feature:` names, and there is no list of members here:
 * membership is asserted by the entity alone (spec 06 §6.6).
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

/** What this plugin hangs off the tree, under `specs` in `Repo.ext`. */
export interface KbModel {
  features: FeatureRecord[];
  featureBySlug: Map<string, FeatureRecord>;
}

/** The reading of a tree with no `specs/` at all, which is most of them. */
export const EMPTY_KB: KbModel = { features: [], featureBySlug: new Map() };

interface FeatureDraft {
  slug: string;
  dirPath: string;
  featureFile?: string;
  specs: Map<string, string>;
  extraFiles: string[];
}

/** Build the feature model from the paths the host routed here. */
export function buildKb(
  files: NavTree,
  paths: readonly string[],
  parse: (text: string) => ParsedFile,
): { model: KbModel; problems: StructuralProblem[] } {
  const problems: StructuralProblem[] = [];
  const drafts = new Map<string, FeatureDraft>();

  for (const path of [...paths].sort()) classify(path, drafts, problems);

  const features: FeatureRecord[] = [];
  const featureBySlug = new Map<string, FeatureRecord>();
  for (const draft of [...drafts.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    const record = materialize(draft, files, problems, parse);
    if (!record) continue;
    features.push(record);
    featureBySlug.set(record.slug, record);
  }

  return { model: { features, featureBySlug }, problems };
}

function classify(
  path: string,
  drafts: Map<string, FeatureDraft>,
  problems: StructuralProblem[],
): void {
  const segments = path.split("/");
  const slug = segments[1] as string;
  if (segments.length === 2) {
    problems.push({
      path,
      message: `'${SPECS_DIR}/' must contain feature directories, not files (§2.11)`,
    });
    return;
  }
  if (!SLUG_PATTERN.test(slug)) {
    problems.push({
      path,
      message: `feature directory name '${slug}' does not match the slug grammar (§2.11)`,
    });
    return;
  }

  const dirPath = `${SPECS_DIR}/${slug}`;
  let draft = drafts.get(slug);
  if (!draft) {
    draft = { slug, dirPath, specs: new Map(), extraFiles: [] };
    drafts.set(slug, draft);
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

function materialize(
  draft: FeatureDraft,
  files: NavTree,
  problems: StructuralProblem[],
  parse: (text: string) => ParsedFile,
): FeatureRecord | null {
  if (!draft.featureFile) {
    problems.push({
      path: draft.dirPath,
      message: `feature directory is missing its ${FEATURE_FILE} (§2.11)`,
    });
    return null;
  }

  const parsed = parseOrReport(files, draft.featureFile, problems, parse);
  if (!parsed) return null;

  const specs: SpecRecord[] = [];
  for (const fileName of [...draft.specs.keys()].sort()) {
    const path = draft.specs.get(fileName) as string;
    const specParsed = parseOrReport(files, path, problems, parse);
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
  parse: (text: string) => ParsedFile,
): ParsedFile | null {
  try {
    return parse(files.get(path) ?? "");
  } catch (error) {
    problems.push({ path, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** The model the host built, or the empty one when this plugin read no tree. */
export function kbOf(ext: ReadonlyMap<string, unknown>): KbModel {
  return (ext.get(SPECS_DIR) as KbModel | undefined) ?? EMPTY_KB;
}
