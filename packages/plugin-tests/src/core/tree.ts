/**
 * Reading plans and runs out of a tree — `doc/spec.md` §2.
 *
 * Two readers over one run grammar. `buildTests` is the tree location for
 * `tests/`: plans, and the standalone runs beside them. `buildPrRuns` is the
 * entity location for `tests/` inside a pull request's directory: the runs
 * attached to it, kept on the pull request's own record so that a query term,
 * a `show` and a listing read out of another branch all have them.
 */

import type {
  EntityRecord,
  NavTree,
  ParsedFile,
  Problem,
  Repo,
  StructuralProblem,
} from "@navbook/core";
import {
  PLAN_FILE,
  RUNS_DIR,
  type RunFields,
  readRunFields,
  runningCore,
  SLUG_PATTERN,
  TESTS_DIR,
  validatePlan,
  validateRun,
} from "./files.ts";
import { type PlanStep, planSteps, runRecords, type StepRecord } from "./steps.ts";

/** A plan (§3). */
export interface PlanRecord {
  slug: string;
  /** Directory path relative to the Navbook directory. */
  dirPath: string;
  /** Path of `plan.md`, relative to the Navbook directory. */
  filePath: string;
  /** The hash of `plan.md`'s text, exactly as it was parsed: `plan-sha` for a new run, `baseSha` for an editor. */
  blobSha: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  title: string;
  description: string;
  steps: PlanStep[];
  /** Schema and body faults (X-tests-1). */
  problems: Problem[];
  /** Standalone runs, oldest first. */
  runs: RunRecord[];
  /** Other files in the plan's directory, preserved untouched. */
  extraFiles: string[];
}

/** A run (§4), standalone or attached to a pull request. */
export interface RunRecord extends RunFields {
  id: string;
  fileName: string;
  /** Path relative to the Navbook directory. */
  path: string;
  /** Where its attachments live, relative to the Navbook directory, whether or not any do. */
  attachmentsDir: string;
  /** Attachment paths relative to the Navbook directory. */
  attachments: string[];
  /** The hash of the file's text, exactly as it was parsed: what an editor hands back as `baseSha`. */
  blobSha: string;
  parsed: ParsedFile;
  fm: Record<string, unknown>;
  notes: string;
  records: StepRecord[];
  /** Schema and body faults (X-tests-1). */
  problems: Problem[];
  /** The pull request whose directory holds it, or null for a standalone run. */
  pr: { id: string; dirPath: string } | null;
}

/** What this plugin hangs off the tree, under `tests` in `Repo.ext`. */
export interface TestsModel {
  plans: PlanRecord[];
  planBySlug: Map<string, PlanRecord>;
}

/** What it hangs off a pull request, under `tests` in `EntityRecord.ext`. */
export interface PrRunsModel {
  runs: RunRecord[];
}

const EMPTY_TESTS: TestsModel = { plans: [], planBySlug: new Map() };
const NO_RUNS: PrRunsModel = { runs: [] };

/**
 * How a file's text becomes a record: the host's parser and hash, passed in so
 * the plugin reads with the core that is running.
 */
export interface TestsReader {
  parse(text: string): ParsedFile;
  hash(text: string): string;
}

/* ---------------------------------------------------------------- tests/ */

interface PlanDraft {
  slug: string;
  dirPath: string;
  planFile?: string;
  runs: Map<string, string>;
  attachments: Map<string, string[]>;
  extraFiles: string[];
}

