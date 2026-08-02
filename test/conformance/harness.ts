/**
 * The conformance fixture harness.
 *
 * A fixture is plain browsable files plus a `case.yaml` manifest. The harness
 * materializes a deterministic git repository from it, runs one command, and
 * compares the exit code, stdout, resulting `.navbook/` tree and new commits.
 *
 * Nothing here is specific to the TypeScript implementation: the command under
 * test is `$NAV_BIN`, so the same suite validates any implementation of the
 * spec. See `doc/spec/fixtures/README.md` for the manifest contract.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { FIXTURE_DATE, makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

export interface HistoryStep {
  id?: string;
  branch?: string;
  from?: string;
  apply?: string;
  rm?: string[];
  message?: string;
  date?: string;
}

/** One setup action: run nav, run git, or put a file in the working tree. */
export type SetupStep =
  | { nav: string[] }
  | { git: string[] }
  | { write: { path: string; content?: string } };

export interface CaseManifest {
  "spec-version"?: number;
  description?: string;
  init?: { from?: string; message?: string; date?: string };
  history?: HistoryStep[];
  run?: {
    checkout?: string;
    command?: string[];
    git?: string[];
    env?: Record<string, string>;
    /** Setup performed after materialization and before the command under test. */
    before?: SetupStep[];
  };
  expect?: {
    exit?: number;
    stdout?: string;
    stderr?: string;
    tree?: string;
    commits?: string[];
    /** Substrings that must appear in stderr (for error-message fixtures). */
    "stderr-contains"?: string[];
    /**
     * Diagnostics `nav doctor --json` must report, compared by check code,
     * level and path only. Messages are implementation-defined.
     */
    diagnostics?: { check: string; level: string; path: string }[];
  };
}

export interface CaseResult {
  failures: string[];
  stdout: string;
  stderr: string;
  code: number;
}

/** Read and lightly validate a fixture manifest. */
export function readManifest(caseDir: string): CaseManifest {
  const text = readFileSync(join(caseDir, "case.yaml"), "utf8");
  const manifest = parseYaml(text) as CaseManifest;
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`${caseDir}/case.yaml is not a mapping`);
  }
  if (!manifest.run?.command && !manifest.run?.git) {
    throw new Error(`${caseDir}/case.yaml has no run.command or run.git`);
  }
  return manifest;
}

