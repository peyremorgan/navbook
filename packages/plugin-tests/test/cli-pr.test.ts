/**
 * Runs attached to a pull request, at the terminal: written on its branch,
 * carried by its directory, read wherever the pull request is — and the
 * plugin loaded only by the commands that need it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { TempRepo } from "@navbook/cli/test-helpers";
import { makeTestsRepo, openLoginPlan, PLUGIN, read, runFiles } from "./helpers.ts";

/** A repository with the plan on main, and a pull request on `feat/login`, checked out. */
function withPr(): { repo: TempRepo; pr: string; dir: string; head: string } {
  const repo = makeTestsRepo();
  openLoginPlan(repo);
  repo.git(["checkout", "--quiet", "-b", "feat/login"]);
  writeFileSync(join(repo.dir, "app.txt"), "the fix\n");
  repo.commitAll("fix: the login");
  const opened = repo.nav([
    "pr",
    "open",
    "--title",
    "Fix the login",
    "--target",
    "main",
    "-m",
    "Fixes it.",
    "--commit",
  ]);
  assert.equal(opened.code, 0, opened.stderr);
  const pr = opened.stdout.match(/\(#([a-z0-9]{8})\)/)?.[1] as string;
  const dir = opened.stdout.match(/Created (\.navbook\/prs\/open\/[^/]+)\//)?.[1] as string;
  const head = repo.git(["rev-parse", "HEAD~1"]).stdout.trim();
  return { repo, pr, dir, head };
}

describe("a run attached to a pull request", () => {
  let fixture: ReturnType<typeof withPr>;
  let id: string;
  before(() => {
    fixture = withPr();
  });
  after(() => fixture.repo.cleanup());

  it("is written in the pull request's directory, against its latest revision", () => {
    const { repo, pr, dir, head } = fixture;
    const result = repo.nav(
      ["test", "run", "login", "--pr", pr.slice(0, 4), "--interactive", "--commit"],
      {},
      "p\np\np\n\n",
    );
    assert.equal(result.code, 0, result.stderr);
    id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
    const files = runFiles(repo, `${dir}/tests`);
    assert.equal(files.length, 1);
    const text = read(repo, `${dir}/tests/${files[0]}`);
    assert.match(text, new RegExp(`^commit: ${head}$`, "m"));
    const message = repo.git(["log", "-1", "--format=%B"]).stdout.trim();
    assert.equal(message, `docs(tests): run login ${id} on #${pr}\n\nRefs: ${pr}`);
    assert.deepEqual(runFiles(repo), []);
  });

  it("shows on the pull request, with its tested state", () => {
    const { repo, pr } = fixture;
    const shown = repo.nav(["pr", "show", pr]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /^test runs \(1\), tested: passed$/m);
    assert.match(shown.stdout, new RegExp(`^ {2}${id} {2}passed +login `, "m"));
    const json = JSON.parse(repo.nav(["pr", "show", pr, "--json"]).stdout);
    assert.equal(json.tests.tested, "passed");
    assert.equal(json.tests.runs[0].id, id);
    assert.equal(json.tests.runs[0].pr, pr);
  });

  it("answers the tested: term on the pull request listing", () => {
    const { repo, pr } = fixture;
    assert.match(repo.nav(["pr", "list", "tested:passed"]).stdout, new RegExp(`#${pr}`));
    assert.doesNotMatch(repo.nav(["pr", "list", "tested:none"]).stdout, new RegExp(`#${pr}`));
    assert.match(
      repo.nav(["pr", "list", "tested:failed", "tested:passed"]).stdout,
      new RegExp(`#${pr}`),
    );
    const bad = repo.nav(["pr", "list", "tested:green"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /'tested:green' is not a tested state/);
    const help = repo.nav(["pr", "list", "--help"]);
    assert.match(help.stdout, /tested:STATE +the latest run on the latest revision/);
    const completed = repo.nav(["__complete", "pr", "list", ""]).stdout.split("\n");
    assert.ok(completed.includes("tested:in-progress"), completed.join(" "));
  });

  it("returns to none when the pull request gains a revision", () => {
    const { repo, pr } = fixture;
    writeFileSync(join(repo.dir, "app.txt"), "the fix, reworked\n");
    repo.commitAll("fix: rework");
    assert.equal(repo.nav(["pr", "update", pr, "--commit"]).code, 0);
    assert.match(repo.nav(["pr", "list", "tested:none"]).stdout, new RegExp(`#${pr}`));
    assert.match(repo.nav(["pr", "show", pr]).stdout, /tested: none\n.*\(an earlier revision\)/);
    const doctor = repo.nav(["doctor"]);
    assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
  });

  it("is read from the branch that carries it, and refused as a place to write from elsewhere", () => {
    const { repo, pr } = fixture;
    repo.git(["checkout", "--quiet", "main"]);
    try {
      const written = repo.nav(["test", "run", "login", "--pr", pr, "--no-interactive"]);
      assert.equal(written.code, 1);
      assert.match(written.stderr, /is on 'feat\/login', which is not checked out here/);
      assert.match(
        repo.nav(["pr", "list", "--all-refs", "tested:none"]).stdout,
        new RegExp(`#${pr}`),
      );
      assert.match(repo.nav(["pr", "show", pr]).stdout, /^test runs \(1\), tested: none$/m);
      const shown = repo.nav(["test", "show", id]);
      assert.equal(shown.code, 0, shown.stderr);
      assert.match(shown.stderr, new RegExp(`#${pr} is not in this tree; read from feat/login`));
      assert.match(shown.stdout, /^ {2}3\. Log out {2}passed$/m);
      assert.equal(repo.nav(["test", "runs"]).stdout, "No test runs match.\n");
      assert.match(
        repo.nav(["test", "runs", "--all-refs", `pr:${pr}`]).stdout,
        new RegExp(`^${id} `, "m"),
      );
    } finally {
      repo.git(["checkout", "--quiet", "feat/login"]);
    }
  });

  it("travels with the pull request when it merges", () => {
    const { repo, pr } = fixture;
    repo.git(["checkout", "--quiet", "main"]);
    const merged = repo.nav(["pr", "merge", pr, "--yes"]);
    assert.equal(merged.code, 0, merged.stderr);
    const runs = repo.nav(["test", "runs", `pr:${pr}`]);
    assert.match(runs.stdout, new RegExp(`^${id} `, "m"));
    assert.match(repo.nav(["test", "show", id, "--json"]).stdout, /prs\/merged\//);
  });
});

describe("a run written without its step count", () => {
  it("concludes from its plan on its own, and from its own file for the tested state", () => {
    const { repo, pr, dir } = withPr();
    try {
      const result = repo.nav(
        ["test", "run", "login", "--pr", pr, "--interactive"],
        {},
        "p\np\np\n\n",
      );
      assert.equal(result.code, 0, result.stderr);
      const id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
      const file = join(repo.dir, dir, "tests", runFiles(repo, `${dir}/tests`)[0] as string);
      writeFileSync(file, readFileSync(file, "utf8").replace(/^steps: .*\n/m, ""));

      const shown = repo.nav(["pr", "show", pr]);
      assert.equal(shown.code, 0, shown.stderr);
      // §6: the tested state reads the pull request's files alone.
      assert.match(shown.stdout, /^test runs \(1\), tested: incomplete$/m);
      assert.match(shown.stdout, new RegExp(`^ {2}${id} {2}passed +login `, "m"));
      const json = JSON.parse(repo.nav(["pr", "show", pr, "--json"]).stdout);
      assert.equal(json.tests.tested, "incomplete");
      assert.equal(json.tests.runs[0].outcome, "passed");
      assert.match(
        repo.nav(["test", "show", id]).stdout,
        new RegExp(`^${id} {2}login {2}passed$`, "m"),
      );
    } finally {
      repo.cleanup();
    }
  });
});

describe("the plugin, when it is not needed", () => {
  let repo: TempRepo;
  const log = (): string[] => {
    const path = join(repo.home, "trace.log");
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
    rmSync(path, { force: true });
    return lines;
  };
  const traced = (...args: string[]) =>
    repo.nav(args, {
      NODE_OPTIONS: `--import=${join(PLUGIN, "test", "trace-imports.mjs")}`,
      TRACE_LOG: join(repo.home, "trace.log"),
    });
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
    log();
  });
  after(() => repo.cleanup());

  it("is not imported to list pull requests or issues, or to print help", () => {
    for (const args of [["pr", "list"], ["issue", "list"], ["--help"], ["pr", "list", "--help"]]) {
      assert.equal(traced(...args).code, 0);
      assert.deepEqual(log(), [], args.join(" "));
    }
  });

  it("is imported by its own commands, its query term, and doctor", () => {
    traced("test", "list");
    assert.ok(log().some((line) => line.startsWith("src/cli/")));
    traced("pr", "list", "tested:none");
    const term = log();
    assert.ok(term.some((line) => line.startsWith("src/core/")));
    assert.ok(!term.some((line) => line.startsWith("src/cli/")), term.join(" "));
    traced("doctor");
    assert.ok(log().some((line) => line.startsWith("src/core/")));
  });

  it("leaves a tree it cannot read alone, and says whose it is", () => {
    const bare = repo.nav(["doctor"], { NAVBOOK_PLUGIN_PATH: "" });
    assert.equal(bare.code, 0, bare.stdout + bare.stderr);
    assert.match(bare.stderr, /@navbook\/plugin-tests/);
  });
});
