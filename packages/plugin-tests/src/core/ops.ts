/**
 * What can be done to plans and runs — `doc/spec.md` §3 to §5 and §9.
 *
 * Every change here is a `Plan` handed to the host's `runPlan`, which is how a
 * plugin's writes get `--commit`, the staged-changes guard and the commit
 * message conventions without implementing any of them. The CLI and the API
 * call the same functions: what differs between them is how the input was
 * gathered, never what is written.
 */

import { readFileSync } from "node:fs";
import type * as NavbookCore from "@navbook/core";
import type { EntityRecord, Plan, Repo, RunPlanResult, Trailer, WsCtx } from "@navbook/core";
import {
  isImageName,
  newRunFile,
  PLAN_FILE,
  RUNS_DIR,
  type RunChanges,
  rewriteRun,
  SCOPE,
  SHA,
  SLUG_PATTERN,
  TESTS_DIR,
  validatePlan,
} from "./files.ts";
import { latestHead, type Outcome, runOutcome } from "./outcome.ts";
import { type PlanStep, planSteps, type StepRecord, type StepStatus, textFaults } from "./steps.ts";
import type { PlanRecord, RunRecord } from "./tree.ts";
import { allRuns, prRunsOf, testsOf } from "./tree.ts";

/** The core this plugin runs against: the host's copy, handed to `activate`. */
export type Core = typeof NavbookCore;

export interface CommitOptions {
  commit?: boolean;
}

export interface EditOptions extends CommitOptions {
  /**
   * The `blobSha` of the text the editor started from. Given, a write over a
   * file that has changed since is refused (spec 06 §6.3: conflicts surface,
   * they are not resolved); absent, the write is unconditional, which is what
   * an editor session on a checkout is.
   */
  baseSha?: string;
}

/* --------------------------------------------------------------------- read */

/** Load the working tree once, with no comments: nothing here reads one. */
export function loadTree(core: Core, ws: WsCtx): Repo {
  return core.loadRepo(ws, { comments: "none" });
}

/** Resolve a plan by slug, or say what is wrong with the name. */
export function resolvePlan(core: Core, repo: Repo, slug: string): PlanRecord {
  const tests = testsOf(repo);
  const plan = tests.planBySlug.get(slug);
  if (plan !== undefined) return plan;
  if (!SLUG_PATTERN.test(slug)) {
    core.wsFail(
      "invalid-input",
      `'${slug}' is not a plan's slug: lowercase letters, digits and single hyphens`,
    );
  }
  core.wsFail(
    "not-found",
    `no test plan named '${slug}' in ${TESTS_DIR}/`,
    tests.plans.map((plan) => `${plan.slug}  ${plan.title}`),
  );
}

/**
 * Resolve a run by ID or unambiguous prefix, among `runs` — every run in the
 * tree unless the caller has a wider or narrower set in mind.
 *
 * Takes what the tools print for a run as well as its ID: `#id`, and its file
 * name or path.
 */
export function resolveRun(core: Core, runs: readonly RunRecord[], ref: string): RunRecord {
  const name = ref.replace(/\/+$/, "").split("/").pop() ?? ref;
  const parsed = core.parseCommentFileName(name.endsWith(".md") ? name : `${name}.md`);
  const wanted = parsed?.id ?? (ref.startsWith("#") ? ref.slice(1) : ref).toLowerCase();
  const resolution = core.resolvePrefix(
    wanted,
    runs.map((run) => run.id),
  );
  if (resolution.ok) return runs.find((run) => run.id === resolution.id) as RunRecord;
  switch (resolution.reason) {
    case "too-short":
      core.wsFail(
        "prefix-too-short",
        `'${ref}' is too short; ID prefixes must be at least ${core.MIN_PREFIX_LENGTH} characters`,
      );
      break;
    case "not-found":
      core.wsFail("not-found", `no test run matches '${ref}'`);
      break;
    default:
      core.wsFail("ambiguous", `'${ref}' matches more than one test run`, resolution.matches);
  }
}

/**
 * A run by reference, in this tree or, failing that, in a pull request only
 * another fetched branch carries — which is where a pull request's runs
 * usually are. `refs` names the branches it was read from, or is null for a
 * run in this tree: only a read may come from elsewhere.
 */
