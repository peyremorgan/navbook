/**
 * What the CLI suites share: a repository with this plugin on the path, and
 * the plan every suite runs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeNavRepo, type TempRepo } from "@navbook/cli/test-helpers";

/** This package, as `NAVBOOK_PLUGIN_PATH` names it. */
export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A repository with this plugin installed and declared, its path folded into
 * `nav` itself: every command in these suites needs it.
 */
export function makeTestsRepo(): TempRepo {
  const repo = makeNavRepo();
  const plain = repo.nav.bind(repo);
  repo.nav = (args, env, input) => plain(args, { NAVBOOK_PLUGIN_PATH: PLUGIN, ...env }, input);
  repo.write(
    ".navbook/navbook.json",
    `${JSON.stringify({ version: 1, plugins: { "@navbook/plugin-tests": {} } }, null, 2)}\n`,
  );
  repo.commitAll("docs: declare plugin-tests");
  return repo;
}

/** The body of the plan the suites run: three steps, the last a setup step. */
export const PLAN_BODY = [
  "Needs a staging account.",
  "",
  "### Open the login page",
  "",
  "#### Actions",
  "",
  "Browse to `/login`.",
  "",
  "#### Expected",
  "",
  "The form shows.",
  "",
  "### Sign in",
  "",
  "#### Actions",
  "",
  "Enter the credentials.",
  "",
  "#### Expected",
  "",
  "The dashboard opens.",
  "",
  "### Log out",
  "",
  "#### Actions",
  "",
  "Press **Log out**.",
].join("\n");

/** Create the `login` plan and commit it; fail loudly when that does not work. */
export function openLoginPlan(repo: TempRepo): void {
  const opened = repo.nav([
    "test",
    "open",
    "Login flow",
    "--slug",
    "login",
    "-m",
    PLAN_BODY,
    "--commit",
  ]);
  if (opened.code !== 0) throw new Error(`nav test open failed: ${opened.stderr}`);
}

/** A file in the repository, by its path from the root. */
export function read(repo: TempRepo, path: string): string {
  return readFileSync(join(repo.dir, ...path.split("/")), "utf8");
}

/** The runs directory's run files, oldest first. */
export function runFiles(repo: TempRepo, dir = ".navbook/tests/login/runs"): string[] {
  try {
    return readdirSync(join(repo.dir, ...dir.split("/")))
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/** The ID in a run's file name. */
export function idOf(fileName: string): string {
  return fileName.replace(/\.md$/, "").slice(-8);
}

/** How many commits the current branch has. */
export function commitCount(repo: TempRepo): number {
  return Number(repo.git(["rev-list", "--count", "HEAD"]).stdout.trim());
}