/** Every fixture case directory (a directory containing `case.yaml`). */
export function discoverCases(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    if (existsSync(join(dir, "case.yaml"))) {
      out.push(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(root);
  return out.sort();
}

interface Execution {
  manifest: CaseManifest;
  repo: TempRepo;
  code: number;
  stdout: string;
  stderr: string;
  baseline: string | null;
  shas: Record<string, string>;
  setupFailure?: string;
}

/** Materialize the fixture and run its command. The caller cleans up the repo. */
function executeCase(caseDir: string): Execution {
  const manifest = readManifest(caseDir);
  const repo = makeTempRepo();
  const shas = materialize(repo, caseDir, manifest);
  const baseline = headSha(repo);
  const blank = { manifest, repo, code: -1, stdout: "", stderr: "", baseline, shas };

  for (const step of manifest.run?.before ?? []) {
    const failure = runSetupStep(repo, step);
    if (failure) return { ...blank, setupFailure: failure };
  }
  if (manifest.run?.checkout) {
    const result = repo.git(["checkout", "--quiet", manifest.run.checkout]);
    if (result.code !== 0) {
      return {
        ...blank,
        setupFailure: `could not check out ${manifest.run.checkout}: ${result.stderr}`,
      };
    }
  }

  const env = { ...(manifest.run?.env ?? {}) };
  const result = manifest.run?.git
    ? repo.git(manifest.run.git, env)
    : repo.nav(manifest.run?.command ?? [], env);
  shas.head = headSha(repo) ?? "";
  return { manifest, repo, baseline, shas, ...result };
}

/** Run one fixture and report every difference from what it expects. */
export function runCase(caseDir: string): CaseResult {
  const execution = executeCase(caseDir);
  const { manifest, repo, code, stdout, stderr } = execution;
  try {
    if (execution.setupFailure) return { failures: [execution.setupFailure], code, stdout, stderr };
    const substitute = makeSubstituter(execution.shas);
    const failures = [
      ...checkExit(manifest, code),
      ...checkStream("stdout", manifest.expect?.stdout, stdout, caseDir, substitute),
      ...checkStream("stderr", manifest.expect?.stderr, stderr, caseDir, substitute),
      ...checkStderrContains(manifest, stderr),
      ...checkDiagnostics(manifest, stdout),
      ...checkTree(manifest, caseDir, repo, substitute),
      ...checkCommits(manifest, repo, execution.baseline, substitute),
    ];
    return { failures, stdout, stderr, code };
  } finally {
    repo.cleanup();
  }
}

/**
 * Regenerate a fixture's expected files from what the implementation currently
 * does. A maintenance tool, never used by the suite: the recorded output must
 * still be read and checked against the specification before it is committed.
 */
export function recordCase(caseDir: string): { code: number; wrote: string[] } {
  const execution = executeCase(caseDir);
  const { manifest, repo, code, stdout, stderr } = execution;
  try {
    if (execution.setupFailure) throw new Error(execution.setupFailure);
    const toPlaceholder = makeUnsubstituter(execution.shas);
    const wrote: string[] = [];

    for (const [name, text] of [
      ["stdout", stdout],
      ["stderr", stderr],
    ] as const) {
      const target = manifest.expect?.[name];
      if (!target) continue;
      const path = join(caseDir, target);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, toPlaceholder(text), "utf8");
      wrote.push(target);
    }
    if (manifest.expect?.tree) {
      const root = join(caseDir, manifest.expect.tree);
      rmSync(root, { recursive: true, force: true });
      for (const [path, content] of prefixKeys(readTree(join(repo.dir, ".navbook")), ".navbook/")) {
        const target = join(root, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, toPlaceholder(content), "utf8");
        wrote.push(`${manifest.expect.tree}/${path}`);
      }
    }
    return { code, wrote };
  } finally {
    repo.cleanup();
  }
}

function runSetupStep(repo: TempRepo, step: SetupStep): string | null {
  if ("write" in step) {
    repo.write(step.write.path, step.write.content ?? "");
    return null;
  }
  const [label, args] = "nav" in step ? (["nav", step.nav] as const) : (["git", step.git] as const);
  const result = label === "nav" ? repo.nav(args) : repo.git(args);
  return result.code === 0 ? null : `setup '${label} ${args.join(" ")}' failed: ${result.stderr}`;
}

/* --------------------------------------------------------- materialization */

function materialize(
  repo: TempRepo,
  caseDir: string,
  manifest: CaseManifest,
): Record<string, string> {
  const shas: Record<string, string> = {};

  if (manifest.init?.from) {
    copyInto(join(caseDir, manifest.init.from), repo.dir);
    repo.commitAll(
      manifest.init.message ?? "fixture: initial state",
      manifest.init.date ?? FIXTURE_DATE,
    );
    shas.init = headSha(repo) ?? "";
  }

  for (const [index, step] of (manifest.history ?? []).entries()) {
    applyStep(repo, caseDir, step, index, shas);
  }
  return shas;
}

function applyStep(
  repo: TempRepo,
  caseDir: string,
  step: HistoryStep,
  index: number,
  shas: Record<string, string>,
): void {
  const branch = step.branch ?? "main";
  const start = step.from ? shas[step.from] : undefined;
  if (step.from && !start)
    throw new Error(`history step ${index} refers to unknown step '${step.from}'`);

  const exists = repo.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0;
  if (exists) {
    repo.git(["checkout", "--quiet", branch]);
  } else if (start) {
    repo.git(["checkout", "--quiet", "-b", branch, start]);
  } else if (headSha(repo)) {
    repo.git(["checkout", "--quiet", "-b", branch]);
  } else {
    repo.git(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  }

  for (const path of step.rm ?? []) {
    rmSync(join(repo.dir, ...path.split("/")), { recursive: true, force: true });
  }
  if (step.apply) copyInto(join(caseDir, step.apply), repo.dir);

  repo.commitAll(step.message ?? `fixture: step ${index}`, step.date ?? FIXTURE_DATE);
  if (step.id) shas[step.id] = headSha(repo) ?? "";
}

function copyInto(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`fixture directory not found: ${from}`);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function headSha(repo: TempRepo): string | null {
  const result = repo.git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/* ------------------------------------------------------------- comparisons */

type Substituter = (text: string) => string;

/**
 * Expected files reference commit SHAs by the history step that produced them
 * (`{{sha:feat}}`, `{{head}}`), so a fixture stays hand-editable: changing an
 * overlay does not invalidate every literal SHA downstream of it.
 */
function makeSubstituter(shas: Record<string, string>): Substituter {
  return (text) =>
    text.replace(/\{\{(sha:([a-z0-9_-]+)|head)\}\}/gi, (match, _all, name?: string) => {
      const key = name ?? "head";
      const sha = shas[key];
      if (!sha) throw new Error(`fixture expects ${match} but no such commit was recorded`);
      return sha;
    });
}

/** The inverse of {@link makeSubstituter}, used when recording a fixture. */
function makeUnsubstituter(shas: Record<string, string>): Substituter {
  const entries = Object.entries(shas)
    .filter(([, sha]) => sha !== "")
    .sort(([a], [b]) => (a === "head" ? 1 : b === "head" ? -1 : 0));
  return (text) => {
    let out = text;
    for (const [name, sha] of entries) {
      out = out.split(sha).join(name === "head" ? "{{head}}" : `{{sha:${name}}}`);
    }
    return out;
  };
}

function checkExit(manifest: CaseManifest, code: number): string[] {
  const expected = manifest.expect?.exit ?? 0;
  return code === expected ? [] : [`exit code: expected ${expected}, got ${code}`];
}

function checkStream(
  name: string,
  expectedPath: string | undefined,
  actual: string,
  caseDir: string,
  substitute: Substituter,
): string[] {
  if (expectedPath === undefined) return [];
  const expected =
    expectedPath === "" ? "" : substitute(readFileSync(join(caseDir, expectedPath), "utf8"));
  if (expected === actual) return [];
  return [`${name} differs:\n--- expected ---\n${expected}--- actual ---\n${actual}--- end ---`];
}

function checkStderrContains(manifest: CaseManifest, stderr: string): string[] {
  const wanted = manifest.expect?.["stderr-contains"] ?? [];
  return wanted
    .filter((needle) => !stderr.includes(needle))
    .map((needle) => `stderr should contain ${JSON.stringify(needle)} but was:\n${stderr}`);
}

/**
 * Compare `nav doctor --json` output by check code, level and path. Diagnostic
 * wording is implementation-defined and is deliberately never compared.
 */
function checkDiagnostics(manifest: CaseManifest, stdout: string): string[] {
  const expected = manifest.expect?.diagnostics;
  if (expected === undefined) return [];

  let actual: { check: string; level: string; path: string }[];
  try {
    actual = stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const parsed = JSON.parse(line) as { check: string; level: string; path: string };
        return { check: parsed.check, level: parsed.level, path: parsed.path };
      });
  } catch (error) {
    return [
      `stdout is not newline-delimited JSON: ${error instanceof Error ? error.message : error}`,
    ];
  }

  const key = (d: { check: string; level: string; path: string }): string =>
    `${d.check} ${d.level} ${d.path}`;
  const want = expected.map(key).sort();
  const got = actual.map(key).sort();
  if (want.join("\n") === got.join("\n")) return [];
  return [
    `diagnostics differ:\n--- expected ---\n${want.join("\n")}\n--- actual ---\n${got.join("\n")}`,
  ];
}

function checkTree(
  manifest: CaseManifest,
  caseDir: string,
  repo: TempRepo,
  substitute: Substituter,
): string[] {
  if (!manifest.expect?.tree) return [];
  const expected = readTree(join(caseDir, manifest.expect.tree));
  const actual = prefixKeys(readTree(join(repo.dir, ".navbook")), ".navbook/");

  const failures: string[] = [];
  for (const [path, content] of expected) {
    if (!actual.has(path)) {
      failures.push(`missing file: ${path}`);
      continue;
    }
    const want = substitute(content);
    const got = actual.get(path) as string;
    if (want !== got) {
      failures.push(`${path} differs:\n--- expected ---\n${want}--- actual ---\n${got}--- end ---`);
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) failures.push(`unexpected file: ${path}`);
  }
  return failures;
}

/** Every file under `root`, keyed by its POSIX-style relative path. */
function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(root) || !statSync(root).isDirectory()) return files;
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true, encoding: "utf8" })) {
      if (entry.name === ".git") continue;
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        files.set(relative(root, child).split(sep).join("/"), readFileSync(child, "utf8"));
      }
    }
  };
  walk(root);
  return files;
}

function prefixKeys(files: Map<string, string>, prefix: string): Map<string, string> {
  return new Map([...files].map(([path, content]) => [`${prefix}${path}`, content]));
}

function checkCommits(
  manifest: CaseManifest,
  repo: TempRepo,
  baseline: string | null,
  substitute: Substituter,
): string[] {
  const expected = manifest.expect?.commits;
  if (expected === undefined) return [];
  const range = baseline ? `${baseline}..HEAD` : "HEAD";
  const result = repo.git(["log", "--format=%B%x00", range]);
  const actual =
    result.code === 0
      ? result.stdout
          .split("\0")
          .filter((m) => m.trim() !== "")
          .map((m) => m.replace(/^\n+/, ""))
      : [];
  const want = expected.map(substitute);
  if (actual.length !== want.length) {
    return [
      `expected ${want.length} new commit(s), got ${actual.length}:\n${actual.join("---\n")}`,
    ];
  }
  const failures: string[] = [];
  actual.forEach((message, index) => {
    const expectedMessage = want[index] as string;
    if (message.trimEnd() !== expectedMessage.trimEnd()) {
      failures.push(
        `commit ${index}: expected ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(message)}`,
      );
    }
  });
  return failures;
}
