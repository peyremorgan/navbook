/**
 * `nav test run|resume|record|finish|runs|show|attach` — running a plan at
 * the terminal, standalone.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { TempRepo } from "@navbook/cli/test-helpers";
import { commitCount, idOf, makeTestsRepo, openLoginPlan, read, runFiles } from "./helpers.ts";

const RUNS = ".navbook/tests/login/runs";

/** Start a run without walking it, and return its ID. */
function started(repo: TempRepo, ...extra: string[]): string {
  const result = repo.nav(["test", "run", "login", "--no-interactive", ...extra]);
  assert.equal(result.code, 0, result.stderr);
  const match = result.stdout.match(/^Started run ([a-z0-9]{8}) /);
  assert.ok(match, result.stdout);
  return match[1] as string;
}

const runText = (repo: TempRepo, id: string): string => {
  const name = runFiles(repo).find((file) => idOf(file) === id);
  assert.ok(name, `no run file for ${id}`);
  return read(repo, `${RUNS}/${name}`);
};

describe("starting a run", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
  });
  after(() => repo.cleanup());

  it("without a terminal, starts it and says how to record it", () => {
    const head = repo.git(["rev-parse", "HEAD"]).stdout.trim();
    const result = repo.nav(["test", "run", "login", "--env", "staging"]);
    assert.equal(result.code, 0, result.stderr);
    const id = result.stdout.match(
      /^Started run ([a-z0-9]{8}) of 'login' {2}\.navbook\/tests\/login\/runs\//,
    )?.[1];
    assert.ok(id, result.stdout);
    assert.match(result.stdout, new RegExp(`nav test record ${id} <step> <status>`));
    const text = runText(repo, id);
    const planSha = repo.git(["hash-object", ".navbook/tests/login/plan.md"]).stdout.trim();
    assert.match(text, /^plan: login$/m);
    assert.match(text, new RegExp(`^plan-sha: ${planSha}$`, "m"));
    assert.match(text, /^steps: 3$/m);
    assert.match(text, new RegExp(`^commit: ${head}$`, "m"));
    assert.match(text, /^environment: staging$/m);
    assert.doesNotMatch(text, /^finished:/m);
    // Left staged for the author's own commit.
    assert.match(repo.git(["diff", "--cached", "--name-only"]).stdout, /tests\/login\/runs\//);
    repo.git(["reset", "--quiet"]);
  });

  it("with --version and no --at, records the version and no commit", () => {
    const id = started(repo, "--version", "1.10");
    const text = runText(repo, id);
    assert.match(text, /^version: "1\.10"$/m);
    assert.doesNotMatch(text, /^commit:/m);
    const both = started(repo, "--version", "2.0", "--at", "HEAD");
    assert.match(runText(repo, both), /^commit: [0-9a-f]{40}$/m);
    repo.git(["reset", "--quiet"]);
  });

  it("with --commit, commits the new run on its own", () => {
    const before_ = commitCount(repo);
    const result = repo.nav(["test", "run", "login", "--no-interactive", "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    const id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1];
    assert.match(result.stdout, new RegExp(`Committed docs\\(tests\\): run login ${id}\n$`));
    assert.equal(commitCount(repo), before_ + 1);
  });

  it("refuses what cannot be tested: an unknown plan, a revision that is not one", () => {
    const unknown = repo.nav(["test", "run", "nope", "--no-interactive"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /no test plan named 'nope' in tests\//);
    const at = repo.nav(["test", "run", "login", "--no-interactive", "--at", "no-such-rev"]);
    assert.equal(at.code, 1);
    assert.match(at.stderr, /'no-such-rev' names no commit in this repository/);
  });
});

describe("walking a run", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
  });
  after(() => repo.cleanup());

  it("asks about every step in turn, and commits the whole session once", () => {
    const before_ = commitCount(repo);
    const result = repo.nav(
      ["test", "run", "login", "--interactive", "--commit"],
      {},
      "p\nmaybe\nF\nA spinner, then a blank page.\ns\n\n\n",
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /Step 1 of 3: Open the login page\n {2}Actions:\n {4}Browse to `\/login`\.\n {2}Expected:\n {4}The form shows\./,
    );
    assert.match(result.stdout, /Answer p, f, b, s or q\./);
    assert.match(
      result.stdout,
      /Step 3 of 3: Log out\n.*\n.*\n {2}\(a setup step: nothing to check\)/,
    );
    assert.match(result.stdout, /3 of 3 steps recorded: failed/);
    const id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
    assert.match(result.stdout, new RegExp(`Committed docs\\(tests\\): run login ${id}\n$`));
    assert.equal(commitCount(repo), before_ + 1);
    const text = runText(repo, id);
    assert.match(text, /^finished: /m);
    assert.match(
      text,
      /### 1\. Open the login page\n\n#### Status\n\npassed\n\n### 2\. Sign in\n\n#### Status\n\nfailed\n\n#### Actual\n\nA spinner, then a blank page\.\n\n### 3\. Log out\n\n#### Status\n\nskipped\n$/,
    );
  });

  it("leaves the run in progress when the tester quits, and resumes where they stopped", () => {
    const first = repo.nav(["test", "run", "login", "--interactive"], {}, "p\nq\n");
    assert.equal(first.code, 0, first.stderr);
    const id = first.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
    assert.match(first.stdout, /1 of 3 steps recorded: in-progress/);
    assert.match(first.stdout, new RegExp(`carry on with 'nav test resume ${id}'`));
    assert.doesNotMatch(runText(repo, id), /^finished:/m);

    const second = repo.nav(["test", "resume", id.slice(0, 5)], {}, "b\n\n");
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /login: 3 steps, 2 to go/);
    assert.match(second.stdout, /Step 2 of 3: Sign in/);
    assert.doesNotMatch(second.stdout, /Step 1 of 3/);
    // The answers ran out at step 3: what was given is kept.
    assert.match(second.stdout, /2 of 3 steps recorded: blocked/);
    assert.match(runText(repo, id), /### 2\. Sign in\n\n#### Status\n\nblocked\n/);

    const third = repo.nav(["test", "resume", id], {}, "p\ny\n");
    assert.match(third.stdout, /3 of 3 steps recorded: blocked/);
    assert.match(runText(repo, id), /^finished: /m);
    const again = repo.nav(["test", "resume", id]);
    assert.equal(again.code, 1);
    assert.match(
      again.stderr,
      new RegExp(`test run ${id} is finished; nothing more can be recorded`),
    );
  });

  it("takes an actual result from the editor, and leaves a run open when asked", () => {
    const editor = repo.script("actual.sh", `printf 'Seen in the editor.\\n' > "$1"`);
    const result = repo.nav(
      ["test", "run", "login", "--interactive"],
      { EDITOR: editor },
      "p\nf\ne\np\nn\n",
    );
    assert.equal(result.code, 0, result.stderr);
    const id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
    const text = runText(repo, id);
    assert.match(text, /#### Actual\n\nSeen in the editor\.\n/);
    assert.doesNotMatch(text, /^finished:/m);
    assert.match(result.stdout, /Left in progress/);
  });

  it("asks again for an actual result that reads as a heading, and still commits the session", () => {
    repo.commitAll("chore: the runs so far");
    const result = repo.nav(
      ["test", "run", "login", "--interactive", "--commit"],
      {},
      "p\nf\n# of retries exceeded\nRetries ran out.\ns\n\n",
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stdout,
      /nav: the actual result of step 2 contains a heading.*\nWhat happened\?/,
    );
    const id = result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string;
    assert.match(result.stdout, new RegExp(`Committed docs\\(tests\\): run login ${id}\n$`));
    assert.match(runText(repo, id), /#### Actual\n\nRetries ran out\.\n/);
  });

  // Last here: it leaves the plan with a fourth step.
  it("walks only the steps the run followed, and says when it reads them from today's plan", () => {
    const id = started(repo, "--commit");
    const name = runFiles(repo).find((file) => idOf(file) === id) as string;
    const path = join(repo.dir, RUNS, name);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(/^plan-sha: .*$/m, `plan-sha: ${"e".repeat(40)}`),
    );
    const grow = repo.script(
      "grow.sh",
      `printf '\\n### Four\\n\\n#### Actions\\n\\nDo four.\\n' >> "$1"`,
    );
    assert.equal(repo.nav(["test", "edit", "login"], { EDITOR: grow }).code, 0);

    const result = repo.nav(["test", "resume", id], {}, "p\np\np\ny\n");
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stderr,
      /the plan this run followed \(eeeeeeeeeeee\) is not in this repository/,
    );
    assert.match(result.stdout, /login: 3 steps, 3 to go/);
    assert.doesNotMatch(result.stdout, /Step 4/);
    assert.match(result.stdout, /3 of 3 steps recorded: passed/);
    assert.match(runText(repo, id), /^finished: /m);
  });
});