export function findRun(
  core: Core,
  ws: WsCtx,
  repo: Repo,
  ref: string,
): { run: RunRecord; refs: string[] | null } {
  try {
    return { run: resolveRun(core, allRuns(repo), ref), refs: null };
  } catch (error) {
    if (!(error instanceof core.WorkspaceError) || error.code !== "not-found") throw error;
    const elsewhere = runsElsewhere(core, ws, repo);
    let run: RunRecord;
    try {
      run = resolveRun(
        core,
        elsewhere.map((entry) => entry.run),
        ref,
      );
    } catch {
      throw error;
    }
    return { run, refs: elsewhere.find((entry) => entry.run === run)?.refs ?? [] };
  }
}

/** Runs in pull requests that only other fetched branches carry, with the refs that carry them. */
export function runsElsewhere(
  core: Core,
  ws: WsCtx,
  repo: Repo,
): { run: RunRecord; refs: string[] }[] {
  const here = new Set(repo.prs.map((pr) => pr.id));
  return core
    .scanRefsForOpenPrs(ws)
    .filter((found) => !here.has(found.entity.id))
    .flatMap((found) =>
      prRunsOf(found.entity).map((run) => ({ run, refs: found.refs.map((r) => r.short) })),
    );
}

/**
 * A run's outcome (§6): its step count from the run itself, else from the plan
 * `plan-sha` names, else from the plan in the tree. Only a run without `steps`
 * costs a look at git.
 */
export function outcomeAt(
  core: Core,
  ws: WsCtx,
  run: RunRecord,
  plan: PlanRecord | undefined,
): Outcome {
  if (run.steps !== null) return runOutcome(run);
  return runOutcome(run, stepsAtRun(core, ws, run, plan).steps?.length ?? null);
}

/**
 * A revision as a person names one — a hash, a branch, a tag, `HEAD~1` — and
 * nothing git would read as an option or a search: no leading `-`, no `:`.
 */
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._/@~^-]*$/;

/**
 * The commit a new run tests: the one named, else the pull request's latest
 * revision, else `HEAD` unless a version says what was tested instead (§4).
 */
export function testedCommit(
  core: Core,
  ws: WsCtx,
  given: { at?: string | null; pr: EntityRecord | null; version: string | null },
): string | null {
  const at = given.at?.trim() || null;
  if (at !== null) {
    const sha = REVISION.test(at) ? core.resolveSha(ws.repoRoot, at) : null;
    if (sha === null) core.wsFail("invalid-input", `'${at}' names no commit in this repository`);
    return sha;
  }
  if (given.pr !== null) return latestHead(given.pr);
  if (given.version !== null) return null;
  const head = core.resolveSha(ws.repoRoot, "HEAD");
  if (head === null)
    core.wsFail(
      "invalid-input",
      "this repository has no commit to test yet; name the version you tested instead",
    );
  return head;
}

/**
 * The steps a run was recorded against: the plan `plan-sha` names when this
 * clone holds it, else the plan in the tree (§6). `source` says which, so a
 * front end can say it fell back.
 */
export function stepsAtRun(
  core: Core,
  ws: WsCtx,
  run: RunRecord,
  plan: PlanRecord | undefined,
): { steps: PlanStep[] | null; source: "plan-sha" | "tree" | "none" } {
  // The common case costs no git: the plan has not changed since.
  if (plan !== undefined && run.planSha === plan.blobSha)
    return { steps: plan.steps, source: "plan-sha" };
  if (run.planSha !== null) {
    const text = core.blobContent(ws.repoRoot, run.planSha);
    if (text !== null) {
      try {
        return { steps: planSteps(core.parseFile(text).body).steps, source: "plan-sha" };
      } catch {
        // A blob that is not a plan is no better than none.
      }
    }
  }
  return plan === undefined
    ? { steps: null, source: "none" }
    : { steps: plan.steps, source: "tree" };
}

/* ------------------------------------------------------------------- commits */

/**
 * The commit subject for a change (§9): the plan, the run when there is one,
 * and the pull request the run is attached to.
 */
export function subjectFor(
  core: Core,
  action: string,
  slug: string,
  run?: { id: string; pr: { id: string } | null },
): string {
  const rest =
    run === undefined ? slug : `${slug} ${run.id}${run.pr === null ? "" : ` on #${run.pr.id}`}`;
  return core.docsScopedSubject(SCOPE, action, rest);
}

/** The trailer a change to a run attached to a pull request carries (§9). */
function trailersFor(run: { pr: { id: string } | null }): Trailer[] {
  return run.pr === null ? [] : [{ key: "Refs", id: run.pr.id }];
}

/* --------------------------------------------------------------------- plans */

export interface CreatePlanInput {
  /** The complete `plan.md`, frontmatter included. */
  content: string;
  /** The slug to file it under; derived from the title when absent. */
  slug?: string;
  /** Title to slug with when the file's own cannot be read. */
  fallbackTitle: string;
}

