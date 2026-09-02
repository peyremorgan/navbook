/**
 * The workspace context: the conformance hooks it honors, the errors it
 * raises, and the identity it acts under.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gitRun } from "../src/git/exec.ts";
import {
  currentAuthor,
  makeWsCtx,
  nowIso,
  WorkspaceError,
  wsFail,
} from "../src/workspace/index.ts";

/**
 * A directory outside any repository, so discovery has a known answer.
 *
 * The assumption that the temporary directory is not itself inside a checkout
 * is checked rather than trusted: if it ever fails, the tests below would
 * report a confusing discovery result instead of a broken environment.
 */
function outsideAnyRepo<T>(use: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "navbook-wsctx-"));
  try {
    assert.equal(
      gitRun(["rev-parse", "--show-toplevel"], { cwd: dir }).code === 0,
      false,
      `${tmpdir()} is inside a git repository, so this suite cannot test discovery failure`,
    );
    return use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ctx(env: NodeJS.ProcessEnv, dir: string) {
  return makeWsCtx({ cwd: dir, env, requireRepo: false });
}

describe("WorkspaceError", () => {
  it("carries a machine-readable code and no exit code", () => {
    const error = new WorkspaceError("not-found", "no issue matches 'abcd'");
    assert.equal(error.code, "not-found");
    assert.equal(error.name, "WorkspaceError");
    assert.deepEqual(error.details, []);
    assert.ok(!("exitCode" in error));
  });

  it("keeps the detail lines a front end may show under the message", () => {
    const error = new WorkspaceError("ambiguous", "'ab' is ambiguous", ["#abcd1234", "#abce5678"]);
    assert.deepEqual(error.details, ["#abcd1234", "#abce5678"]);
  });

  it("wsFail throws it", () => {
    assert.throws(
      () => wsFail("precondition", "#abcd1234 is already closed"),
      (error: unknown) =>
        error instanceof WorkspaceError &&
        error.code === "precondition" &&
        error.message === "#abcd1234 is already closed",
    );
  });
});

describe("makeWsCtx", () => {
  it("tolerates being outside a repository when requireRepo is false", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({}, dir);
      assert.equal(ws.hasNavbook, false);
      assert.equal(ws.navRoot, "");
    });
  });

  it("reports being outside a repository as a typed error otherwise", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => makeWsCtx({ cwd: dir, env: {} }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "not-a-git-repo",
      );
    });
  });

  it("fixes the clock to NAV_NOW", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({ NAV_NOW: "2026-08-04T16:40:00Z" }, dir);
      assert.equal(nowIso(ws), "2026-08-04T16:40:00Z");
      assert.equal(nowIso(ws), "2026-08-04T16:40:00Z", "the same instant on every read");
    });
  });

  it("rejects an unparseable NAV_NOW", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => ctx({ NAV_NOW: "not a date" }, dir),
        (error: unknown) => error instanceof WorkspaceError && error.code === "bad-env",
      );
    });
  });

  it("hands out NAV_IDS in order, then reports exhaustion", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({ NAV_IDS: "aaa11111, bbb22222" }, dir);
      assert.equal(ws.mintId(), "aaa11111");
      assert.equal(ws.mintId(), "bbb22222");
      assert.throws(
        () => ws.mintId(),
        (error: unknown) => error instanceof WorkspaceError && error.code === "ids-exhausted",
      );
    });
  });

  it("rejects a malformed NAV_IDS", () => {
    outsideAnyRepo((dir) => {
      assert.throws(
        () => ctx({ NAV_IDS: "not-an-id" }, dir),
        (error: unknown) => error instanceof WorkspaceError && error.code === "bad-env",
      );
    });
  });

  /**
   * `NAV_ROOT` is joined to the repository root as a path and handed to git as
   * a *pathspec*, so a value that is merely odd is not merely odd: a wildcard
   * would match files the user never named, and `..` would walk out of the
   * repository. Each rejection below is one of those, not a style preference.
   */
  describe("NAV_ROOT", () => {
    const rejected: [string, string][] = [
      ["an absolute path", "/etc/navbook"],
      ["a Windows-style absolute path", "C:/navbook"],
      ["a parent-directory escape", "../outside"],
      ["a parent-directory escape in the middle", "a/../../outside"],
      ["a bare '.'", "."],
      ["a segment that is just '.'", "a/./b"],
      ["a trailing slash", ".navbook/"],
      ["a leading slash", "/navbook"],
      ["a doubled slash", "a//b"],
      ["a backslash separator", ".navbook\\issues"],
      ["a '*' wildcard", ".nav*"],
      ["a '?' wildcard", ".nav?ook"],
      ["a character class", ".nav[bo]ok"],
      ["leading pathspec magic", ":(glob).navbook"],
      ["the git directory", ".git"],
      ["the git directory nested", "a/.git"],
      ["a control character", ".nav\u0001book"],
      ["an embedded newline", ".nav\nbook"],
      ["a tab", ".nav\tbook"],
    ];

    for (const [what, value] of rejected) {
      it(`rejects ${what}`, () => {
        outsideAnyRepo((dir) => {
          assert.throws(
            () => ctx({ NAV_ROOT: value }, dir),
            (error: unknown) => {
              assert.ok(error instanceof WorkspaceError, `${value} was accepted`);
              assert.equal(error.code, "bad-env");
              assert.match(error.message, /NAV_ROOT/);
              return true;
            },
            `NAV_ROOT=${JSON.stringify(value)} should have been refused`,
          );
        });
      });
    }

    const accepted: [string, string, string][] = [
      ["a dotted name", ".issues", ".issues"],
      ["a plain name", "tracker", "tracker"],
      ["a nested name", ".github/navbook", ".github/navbook"],
      ["a name with a dot inside it", "nav.book", "nav.book"],
      ["a name with a dash and an underscore", "my_nav-book", "my_nav-book"],
      ["a non-ASCII name", "carnet", "carnet"],
      ["surrounding whitespace, which is trimmed", "  .issues  ", ".issues"],
    ];

    for (const [what, value, expected] of accepted) {
      it(`accepts ${what}`, () => {
        outsideAnyRepo((dir) => {
          assert.equal(ctx({ NAV_ROOT: value }, dir).navDir, expected);
        });
      });
    }

    it("treats an empty value as unset, matching how the server reads its own", () => {
      outsideAnyRepo((dir) => {
        assert.equal(ctx({ NAV_ROOT: "" }, dir).navDir, ".navbook");
        assert.equal(ctx({ NAV_ROOT: "   " }, dir).navDir, ".navbook");
      });
    });

    it("trims a trailing newline rather than refusing it", () => {
      // `NAV_ROOT=$(cat somefile)` is a plausible way to set this, and the
      // newline it carries is surrounding whitespace like any other. Only a
      // newline *inside* the name is a real problem, and that is refused above.
      outsideAnyRepo((dir) => {
        assert.equal(ctx({ NAV_ROOT: ".issues\n" }, dir).navDir, ".issues");
      });
    });

    it("still reports a name when discovery could not run at all", () => {
      // `requireRepo: false` outside a repository: nothing was discovered, but
      // every message that formats a path still needs a name to use.
      outsideAnyRepo((dir) => {
        assert.equal(ctx({}, dir).navDir, ".navbook");
        assert.equal(ctx({ NAV_ROOT: ".issues" }, dir).navDir, ".issues");
      });
    });
  });

  it("mints an id that avoids the ones already taken", () => {
    outsideAnyRepo((dir) => {
      const ws = ctx({}, dir);
      const first = ws.mintId();
      assert.match(first, /^[a-z][a-z0-9]{7}$/);
      assert.notEqual(ws.mintId(new Set([first])), first);
    });
  });

  it("acts under a supplied identity without consulting git", () => {
    outsideAnyRepo((dir) => {
      const ws = makeWsCtx({
        cwd: dir,
        env: {},
        requireRepo: false,
        identity: { name: "Web User", email: "web@example.com" },
      });
      assert.deepEqual(ws.identity(), { name: "Web User", email: "web@example.com" });
      assert.equal(currentAuthor(ws), "Web User <web@example.com>");
    });
  });

  it("formats an identity with no name as the bare address", () => {
    outsideAnyRepo((dir) => {
      const ws = makeWsCtx({
        cwd: dir,
        env: {},
        requireRepo: false,
        identity: { email: "web@example.com" },
      });
      assert.equal(currentAuthor(ws), "web@example.com");
    });
  });
});
