/**
 * The help surface: `--help` is the only way to ask, at every level.
 *
 * Commander hands an implicit `help [command]` verb to every command that has
 * subcommands, so `nav issue help open` used to print exactly what `nav issue
 * open --help` prints. The duplicate spelling was removed; these tests keep a
 * Commander upgrade from quietly restoring it, and pin that the survivor still
 * answers everywhere the removed one did.
 *
 * A bare repository is deliberate: help must work before `nav init` has run.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { QUERY_TERMS } from "@navbook/core";
import { pluginHelpRow } from "../../src/program.ts";
import { makeTempRepo, type TempRepo } from "../helpers/temprepo.ts";

let repo: TempRepo;
before(() => {
  repo = makeTempRepo();
});
after(() => repo.cleanup());

/** The levels of the tree that own a help page, and how each names itself. */
const LEVELS: Array<{ path: string[]; usage: RegExp }> = [
  { path: [], usage: /^Usage: nav \[options\] \[command\]/m },
  { path: ["issue"], usage: /^Usage: nav issue \[options\] \[command\]/m },
  { path: ["pr"], usage: /^Usage: nav pr \[options\] \[command\]/m },
  { path: ["issue", "open"], usage: /^Usage: nav issue open \[options\] <title>/m },
  { path: ["pr", "merge"], usage: /^Usage: nav pr merge \[options\] \[id\]/m },
];

/** Commands are listed one per line, their name first on the line. */
function listsHelpCommand(text: string): boolean {
  return /^\s+help\b/m.test(text);
}

describe("--help", () => {
  for (const { path, usage } of LEVELS) {
    it(`answers for 'nav ${path.join(" ")}' and exits 0`, () => {
      const result = repo.nav([...path, "--help"]);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, usage);
      assert.match(result.stdout, /^Options:/m, "with the options it documents");
    });
  }

  it("is spelled -h too", () => {
    const result = repo.nav(["issue", "-h"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Usage: nav issue/m);
  });
});

describe("the help subcommand", () => {
  for (const path of [["help"], ["issue", "help"], ["pr", "help"], ["issue", "help", "open"]]) {
    it(`is gone: 'nav ${path.join(" ")}' is an unknown command`, () => {
      const result = repo.nav(path);
      assert.equal(result.code, 1, `stdout: ${result.stdout}`);
      assert.match(result.stderr, /unknown command 'help'/);
    });
  }

  it("is not advertised by the help text of any command that has subcommands", () => {
    for (const path of [[], ["issue"], ["pr"]]) {
      const result = repo.nav([...path, "--help"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(
        listsHelpCommand(result.stdout),
        false,
        `'nav ${path.join(" ")} --help' still lists a help command:\n${result.stdout}`,
      );
    }
  });

  it("reads as a plain unknown verb, like any other typo", () => {
    const known = repo.nav(["issue", "bogus"]);
    const removed = repo.nav(["issue", "help"]);
    assert.equal(removed.code, known.code);
    assert.equal(
      removed.stderr.replace("'help'", "'bogus'"),
      known.stderr,
      "no leftover special-casing of the word 'help'",
    );
  });
});

describe("the query grammar in 'list --help'", () => {
  for (const kind of ["issue", "pr"] as const) {
    const noun = kind === "issue" ? "issues" : "pull requests";

    it(`documents every term 'nav ${kind} list' accepts, and none it refuses`, () => {
      const help = repo.nav([kind, "list", "--help"]).stdout;
      for (const term of QUERY_TERMS) {
        const accepted = term.only === undefined || term.only === kind;
        const listed = new RegExp(`^  ${term.key}:`, "m").test(help);
        assert.equal(
          listed,
          accepted,
          `'${term.key}:' ${accepted ? "is missing from" : "is offered by"} the help for ${noun}`,
        );
      }
    });

    it(`completes on 'nav ${kind} list' exactly the terms its help documents`, () => {
      const offered = repo
        .nav(["__complete", kind, "list"])
        .stdout.split("\n")
        .filter((line) => /^[a-z]+:$/.test(line));
      const help = repo.nav([kind, "list", "--help"]).stdout;
      const documented = [...help.matchAll(/^ {2}([a-z]+):/gm)].map((m) => `${m[1]}:`);
      assert.deepEqual(offered, documented);
    });
  }

  it("names in the closing paragraph every term that ORs and every one that ANDs", () => {
    const issues = repo.nav(["issue", "list", "--help"]).stdout;
    assert.match(issues, /single-valued fields \(status, author, milestone, deadline\)/);
    assert.match(issues, /multi-valued ones \(label, assignee\)\./);
    const prs = repo.nav(["pr", "list", "--help"]).stdout;
    assert.match(prs, /single-valued fields \(status, author, milestone, review\)/);
    assert.match(prs, /multi-valued ones \(label, assignee, reviewer, awaiting\)\./);
    // With no plugin there is no plugin term to speak for.
    assert.doesNotMatch(`${issues}${prs}`, /A plugin's terms/);
  });

  it("aligns a plugin's help line whatever spacing its manifest used", () => {
    const aligned = `  ${"ptag:T".padEnd(28)}T is among the probe tags`;
    assert.deepEqual(pluginHelpRow("ptag:T   T is among the probe tags"), [aligned]);
    assert.deepEqual(pluginHelpRow("  ptag:T\t\tT is among the probe tags  "), [aligned]);
    // One space is part of the syntax, not the gap before the hint.
    assert.deepEqual(pluginHelpRow("ptag:T  T is  spaced"), [
      `  ${"ptag:T".padEnd(28)}T is  spaced`,
    ]);
  });

  it("keeps a plugin's syntax and hint apart when either is unusual", () => {
    assert.deepEqual(pluginHelpRow("ptag:T"), ["  ptag:T"]);
    const wide = "component:NAME-OR-GLOB-PATTERN";
    assert.deepEqual(pluginHelpRow(`${wide}  what it matches`), [
      `  ${wide}`,
      `  ${"".padEnd(28)}what it matches`,
    ]);
  });

  it("gives every term it documents a description", () => {
    for (const kind of ["issue", "pr"]) {
      const help = repo.nav([kind, "list", "--help"]).stdout;
      for (const [, syntax] of help.matchAll(/^ {2}([a-z]+:\S*)(?: *)$/gm)) {
        assert.fail(`'${syntax}' is listed with no description`);
      }
    }
  });
});
