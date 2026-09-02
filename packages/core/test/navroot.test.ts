/**
 * Locating the Navbook directory when it is not called `.navbook`.
 *
 * Discovery is the half of "configurable root" that has to work without any
 * environment set, because that is the situation of everyone who clones a
 * repository that renamed its directory. These tests run against real
 * repositories: the fallback pass asks git what is in the index, so a fake
 * filesystem would prove nothing about it.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FrontmatterError } from "../src/core/frontmatter.ts";
import { LinkRewriteError } from "../src/core/ops.ts";
import { type EntityRecord, NAV_MARKER, type NavTree, parseTree } from "../src/core/tree.ts";
import { git } from "../src/git/exec.ts";
import {
  AmbiguousNavRootError,
  DEFAULT_NAV_DIR,
  discoverNavDir,
  findRepo,
} from "../src/git/repo.ts";
import { rewritePlan } from "../src/ops/entity.ts";
import { makeWsCtx, WorkspaceError } from "../src/workspace/index.ts";

/** A fresh repository with one commit, so the index and HEAD both exist. */
function inRepo(use: (dir: string) => void): void {
  // Resolved, because `git rev-parse --show-toplevel` reports a real path and
  // the platform temporary directory is a symlink on macOS.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "navbook-root-")));
  try {
    git(["init", "--quiet", "-b", "main", dir]);
    git(["config", "user.name", "Nav Test"], { cwd: dir });
    git(["config", "user.email", "nav@test.invalid"], { cwd: dir });
    git(["config", "commit.gpgsign", "false"], { cwd: dir });
    writeFileSync(join(dir, "README.md"), "# fixture\n", "utf8");
    git(["add", "-A"], { cwd: dir });
    git(["commit", "--quiet", "-m", "first"], { cwd: dir });
    use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Create `<dir>/<navDir>/` carrying a marker. `stage` puts it in the index. */
function plantMarker(dir: string, navDir: string, opts: { stage?: boolean } = {}): void {
  const target = join(dir, ...navDir.split("/"));
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, NAV_MARKER), '{\n  "version": 1\n}\n', "utf8");
  if (opts.stage) git(["add", "-A"], { cwd: dir });
}