/** Create a plan from a composed `plan.md`. */
export function createPlan(
  core: Core,
  ws: WsCtx,
  input: CreatePlanInput,
  opts: CommitOptions,
): { slug: string; dirPath: string; filePath: string; run: RunPlanResult } {
  core.requireNavbook(ws);
  const slug = requirePlanSlug(
    core,
    input.slug ?? core.slugify(titleOf(core, input.content) ?? input.fallbackTitle),
    input.slug !== undefined,
  );
  if (testsOf(loadTree(core, ws)).planBySlug.has(slug)) {
    core.wsFail("already-exists", `test plan '${slug}' already exists at ${TESTS_DIR}/${slug}/`);
  }
  const dirPath = `${TESTS_DIR}/${slug}`;
  const filePath = `${dirPath}/${PLAN_FILE}`;
  const plan: Plan = {
    ops: [{ op: "write", path: filePath, content: input.content }],
    message: subjectFor(core, "create", slug),
    trailers: [],
  };
  return { slug, dirPath, filePath, run: core.runPlan(ws, plan, { commit: opts.commit }) };
}

/** Replace a plan's file with composed content. */
export function editPlan(
  core: Core,
  ws: WsCtx,
  slug: string,
  content: string,
  opts: EditOptions,
): { plan: PlanRecord; run: RunPlanResult } {
  const plan = resolvePlan(core, loadTree(core, ws), slug);
  assertUnchanged(core, plan.blobSha, `${plan.slug}/${PLAN_FILE}`, opts.baseSha);
  return { plan, run: core.runPlan(ws, planEdit(core, plan, content), { commit: opts.commit }) };
}

function planEdit(core: Core, plan: PlanRecord, content: string): Plan {
  return {
    ops: [{ op: "write", path: plan.filePath, content }],
    message: subjectFor(core, "edit", plan.slug),
    trailers: [],
  };
}