/** The plans and standalone runs under `tests/`, and what is wrong with the layout. */
export function buildTests(
  files: NavTree,
  paths: readonly string[],
  reader: TestsReader,
): { model: TestsModel; problems: StructuralProblem[] } {
  const problems: StructuralProblem[] = [];
  const drafts = new Map<string, PlanDraft>();
  const badDirs = new Set<string>();

  for (const path of [...paths].sort()) {
    const segments = path.split("/");
    const slug = segments[1] as string;
    if (segments.length === 2) {
      problems.push({ path, message: `'${TESTS_DIR}/' must contain plan directories, not files` });
      continue;
    }
    if (!SLUG_PATTERN.test(slug) || runningCore().isId(slug)) {
      if (!badDirs.has(slug)) {
        badDirs.add(slug);
        problems.push({
          path: `${TESTS_DIR}/${slug}`,
          message: runningCore().isId(slug)
            ? `plan directory name '${slug}' is shaped like an ID, which would read as a run's`
            : `plan directory name '${slug}' does not match the slug grammar`,
        });
      }
      continue;
    }
    let draft = drafts.get(slug);
    if (draft === undefined) {
      draft = {
        slug,
        dirPath: `${TESTS_DIR}/${slug}`,
        runs: new Map(),
        attachments: new Map(),
        extraFiles: [],
      };
      drafts.set(slug, draft);
    }
    const inner = segments.slice(2);
    if (inner.length === 1 && inner[0] === PLAN_FILE) {
      draft.planFile = path;
      continue;
    }
    if (inner[0] === RUNS_DIR && inner.length >= 2) {
      classifyRunPath(path, inner.slice(1), draft, problems);
      continue;
    }
    draft.extraFiles.push(path);
  }

  const plans: PlanRecord[] = [];
  const planBySlug = new Map<string, PlanRecord>();
  for (const draft of [...drafts.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
    if (draft.planFile === undefined) {
      problems.push({ path: draft.dirPath, message: `plan directory is missing its ${PLAN_FILE}` });
      continue;
    }
    const read = parseOrReport(files, draft.planFile, problems, reader);
    if (read === null) continue;
    const body = planSteps(read.parsed.body);
    const runs = materializeRuns(
      files,
      draft,
      `${draft.dirPath}/${RUNS_DIR}`,
      null,
      problems,
      reader,
    );
    const plan: PlanRecord = {
      slug: draft.slug,
      dirPath: draft.dirPath,
      filePath: draft.planFile,
      blobSha: read.blobSha,
      parsed: read.parsed,
      fm: read.parsed.fm,
      title: typeof read.parsed.fm.title === "string" ? read.parsed.fm.title : "",
      description: body.description,
      steps: body.steps,
      problems: validatePlan(read.parsed),
      runs,
      extraFiles: draft.extraFiles.sort(),
    };
    plans.push(plan);
    planBySlug.set(plan.slug, plan);
  }
  return { model: { plans, planBySlug }, problems };
}

/**
 * Sort one path under a runs directory — `inner` is what follows it — into a
 * run file, a run's attachment, or a fault (§2, §5).
 */
function classifyRunPath(
  path: string,
  inner: readonly string[],
  draft: { runs: Map<string, string>; attachments: Map<string, string[]> },
  problems: StructuralProblem[],
): void {
  const name = inner[0] as string;
  if (inner.length === 1) {
    if (runningCore().parseCommentFileName(name) === null) {
      problems.push({
        path,
        message: `'${name}' is not a run: a run is named <timestamp>-<id>.md`,
      });
      return;
    }
    draft.runs.set(name, path);
    return;
  }
  if (runningCore().parseCommentFileName(`${name}.md`) === null) {
    problems.push({ path, message: `'${name}/' is neither a run nor a run's attachments` });
    return;
  }
  const list = draft.attachments.get(name);
  if (list === undefined) draft.attachments.set(name, [path]);
  else list.push(path);
}

/** The runs a draft collected, oldest first, with their attachments; orphaned attachments are faults. */
function materializeRuns(
  files: NavTree,
  draft: { runs: Map<string, string>; attachments: Map<string, string[]> },
  dir: string,
  pr: { id: string; dirPath: string } | null,
  problems: StructuralProblem[],
  reader: TestsReader,
): RunRecord[] {
  for (const name of draft.attachments.keys()) {
    if (!draft.runs.has(`${name}.md`)) {
      problems.push({
        path: `${dir}/${name}`,
        message: `attachments for a run that does not exist: no ${name}.md beside them`,
      });
    }
  }
  const runs: RunRecord[] = [];
  for (const fileName of [...draft.runs.keys()].sort()) {
    const path = draft.runs.get(fileName) as string;
    const name = runningCore().parseCommentFileName(fileName);
    const read = parseOrReport(files, path, problems, reader);
    if (name === null || read === null) continue;
    const base = fileName.slice(0, -".md".length);
    const body = runRecords(read.parsed.body);
    runs.push({
      ...readRunFields(read.parsed.fm),
      id: name.id,
      fileName,
      path,
      attachmentsDir: `${dir}/${base}`,
      attachments: (draft.attachments.get(base) ?? []).sort(),
      blobSha: read.blobSha,
      parsed: read.parsed,
      fm: read.parsed.fm,
      notes: body.notes,
      records: body.records,
      problems: validateRun(read.parsed),
      pr,
    });
  }
  return runs;
}

/* ------------------------------------------------ tests/ in a pull request */

/**
 * The path of a run file directly in a pull request's `tests/`, live or
 * archived: what the entity location reads. Attachments are listed and never
 * read, which is what keeps a screenshot out of the scan of other branches.
 */
const PR_RUN_FILE = /^(?:archive\/[^/]+\/)?prs\/[^/]+\/[^/]+\/tests\/[^/]+\.md$/;

/** True for a path the entity location reads. */
export function readsPrPath(path: string): boolean {
  return PR_RUN_FILE.test(path);
}

/** The runs in one pull request's `tests/`. */
export function buildPrRuns(
  files: NavTree,
  entity: { id: string; dirPath: string },
  paths: readonly string[],
  reader: TestsReader,
): { model: PrRunsModel; problems: StructuralProblem[] } {
  const problems: StructuralProblem[] = [];
  const dir = `${entity.dirPath}/${TESTS_DIR}`;
  const draft = { runs: new Map<string, string>(), attachments: new Map<string, string[]>() };
  for (const path of paths)
    classifyRunPath(path, path.slice(dir.length + 1).split("/"), draft, problems);
  const runs = materializeRuns(
    files,
    draft,
    dir,
    { id: entity.id, dirPath: entity.dirPath },
    problems,
    reader,
  );
  return { model: runs.length === 0 ? NO_RUNS : { runs }, problems };
}

/* ---------------------------------------------------------------- reading */

function parseOrReport(
  files: NavTree,
  path: string,
  problems: StructuralProblem[],
  reader: TestsReader,
): { parsed: ParsedFile; blobSha: string } | null {
  // Read outside the `try`, as core does: a file that cannot be read has not
  // failed to parse, and must fail the load rather than drop the record.
  const text = files.get(path) ?? "";
  try {
    return { parsed: reader.parse(text), blobSha: reader.hash(text) };
  } catch (error) {
    problems.push({ path, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** The model the host built, or the empty one when this plugin read no tree. */
export function testsOf(repo: { ext: ReadonlyMap<string, unknown> }): TestsModel {
  return (repo.ext.get(TESTS_DIR) as TestsModel | undefined) ?? EMPTY_TESTS;
}

/** The runs attached to a pull request, oldest first. */
export function prRunsOf(entity: EntityRecord): RunRecord[] {
  return ((entity.ext?.get(TESTS_DIR) as PrRunsModel | undefined) ?? NO_RUNS).runs;
}

/** Every run in the tree — standalone and attached — oldest first. */
export function allRuns(repo: Repo): RunRecord[] {
  const runs = [...testsOf(repo).plans.flatMap((plan) => plan.runs), ...repo.prs.flatMap(prRunsOf)];
  return runs.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
}

/** A plan's runs — standalone and attached to any pull request in the tree — oldest first. */
export function runsOfPlan(repo: Repo, slug: string): RunRecord[] {
  return allRuns(repo).filter((run) => run.plan === slug);
}