describe("discoverNavDir", () => {
  it("returns the default when the repository has nothing at all", () => {
    // Not an error: this is the state `nav init` exists to fix, and the caller
    // reports it through `hasNavbook` rather than a throw.
    inRepo((dir) => assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR));
  });

  it("prefers .navbook/ even when it carries no marker", () => {
    // Every repository that predates the marker is in exactly this state.
    inRepo((dir) => {
      mkdirSync(join(dir, ".navbook", "issues", "open"), { recursive: true });
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("prefers .navbook/ over a marker somewhere else", () => {
    inRepo((dir) => {
      mkdirSync(join(dir, ".navbook"), { recursive: true });
      plantMarker(dir, ".issues", { stage: true });
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("finds a renamed directory by its marker", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      assert.equal(discoverNavDir(dir), ".issues");
    });
  });

  it("finds an untracked marker, which is what init leaves before the commit", () => {
    // The git pass cannot see this one, so the filesystem pass has to run first.
    inRepo((dir) => {
      plantMarker(dir, "tracker");
      assert.equal(discoverNavDir(dir), "tracker");
    });
  });

  it("finds a nested directory through the index", () => {
    // Too deep for the one-level scan; only `git ls-files` reaches it.
    inRepo((dir) => {
      plantMarker(dir, ".github/navbook", { stage: true });
      assert.equal(discoverNavDir(dir), ".github/navbook");
    });
  });

  it("does not find a nested marker that was never staged", () => {
    // Honest limitation, asserted so it cannot change unnoticed.
    inRepo((dir) => {
      plantMarker(dir, ".github/navbook");
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("refuses to guess between two markers", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      plantMarker(dir, "tracker");
      assert.throws(
        () => discoverNavDir(dir),
        (error: unknown) =>
          error instanceof AmbiguousNavRootError &&
          error.candidates.length === 2 &&
          error.candidates.includes(".issues") &&
          error.candidates.includes("tracker"),
      );
    });
  });

  it("names every candidate, sorted, so the message is stable", () => {
    inRepo((dir) => {
      plantMarker(dir, "zeta");
      plantMarker(dir, "alpha");
      try {
        discoverNavDir(dir);
        assert.fail("expected an ambiguity");
      } catch (error) {
        assert.ok(error instanceof AmbiguousNavRootError);
        assert.deepEqual(error.candidates, ["alpha", "zeta"]);
      }
    });
  });

  it("ignores a marker inside .git/", () => {
    // A stray file there must never be able to redirect the whole tool.
    inRepo((dir) => {
      writeFileSync(join(dir, ".git", NAV_MARKER), "{}\n", "utf8");
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("ignores a marker inside node_modules/", () => {
    inRepo((dir) => {
      plantMarker(dir, "node_modules");
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("ignores a marker that is not inside a directory", () => {
    // A `navbook.json` at the repository root marks nothing: the root of a
    // Navbook tree is a directory, and the repository is not it.
    inRepo((dir) => {
      writeFileSync(join(dir, NAV_MARKER), "{}\n", "utf8");
      git(["add", "-A"], { cwd: dir });
      assert.equal(discoverNavDir(dir), DEFAULT_NAV_DIR);
    });
  });

  it("follows a symlinked directory", () => {
    inRepo((dir) => {
      mkdirSync(join(dir, "real"), { recursive: true });
      writeFileSync(join(dir, "real", NAV_MARKER), "{}\n", "utf8");
      symlinkSync(join(dir, "real"), join(dir, "linked"));
      // Both the directory and the link to it carry the marker.
      assert.throws(() => discoverNavDir(dir), AmbiguousNavRootError);
    });
  });
});

describe("findRepo", () => {
  it("reports the discovered name and its absolute path", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      const paths = findRepo(dir);
      assert.equal(paths.navDir, ".issues");
      assert.equal(paths.navRoot, join(dir, ".issues"));
      assert.equal(paths.hasNavbook, true);
    });
  });

  it("builds a native path from a nested POSIX name", () => {
    inRepo((dir) => {
      plantMarker(dir, ".github/navbook", { stage: true });
      const paths = findRepo(dir);
      assert.equal(paths.navRoot, join(dir, ".github", "navbook"));
    });
  });

  it("takes an override over anything on disk", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      const paths = findRepo(dir, "elsewhere");
      assert.equal(paths.navDir, "elsewhere");
      assert.equal(paths.hasNavbook, false, "an override need not exist yet");
    });
  });
});

describe("makeWsCtx and the Navbook directory", () => {
  const env = (navRoot?: string): NodeJS.ProcessEnv =>
    navRoot === undefined ? {} : { NAV_ROOT: navRoot };

  it("defaults to .navbook", () => {
    inRepo((dir) => assert.equal(makeWsCtx({ cwd: dir, env: env() }).navDir, DEFAULT_NAV_DIR));
  });

  it("honors NAV_ROOT", () => {
    inRepo((dir) => {
      const ws = makeWsCtx({ cwd: dir, env: env(".issues") });
      assert.equal(ws.navDir, ".issues");
      assert.equal(ws.navRoot, join(dir, ".issues"));
    });
  });

  it("lets NAV_ROOT win over a directory that is actually there", () => {
    inRepo((dir) => {
      mkdirSync(join(dir, ".navbook"), { recursive: true });
      assert.equal(makeWsCtx({ cwd: dir, env: env("tracker") }).navDir, "tracker");
    });
  });

  it("lets NAV_ROOT settle an ambiguity that would otherwise fail", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      plantMarker(dir, "tracker");
      assert.equal(makeWsCtx({ cwd: dir, env: env(".issues") }).navDir, ".issues");
    });
  });

  it("reports an ambiguity as a workspace error naming a way out", () => {
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      plantMarker(dir, "tracker");
      assert.throws(
        () => makeWsCtx({ cwd: dir, env: env() }),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceError);
          assert.equal(error.code, "ambiguous-root");
          assert.match(error.message, /\.issues/);
          assert.match(error.message, /tracker/);
          assert.ok(error.details.some((line) => line.includes("NAV_ROOT")));
          return true;
        },
      );
    });
  });

  it("fails on an ambiguity even when a repository is optional", () => {
    // `requireRepo: false` forgives not being in a repository. It must not
    // forgive being in one whose root cannot be identified.
    inRepo((dir) => {
      plantMarker(dir, ".issues");
      plantMarker(dir, "tracker");
      assert.throws(
        () => makeWsCtx({ cwd: dir, env: env(), requireRepo: false }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "ambiguous-root",
      );
    });
  });

  it("takes an explicit navDir over NAV_ROOT", () => {
    inRepo((dir) => {
      const ws = makeWsCtx({ cwd: dir, env: env("from-env"), navDir: "from-caller" });
      assert.equal(ws.navDir, "from-caller");
    });
  });

  it("validates an explicit navDir exactly as it validates the variable", () => {
    inRepo((dir) => {
      assert.throws(
        () => makeWsCtx({ cwd: dir, env: env(), navDir: "../escape" }),
        (error: unknown) => error instanceof WorkspaceError && error.code === "bad-env",
      );
    });
  });
});

/**
 * `rewritePlan` turns a file that cannot be re-serialized into an operational
 * error naming the file. The name it prefixes is the configured one, which no
 * end-to-end test reaches: the failure needs YAML that parses and then refuses
 * to come back out, which no ordinary edit produces.
 */
describe("rewritePlan", () => {
  const entity = (): EntityRecord => {
    const tree = new Map([
      [
        "issues/open/bqlybac0-login-timeout/issue.md",
        "---\ntitle: T\nauthor: a@example.com\ncreated: 2026-08-02T09:14:00Z\n---\n\nBody.\n",
      ],
    ]) as NavTree;
    const record = parseTree(tree).issues[0];
    assert.ok(record);
    return record;
  };

  it("names the failing file under the configured directory", () => {
    assert.throws(
      () =>
        rewritePlan(".issues", entity(), () => {
          throw new FrontmatterError("could not be re-emitted");
        }),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceError);
        assert.equal(error.code, "frontmatter");
        assert.match(error.message, /^\.issues\/issues\/open\/bqlybac0-login-timeout\/issue\.md: /);
        return true;
      },
    );
  });

  it("names the neighbour a link rewrite actually broke, not the entity asked for", () => {
    assert.throws(
      () =>
        rewritePlan(".issues", entity(), () => {
          throw new LinkRewriteError("issues/open/other-x/issue.md", "bad list");
        }),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceError);
        assert.match(error.message, /^\.issues\/issues\/open\/other-x\/issue\.md: bad list$/);
        return true;
      },
    );
  });

  it("lets anything that is not a frontmatter failure through untouched", () => {
    const boom = new TypeError("unrelated");
    assert.throws(
      () =>
        rewritePlan(".issues", entity(), () => {
          throw boom;
        }),
      (error: unknown) => error === boom,
    );
  });
});