/** Schema and body problems in an edited `plan.md`, as messages. */
export function revalidatePlanFile(core: Core, path: string): string[] {
  let parsed: NavbookCore.ParsedFile;
  try {
    parsed = core.parseFile(readFileSync(path, "utf8"));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return validatePlan(parsed).map((problem) => problem.message);
}

/** Record an edit somebody already made to a plan's file, in place. */
export function applyPlanEdit(
  core: Core,
  ws: WsCtx,
  plan: PlanRecord,
  opts: CommitOptions,
): RunPlanResult {
  const content = readFileSync(core.absPath(ws, plan.filePath), "utf8");
  return core.runPlan(ws, planEdit(core, plan, content), { commit: opts.commit });
}

/* ---------------------------------------------------------------------- runs */

export interface StartRunInput {
  plan: PlanRecord;
  /** The pull request to attach it to, already resolved to one this checkout holds. */
  pr: EntityRecord | null;
  commit?: string | null;
  version?: string | null;
  environment?: string | null;
  notes?: string;
}

export interface StartRunResult {
  id: string;
  fileName: string;
  /** The new run's path, relative to the Navbook directory. */
  path: string;
  run: RunPlanResult;
}

/** Start a run of a plan: a run file with nothing recorded yet (§4). */
export function startRun(
  core: Core,
  ws: WsCtx,
  input: StartRunInput,
  opts: CommitOptions,
): StartRunResult {
  const { plan, pr } = input;
  if (plan.problems.length > 0) {
    core.wsFail(
      "precondition",
      `test plan '${plan.slug}' has faults; fix it before running it`,
      plan.problems.map((problem) => problem.message),
    );
  }
  if (plan.steps.length === 0)
    core.wsFail("precondition", `test plan '${plan.slug}' has no steps to run yet`);
  const commit = input.commit ?? null;
  const version = input.version?.trim() || null;
  if (commit !== null && !SHA.test(commit)) {
    core.wsFail("invalid-input", `'${commit}' is not a commit: expected 40 hexadecimal characters`);
  }
  if (commit === null && version === null) {
    core.wsFail("invalid-input", "a run must say what was tested: a commit, a version, or both");
  }
  if (input.notes !== undefined) failOn(core, textFaults(input.notes, "the notes", 2));

  const planSha = keepPlanBlob(core, ws, plan);
  const id = ws.mintId(core.scanAllIds(ws.navRoot));
  const date = ws.now();
  const fileName = core.commentFileName(date, id);
  const dir = pr === null ? `${plan.dirPath}/${RUNS_DIR}` : `${pr.dirPath}/${TESTS_DIR}`;
  const path = `${dir}/${fileName}`;
  const content = newRunFile({
    plan: plan.slug,
    planSha,
    steps: plan.steps.length,
    author: core.currentAuthor(ws),
    started: core.toIsoSeconds(date),
    commit,
    version,
    environment: input.environment?.trim() || null,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  });
  const target = { id, pr: pr === null ? null : { id: pr.id } };
  const result = core.runPlan(
    ws,
    {
      ops: [{ op: "write", path, content }],
      message: subjectFor(core, "run", plan.slug, target),
      trailers: trailersFor(target),
    },
    { commit: opts.commit },
  );
  return { id, fileName, path, run: result };
}

/**
 * Put the plan's text in the object store, and return the hash `plan-sha`
 * records: the blob exists even when the plan was edited and not yet
 * committed, so the run names the exact steps the tester followed, whatever
 * happens to the file next. Written and not staged — the index is the
 * author's, and only the run's own file belongs in this change.
 *
 * Hashed as `git add` would store the file, through the path's filters: with
 * `core.autocrlf` the working copy has CRLF and the committed blob does not,
 * and a hash of the working copy would name a blob no other clone ever gets.
 * Such a blob still lives only in this clone until the plan is committed.
 */
function keepPlanBlob(core: Core, ws: WsCtx, plan: PlanRecord): string {
  const text = readFileSync(core.absPath(ws, plan.filePath), "utf8");
  if (core.blobSha(text) !== plan.blobSha) return plan.blobSha;
  return core
    .git(["hash-object", "-w", "--stdin", `--path=${ws.navDir}/${plan.filePath}`], {
      cwd: ws.repoRoot,
      input: text,
    })
    .trim();
}

/** One step's result, as a front end gathers it. */
export interface StepResult {
  number: number;
  status: StepStatus;
  actual?: string | null;
}

export interface SaveRunInput {
  /** Steps to record, replacing what the run said about each. */
  results?: readonly StepResult[];
  /** Replace the notes. */
  notes?: string;
  /** Say the run is done. */
  finish?: boolean;
}

/**
 * Record steps of a run, change its notes, or finish it — one rewrite of its
 * file. `action` names the commit (§9): `record`, `finish`, or `run` for a
 * session that started the run and recorded it in one commit.
 *
 * A finished run is closed to recording: what the tester concluded has been
 * said, and a record added afterwards would change a conclusion somebody may
 * already have acted on. The file is still theirs to edit by hand.
 */
export function saveRun(
  core: Core,
  ws: WsCtx,
  run: RunRecord,
  steps: readonly PlanStep[] | null,
  input: SaveRunInput,
  opts: EditOptions & { action?: string },
): RunPlanResult {
  if (run.finished !== null)
    core.wsFail("precondition", `test run ${run.id} is finished; nothing more can be recorded`);
  assertUnchanged(core, run.blobSha, `test run ${run.id}`, opts.baseSha);

  const total = run.steps ?? steps?.length ?? null;
  const records: StepRecord[] = [];
  for (const result of input.results ?? []) {
    if (
      !Number.isInteger(result.number) ||
      result.number < 1 ||
      (total !== null && result.number > total)
    ) {
      core.wsFail(
        "invalid-input",
        total === null
          ? `step ${result.number} is not a step of this plan`
          : `step ${result.number} is not a step of this plan, which has ${total}`,
      );
    }
    const actual = result.actual?.trim() || null;
    if (actual !== null)
      failOn(core, textFaults(actual, `the actual result of step ${result.number}`, 0));
    const known =
      steps?.[result.number - 1]?.title ??
      run.records.find((r) => r.number === result.number)?.title ??
      "";
    records.push({ number: result.number, title: known, status: result.status, actual });
  }
  if (input.notes !== undefined) failOn(core, textFaults(input.notes, "the notes", 2));

  const changes: RunChanges = { record: records };
  if (input.notes !== undefined) changes.notes = input.notes;
  if (input.finish) changes.finished = core.nowIso(ws);
  const text = readFileSync(core.absPath(ws, run.path), "utf8");
  const content = rewriteRun(text, changes, `test run ${run.id}`);
  const action = opts.action ?? (input.finish ? "finish" : "record");
  return core.runPlan(
    ws,
    {
      ops: [{ op: "write", path: run.path, content }],
      message: subjectFor(core, action, run.plan, run),
      trailers: trailersFor(run),
    },
    { commit: opts.commit },
  );
}

/* --------------------------------------------------------------- attachments */

/** A file to attach, by the name it will have beside the run. */
export interface Attachment {
  name: string;
  bytes: Uint8Array;
}

/**
 * The name a file gets beside a run: letters, digits, `.`, `_` and `-`, so a
 * Markdown link to it needs no escaping and every file system accepts it.
 */
export function attachmentName(core: Core, original: string): string {
  const base = original.split(/[/\\]/).pop() ?? "";
  const name = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+/g, "-");
  if (name === "" || name === "." || name === "..") {
    core.wsFail("invalid-input", `'${original}' has no usable file name`);
  }
  return name;
}

