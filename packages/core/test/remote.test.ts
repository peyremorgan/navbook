/**
 * The remote half of the git layer, against a real bare repository.
 *
 * A push rejection is the case worth proving: the API server's whole sync loop
 * turns on telling "somebody pushed first" apart from "git failed".
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitError, git } from "../src/git/exec.ts";
import { fetchRemote, hasRemote, listRemotes, pushBranch } from "../src/git/remote.ts";

const IDENTITY = { name: "Nav Test", email: "nav@test.invalid" };

interface Fixture {
  /** A bare repository standing in for origin. */
  origin: string;
  /** A clone with `origin` configured and one commit pushed. */
  clone: string;
  /** A second clone of the same origin, for making somebody else's push. */
  peer: string;
  commit(dir: string, name: string): void;
}

function inRemotes(use: (fx: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), "navbook-remote-"));
  try {
    const origin = join(root, "origin.git");
    const clone = join(root, "clone");
    const peer = join(root, "peer");
    git(["init", "--quiet", "--bare", "-b", "main", origin]);

    const commit = (dir: string, name: string): void => {
      writeFileSync(join(dir, name), `${name}\n`, "utf8");
      git(["add", "-A"], { cwd: dir });
      git(["commit", "--quiet", "-m", name], { cwd: dir });
    };

    const setUp = (dir: string): void => {
      git(["config", "user.name", IDENTITY.name], { cwd: dir });
      git(["config", "user.email", IDENTITY.email], { cwd: dir });
      git(["config", "commit.gpgsign", "false"], { cwd: dir });
    };

    git(["clone", "--quiet", origin, clone]);
    setUp(clone);
    commit(clone, "first");
    assert.equal(pushBranch(clone, "origin", "main"), "ok");

    git(["clone", "--quiet", origin, peer]);
    setUp(peer);

    use({ origin, clone, peer, commit });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("remotes", () => {
  it("lists the configured remotes", () => {
    inRemotes(({ clone }) => {
      assert.deepEqual(listRemotes(clone), ["origin"]);
      assert.equal(hasRemote(clone, "origin"), true);
      assert.equal(hasRemote(clone, "upstream"), false);
    });
  });

  it("reports no remotes in a repository that has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "navbook-bare-"));
    try {
      git(["init", "--quiet", "-b", "main", dir]);
      assert.deepEqual(listRemotes(dir), []);
      assert.equal(hasRemote(dir, "origin"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fetches another clone's commits without merging them", () => {
    inRemotes(({ clone, peer, commit }) => {
      commit(peer, "second");
      assert.equal(pushBranch(peer, "origin", "main"), "ok");

      fetchRemote(clone, "origin");
      // Fetched, so the remote-tracking ref moved; HEAD did not.
      assert.notEqual(
        git(["rev-parse", "origin/main"], { cwd: clone }).trim(),
        git(["rev-parse", "HEAD"], { cwd: clone }).trim(),
      );
    });
  });

  it("throws when the remote does not exist", () => {
    inRemotes(({ clone }) => {
      assert.throws(() => fetchRemote(clone, "nowhere"), GitError);
    });
  });

  it("rejects rather than throws when the remote has moved on", () => {
    inRemotes(({ clone, peer, commit }) => {
      commit(peer, "theirs");
      assert.equal(pushBranch(peer, "origin", "main"), "ok");

      commit(clone, "ours");
      assert.equal(pushBranch(clone, "origin", "main"), "rejected");

      // Merging what they pushed is what makes the retry a fast-forward.
      fetchRemote(clone, "origin");
      git(["merge", "--no-edit", "--quiet", "origin/main"], { cwd: clone });
      assert.equal(pushBranch(clone, "origin", "main"), "ok");
    });
  });

  it("throws when the push fails for a reason a retry cannot mend", () => {
    inRemotes(({ clone }) => {
      assert.throws(() => pushBranch(clone, "nowhere", "main"), GitError);
      assert.throws(() => pushBranch(clone, "origin", "no-such-branch"), GitError);
    });
  });
});