describe("recording and finishing", () => {
  let repo: TempRepo;
  let id: string;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
    id = started(repo, "--commit");
  });
  after(() => repo.cleanup());

  it("records one step, with what was observed", () => {
    const result = repo.nav([
      "test",
      "record",
      id,
      "2",
      "Failed",
      "-m",
      "Nothing happened.",
      "--commit",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `Recorded step 2 of run ${id}: failed\nCommitted docs(tests): record login ${id}\n`,
    );
    assert.match(
      runText(repo, id),
      /### 2\. Sign in\n\n#### Status\n\nfailed\n\n#### Actual\n\nNothing happened\.\n/,
    );
    // Recording a step again replaces what it said.
    repo.nav(["test", "record", id, "2", "passed"]);
    assert.doesNotMatch(runText(repo, id), /Nothing happened/);
  });

  it("refuses a step the plan does not have, a status that is not one, and a heading in the text", () => {
    const beyond = repo.nav(["test", "record", id, "4", "passed"]);
    assert.equal(beyond.code, 1);
    assert.match(beyond.stderr, /step 4 is not a step of this plan, which has 3/);
    const word = repo.nav(["test", "record", id, "1", "ok"]);
    assert.equal(word.code, 1);
    assert.match(
      word.stderr,
      /'ok' is not a status; expected one of passed, failed, blocked, skipped/,
    );
    const number = repo.nav(["test", "record", id, "one", "passed"]);
    assert.equal(number.code, 1);
    assert.match(number.stderr, /'one' is not a step number/);
    const heading = repo.nav(["test", "record", id, "1", "failed", "-m", "### Oops"]);
    assert.equal(heading.code, 1);
    assert.match(heading.stderr, /the actual result of step 1 contains a heading/);
  });

  it("finishes a run once, and reads its outcome", () => {
    const result = repo.nav(["test", "finish", id, "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `Finished run ${id}: incomplete\nCommitted docs(tests): finish login ${id}\n`,
    );
    const again = repo.nav(["test", "finish", id]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /is finished; nothing more can be recorded/);
    const record = repo.nav(["test", "record", id, "1", "passed"]);
    assert.equal(record.code, 1);
  });

  it("says a run ID matches nothing, or is too short", () => {
    const missing = repo.nav(["test", "record", "zzzz9999", "1", "passed"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no test run matches 'zzzz9999'/);
    const short = repo.nav(["test", "finish", "ab"]);
    assert.equal(short.code, 1);
    assert.match(short.stderr, /too short/);
  });
});

describe("listing and showing runs", () => {
  let repo: TempRepo;
  const ids: string[] = [];
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
    for (const answers of ["p\np\np\n\n", "p\nf\nBroken.\nq\n"]) {
      const result = repo.nav(["test", "run", "login", "--interactive", "--commit"], {}, answers);
      ids.push(result.stdout.match(/^Started run ([a-z0-9]{8})/)?.[1] as string);
    }
  });
  after(() => repo.cleanup());

  it("lists runs newest first, filtered by plan and outcome", () => {
    const listed = repo.nav(["test", "runs"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /^ID +PLAN +OUTCOME +STARTED +TESTER +PR +TESTED$/m);
    const rows = listed.stdout.trim().split("\n").slice(1);
    // Both started in the same second: the ID orders them, as it orders comments.
    assert.deepEqual(
      rows.map((row) => row.split(/ +/)[0]),
      [...ids].sort().reverse(),
    );
    assert.match(
      listed.stdout,
      new RegExp(
        `^${ids[0]} +login +passed +2026-08-01T10:00:00Z +Nav Test +- +@[0-9a-f]{12}$`,
        "m",
      ),
    );
    assert.match(
      repo.nav(["test", "runs", "outcome:failed"]).stdout,
      new RegExp(`^${ids[1]} `, "m"),
    );
    assert.doesNotMatch(
      repo.nav(["test", "runs", "outcome:failed"]).stdout,
      new RegExp(`^${ids[0]} `, "m"),
    );
    assert.equal(repo.nav(["test", "runs", "plan:other"]).stdout, "No test runs match.\n");
    assert.equal(
      repo
        .nav(["test", "runs", "login", "outcome:passed", "outcome:failed"])
        .stdout.trim()
        .split("\n").length,
      3,
    );
    const bad = repo.nav(["test", "runs", "status:open"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /unknown query term 'status:open'/);
    const outcome = repo.nav(["test", "runs", "outcome:green"]);
    assert.match(outcome.stderr, /unknown outcome 'green'/);
    const json = repo
      .nav(["test", "runs", "--json"])
      .stdout.trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(json.map((run) => run.outcome).sort(), ["failed", "passed"]);
    assert.equal(json[0].plan, "login");
    assert.equal(json[0].pr, null);
  });

  it("shows a run beside every step of its plan, recorded or not", () => {
    const shown = repo.nav(["test", "show", ids[1] as string]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, new RegExp(`^${ids[1]} {2}login {2}failed$`, "m"));
    assert.match(shown.stdout, /^steps \(2 of 3 recorded\):$/m);
    assert.match(
      shown.stdout,
      /^ {2}2\. Sign in {2}failed\n {5}expected:\n {7}The dashboard opens\.\n {5}actual:\n {7}Broken\.$/m,
    );
    assert.match(shown.stdout, /^ {2}3\. Log out {2}not run$/m);
    const json = JSON.parse(repo.nav(["test", "show", ids[1] as string, "--json"]).stdout);
    assert.deepEqual(
      json.results.map((result: { status: string }) => result.status),
      ["passed", "failed", "not-run"],
    );
    assert.equal(json.outcome, "failed");
  });

  it("shows the steps a run followed after the plan changed, and says when it cannot", () => {
    const editor = repo.script("rename.sh", `sed -i 's/### Sign in/### Sign in with SSO/' "$1"`);
    assert.equal(repo.nav(["test", "edit", "login", "--commit"], { EDITOR: editor }).code, 0);
    const shown = repo.nav(["test", "show", ids[1] as string]);
    assert.match(shown.stdout, /^ {2}2\. Sign in {2}failed$/m);
    assert.equal(shown.stderr, "");
    // A plan-sha this clone does not hold: the plan as it is now, said so.
    const name = runFiles(repo).find((file) => idOf(file) === ids[1]) as string;
    const path = join(repo.dir, ".navbook/tests/login/runs", name);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(/^plan-sha: .*$/m, `plan-sha: ${"e".repeat(40)}`),
    );
    const fallback = repo.nav(["test", "show", ids[1] as string]);
    assert.match(fallback.stdout, /^ {2}2\. Sign in with SSO {2}failed$/m);
    assert.match(
      fallback.stderr,
      /the plan this run followed \(eeeeeeeeeeee\) is not in this repository/,
    );
    const doctor = repo.nav(["doctor"]);
    assert.match(
      doctor.stdout + doctor.stderr,
      /X-tests-2.*plan-sha eeeeeeeeeeee names no plan this repository holds/,
    );
  });
});