/**
 * Attach files to a run (§5), and link them from the run: under the step's
 * actual result when one is named, which must already be recorded, or at the
 * end of the notes. One commit for the files and the link.
 *
 * Unlike recording, attaching is open on a finished run: a screenshot or a log
 * often turns up after the tester has said they are done, and a link beside
 * the actual result changes no status, so no conclusion moves.
 */
export function attachToRun(
  core: Core,
  ws: WsCtx,
  run: RunRecord,
  files: readonly Attachment[],
  opts: EditOptions & { step?: number },
): { names: string[]; run: RunPlanResult } {
  if (files.length === 0) core.wsFail("invalid-input", "nothing to attach");
  assertUnchanged(core, run.blobSha, `test run ${run.id}`, opts.baseSha);
  const taken = new Set(run.attachments.map((path) => path.split("/").pop() as string));
  const names: string[] = [];
  for (const file of files) {
    const name = attachmentName(core, file.name);
    if (taken.has(name))
      core.wsFail("already-exists", `test run ${run.id} already has an attachment named '${name}'`);
    taken.add(name);
    names.push(name);
  }
  const base = run.fileName.slice(0, -".md".length);
  const links = names
    .map((name) => `${isImageName(name) ? "!" : ""}[${name}](${base}/${name})`)
    .join("\n");

  const text = readFileSync(core.absPath(ws, run.path), "utf8");
  let changes: RunChanges;
  if (opts.step === undefined) {
    changes = { notes: [run.notes, links].filter((part) => part.trim() !== "").join("\n\n") };
  } else {
    const record = run.records.find((r) => r.number === opts.step);
    if (record === undefined) {
      core.wsFail(
        "precondition",
        `step ${opts.step} of test run ${run.id} is not recorded yet; record it, then attach`,
      );
    }
    changes = {
      record: [
        {
          ...record,
          actual: [record.actual ?? "", links].filter((part) => part.trim() !== "").join("\n\n"),
        },
      ],
    };
  }
  const content = rewriteRun(text, changes, `test run ${run.id}`);
  const plan: Plan = {
    ops: [
      ...files.map((file, index) => ({
        op: "write-bytes" as const,
        path: `${run.attachmentsDir}/${names[index]}`,
        bytes: file.bytes,
      })),
      { op: "write", path: run.path, content },
    ],
    message: subjectFor(core, "attach", run.plan, run),
    trailers: trailersFor(run),
  };
  return { names, run: core.runPlan(ws, plan, { commit: opts.commit }) };
}

/* ------------------------------------------------------------------- helpers */

/** Refuse a slug that is not one, or that a run's ID could be confused with (§2). */
function requirePlanSlug(core: Core, slug: string, given: boolean): string {
  if (!SLUG_PATTERN.test(slug)) {
    core.wsFail(
      "invalid-input",
      `'${slug}' is not a plan's slug: lowercase letters, digits and single hyphens`,
    );
  }
  if (core.isId(slug)) {
    core.wsFail(
      "invalid-input",
      `'${slug}' is shaped like an ID, which a run is named by; ${given ? "choose another slug" : "pass --slug to choose another"}`,
    );
  }
  return slug;
}

function titleOf(core: Core, content: string): string | null {
  try {
    const { fm } = core.parseFile(content);
    return typeof fm.title === "string" ? fm.title : null;
  } catch {
    return null;
  }
}

/** Refuse text that would change the file's structure once written. */
function failOn(core: Core, faults: readonly { message: string }[]): void {
  const [first, ...rest] = faults;
  if (first !== undefined)
    core.wsFail(
      "invalid-input",
      first.message,
      rest.map((fault) => fault.message),
    );
}

/**
 * Refuse a write whose author was looking at an older version of the file,
 * before anything is written.
 */
function assertUnchanged(
  core: Core,
  current: string,
  describe: string,
  baseSha: string | undefined,
): void {
  if (baseSha === undefined || current === baseSha) return;
  core.wsFail("stale-content", `${describe} changed since you opened it`, [
    "reload it and apply your change to what it says now",
  ]);
}
