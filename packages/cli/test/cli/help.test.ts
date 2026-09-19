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