describe("attachments", () => {
  let repo: TempRepo;
  let id: string;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
    id = started(repo, "--commit");
  });
  after(() => repo.cleanup());

  it("are copied byte for byte beside the run, and linked from the step", () => {
    repo.nav(["test", "record", id, "2", "failed", "-m", "Blank."]);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255]);
    writeFileSync(join(repo.dir, "screen shot.png"), bytes);
    const result = repo.nav(["test", "attach", id, "screen shot.png", "--step", "2", "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    const dir = `${RUNS}/${(runFiles(repo).find((file) => idOf(file) === id) as string).replace(/\.md$/, "")}`;
    assert.match(
      result.stdout,
      new RegExp(`^Attached ${dir.replaceAll(".", "\\.")}/screen-shot\\.png$`, "m"),
    );
    assert.match(result.stdout, new RegExp(`Committed docs\\(tests\\): attach login ${id}`));
    assert.deepEqual([...readFileSync(join(repo.dir, dir, "screen-shot.png"))], [...bytes]);
    assert.match(runText(repo, id), /Blank\.\n\n!\[screen-shot\.png\]\([^)]+\/screen-shot\.png\)/);
    const shown = repo.nav(["test", "show", id]);
    assert.match(shown.stdout, /^attachments \(1\):\n {2}.*screen-shot\.png$/m);
  });

  it("refuse a file that cannot be read, a step not yet recorded, and a name in use", () => {
    const missing = repo.nav(["test", "attach", id, "nope.txt"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /cannot read nope\.txt/);
    writeFileSync(join(repo.dir, "log.txt"), "log\n");
    const unrecorded = repo.nav(["test", "attach", id, "log.txt", "--step", "3"]);
    assert.equal(unrecorded.code, 1);
    assert.match(unrecorded.stderr, /step 3 of test run .* is not recorded yet/);
    const zero = repo.nav(["test", "attach", id, "log.txt", "--step", "0"]);
    assert.equal(zero.code, 1);
    assert.match(zero.stderr, /--step takes the number of a recorded step, from 1/);
    const half = repo.nav(["test", "attach", id, "log.txt", "--step", "1.5"]);
    assert.equal(half.code, 1);
    assert.match(
      half.stderr,
      /'--step <n>' argument '1\.5' is invalid\. Expected a whole number\./,
    );
    const taken = repo.nav(["test", "attach", id, "screen shot.png"]);
    assert.equal(taken.code, 1);
    assert.match(taken.stderr, /already has an attachment named 'screen-shot\.png'/);
  });

  it("leave nothing for doctor to report", () => {
    const doctor = repo.nav(["doctor"]);
    assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);
  });
});
