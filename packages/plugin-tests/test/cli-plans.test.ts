/**
 * `nav test open|list|show|edit` — plans at the terminal.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { TempRepo } from "@navbook/cli/test-helpers";
import { makeTestsRepo, openLoginPlan, PLAN_BODY, read } from "./helpers.ts";

describe("nav test open", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTestsRepo();
  });
  after(() => repo.cleanup());

  it("creates a plan from -m, under a slug derived from its title", () => {
    const result = repo.nav(["test", "open", "Checkout flow", "-m", PLAN_BODY, "--commit"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      "Created .navbook/tests/checkout-flow/  (checkout-flow)\nCommitted docs(tests): create checkout-flow\n",
    );
    const text = read(repo, ".navbook/tests/checkout-flow/plan.md");
    assert.match(text, /^title: Checkout flow$/m);
    assert.match(text, /^author: Nav Test <nav@test\.invalid>$/m);
    assert.match(text, /### Sign in\n\n#### Actions/);
  });

  it("opens the editor on a skeleton that shows the grammar, and keeps what was saved", () => {
    const copy = repo.script("keep.sh", `cp "$1" "${repo.home}/buffer.md"`);
    const result = repo.nav(["test", "open", "Search"], { EDITOR: copy });
    assert.equal(result.code, 0, result.stderr);
    const buffer = read({ ...repo, dir: repo.home } as TempRepo, "buffer.md");
    assert.match(buffer, /^title: Search$/m);
    assert.match(buffer, /### The first step\n\n#### Actions/);
    assert.match(buffer, /#### Expected/);
    // Saved unchanged, the skeleton is itself a plan: one step, placeholders for text.
    const shown = repo.nav(["test", "show", "search", "--json"]);
    assert.equal(JSON.parse(shown.stdout).steps.length, 1);
  });

  it("refuses a plan whose body breaks the grammar, and writes nothing", () => {
    const result = repo.nav(["test", "open", "Broken", "-m", "### A step\n\n#### Doings\n\nx"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /the test plan is not valid and was not created/);
    assert.match(result.stderr, /step 1 'A step' has a '#### Doings' section/);
    assert.match(result.stderr, /step 1 'A step' has no '#### Actions' section/);
    assert.equal(repo.nav(["test", "show", "broken"]).code, 1);
  });

  it("refuses a slug in use, one shaped like an ID, and an empty title", () => {
    const again = repo.nav(["test", "open", "Checkout flow", "-m", PLAN_BODY]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /test plan 'checkout-flow' already exists/);
    const id = repo.nav(["test", "open", "Anything", "--slug", "abcd1234", "-m", PLAN_BODY]);
    assert.equal(id.code, 1);
    assert.match(id.stderr, /'abcd1234' is shaped like an ID, which a run is named by/);
    const empty = repo.nav(["test", "open", "  ", "-m", PLAN_BODY]);
    assert.equal(empty.code, 1);
    assert.match(empty.stderr, /a test plan needs a title/);
  });
});

describe("nav test list and show", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
  });
  after(() => repo.cleanup());

  it("says when there is nothing to list", () => {
    const empty = makeTestsRepo();
    try {
      assert.equal(empty.nav(["test", "list"]).stdout, "No test plans yet.\n");
      assert.equal(empty.nav(["test", "list", "--json"]).stdout, "");
    } finally {
      empty.cleanup();
    }
  });

  it("lists plans with their step count, runs and latest outcome, filtered by words", () => {
    repo.nav(["test", "open", "Checkout", "-m", PLAN_BODY]);
    const listed = repo.nav(["test", "list"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(listed.stdout, /^SLUG +TITLE +STEPS +RUNS +LATEST$/m);
    assert.match(listed.stdout, /^login +Login flow +3 +0 +-$/m);
    assert.match(listed.stdout, /^checkout +Checkout +3 +0 +-$/m);
    const filtered = repo.nav(["test", "list", "LOGIN"]);
    assert.doesNotMatch(filtered.stdout, /checkout/);
    assert.equal(repo.nav(["test", "list", "nothing-like-it"]).stdout, "No test plan matches.\n");
    const json = repo
      .nav(["test", "list", "--json"])
      .stdout.trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      json.map((plan) => [
        plan.slug,
        plan.path,
        plan.title,
        plan.steps.length,
        plan.runs,
        plan.latest,
      ]),
      [
        ["checkout", ".navbook/tests/checkout", "Checkout", 3, 0, null],
        ["login", ".navbook/tests/login", "Login flow", 3, 0, null],
      ],
    );
  });

  it("shows a plan: its description, its steps, and a setup step for what it is", () => {
    const shown = repo.nav(["test", "show", "login"]);
    assert.equal(shown.code, 0, shown.stderr);
    assert.match(shown.stdout, /^login$/m);
    assert.match(shown.stdout, /^title: +Login flow$/m);
    assert.match(shown.stdout, /^Needs a staging account\.$/m);
    assert.match(shown.stdout, /^ {2}2\. Sign in$/m);
    assert.match(shown.stdout, /^ {7}The dashboard opens\.$/m);
    assert.match(shown.stdout, /\(a setup step: nothing to check\)/);
    assert.match(shown.stdout, /^recent runs \(0 of 0\):\n {2}none$/m);
    assert.doesNotMatch(repo.nav(["test", "show", "login", "--runs", "0"]).stdout, /recent runs/);
    const json = JSON.parse(repo.nav(["test", "show", "login", "--json"]).stdout);
    assert.deepEqual(json.steps[2], {
      number: 3,
      title: "Log out",
      actions: "Press **Log out**.",
      expected: null,
    });
    assert.deepEqual(json.recent, []);
  });

  it("indents every line of a section, not only its first, and a run's actual the same", () => {
    const body =
      "### Many lines\n\n#### Actions\n\n```sh\n### not a step\n```\n\n#### Expected\n\nOne.\nTwo.";
    const opened = repo.nav(["test", "open", "Long", "-m", body]);
    assert.equal(opened.code, 0, opened.stderr);
    const shown = repo.nav(["test", "show", "long"]).stdout;
    assert.match(
      shown,
      /^ {5}actions:\n {7}```sh\n {7}### not a step\n {7}```\n {5}expected:\n {7}One\.\n {7}Two\.$/m,
    );
    const started = repo.nav(["test", "run", "long", "--version", "1", "--no-interactive"]);
    const id = /Started run (\w+)/.exec(started.stdout)?.[1] as string;
    assert.equal(repo.nav(["test", "record", id, "1", "failed", "-m", "Three.\nFour."]).code, 0);
    const run = repo.nav(["test", "show", id]).stdout;
    assert.match(
      run,
      /^ {5}expected:\n {7}One\.\n {7}Two\.\n {5}actual:\n {7}Three\.\n {7}Four\.$/m,
    );
  });

  it("refuses what names no plan and no run, and a --runs that is not a count", () => {
    const missing = repo.nav(["test", "show", "logn"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /no test plan or run matches 'logn'/);
    assert.match(missing.stderr, /^ {2}login$/m);
    const bad = repo.nav(["test", "show", "login", "--runs", "two"]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /--runs takes a whole number of runs/);
  });
});

describe("nav test edit", () => {
  let repo: TempRepo;
  before(() => {
    repo = makeTestsRepo();
    openLoginPlan(repo);
  });
  after(() => repo.cleanup());

  it("records an edit made in the editor", () => {
    const editor = repo.script(
      "add-step.sh",
      `printf '\\n### Check the logs\\n\\n#### Actions\\n\\nRead them.\\n' >> "$1"`,
    );
    const result = repo.nav(["test", "edit", "login", "--commit"], { EDITOR: editor });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      "Edited .navbook/tests/login/plan.md\nCommitted docs(tests): edit login\n",
    );
    assert.equal(JSON.parse(repo.nav(["test", "show", "login", "--json"]).stdout).steps.length, 4);
  });

  it("leaves an edit that breaks the plan as it was saved, and says what is wrong", () => {
    const editor = repo.script("break.sh", `printf '\\n## Stray\\n' >> "$1"`);
    const result = repo.nav(["test", "edit", "login"], { EDITOR: editor });
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /\.navbook\/tests\/login\/plan\.md is no longer valid; it was left as you saved it/,
    );
    assert.match(result.stderr, /a level-2 heading 'Stray' after the first step/);
    assert.match(read(repo, ".navbook/tests/login/plan.md"), /## Stray/);
  });
});
