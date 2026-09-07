/**
 * What the API container does before it is an API container.
 *
 * The clone is the whole of the server's state, so the entrypoint is the whole
 * of the deployment's stateful logic: everything else in the image is a copy of
 * something the registry already has.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { type Fixture, makeFixture } from "./helpers.ts";

/** One fixture per test: seeding is the behaviour under test, not a setup step. */
function fixture(options?: { defaultBranch?: string }): Fixture {
  const made = makeFixture(options);
  after(() => made.cleanup());
  return made;
}

describe("the API container's entrypoint", () => {
  it("seeds an empty volume from the remote's default branch", () => {
    const fx = fixture({ defaultBranch: "trunk" });
    const result = fx.run();

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.handover, "the server was never reached");
    assert.equal(result.handover.branch, "trunk");
    assert.equal(result.handover.cwd, realpathSync(fx.clonePath));
    assert.equal(result.handover.clean, true);
    assert.ok(
      existsSync(join(fx.clonePath, ".navbook")),
      "the Navbook directory the server checks for is not there",
    );
  });

  it("serves the branch it is told to, over the remote's default", () => {
    const fx = fixture({ defaultBranch: "main" });
    assert.equal(fx.git(["branch", "release", "main"], fx.remotePath).code, 0);

    const result = fx.run({ NAVBOOK_BRANCH: "release" });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.handover?.branch, "release");
  });

  it("leaves a clone it already has alone", () => {
    const fx = fixture();
    assert.equal(fx.run().code, 0);
    const first = fx.git(["rev-parse", "HEAD"]).stdout.trim();

    // Something the remote does not have. A second seed would lose it.
    writeFileSync(join(fx.clonePath, "reconciled.txt"), "left for an operator\n");
    fx.git(["add", "-A"]);
    fx.git(["-c", "user.name=Op", "-c", "user.email=op@test.invalid", "commit", "-qm", "local"]);
    const second = fx.git(["rev-parse", "HEAD"]).stdout.trim();

    const result = fx.run();

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /serving the clone already in/);
    assert.equal(fx.git(["rev-parse", "HEAD"]).stdout.trim(), second);
    assert.notEqual(second, first);
  });

  it("points a clone it already has at the repository it is now told to serve", () => {
    const fx = fixture();
    assert.equal(fx.run().code, 0);
    fx.git(["remote", "set-url", "origin", "https://moved-away.invalid/x.git"]);

    const result = fx.run();

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /serving the clone already in/);
    assert.equal(
      fx.git(["remote", "get-url", "origin"]).stdout.trim(),
      fx.remoteUrl,
      "the volume outranked the configuration",
    );
  });

  it("finishes a seed a previous start left half-made", () => {
    const fx = fixture();
    // `git init` ran and nothing else: a directory with a .git and no commit,
    // which is what a network failure mid-fetch leaves behind.
    mkdirSync(fx.clonePath, { recursive: true });
    fx.git(["init", "-q", "-b", "main"]);
    fx.git(["remote", "add", "origin", "https://stale.invalid/gone.git"]);

    const result = fx.run();

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.handover?.branch, "main");
    assert.equal(result.handover?.clean, true);
    assert.equal(
      fx.git(["remote", "get-url", "origin"]).stdout.trim(),
      fx.remoteUrl,
      "the stale remote was not corrected",
    );
  });

  it("keeps an unclean tree rather than throwing the work away", () => {
    const fx = fixture();
    assert.equal(fx.run().code, 0);
    writeFileSync(join(fx.clonePath, "conflicted.md"), "a merge somebody has to finish\n");

    const result = fx.run();

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.handover?.clean, false, "the tree was cleaned behind the operator's back");
    assert.ok(existsSync(join(fx.clonePath, "conflicted.md")));
  });

  it("makes the clone's commits the identity it is given", () => {
    const fx = fixture();
    const result = fx.run({
      NAVBOOK_GIT_NAME: "A Gateway",
      NAVBOOK_GIT_EMAIL: "gateway@test.invalid",
    });

    assert.deepEqual(result.handover?.identity, {
      name: "A Gateway",
      email: "gateway@test.invalid",
    });
    // Passed through the environment, so nothing in the volume holds it and
    // the next start is free to say something else.
    assert.equal(fx.git(["config", "--local", "--get", "user.email"]).code, 1);
  });

  it("offers the token as the password a push is asked for", () => {
    const fx = fixture();
    const result = fx.run({ NAVBOOK_GIT_TOKEN: "a-secret-token" });

    assert.equal(result.handover?.credentials.username, "x-access-token");
    assert.equal(result.handover?.credentials.password, "a-secret-token");
  });

  it("uses the username it is given when the token needs one", () => {
    const fx = fixture();
    const result = fx.run({
      NAVBOOK_GIT_TOKEN: "a-secret-token",
      NAVBOOK_GIT_USERNAME: "a-machine-account",
    });

    assert.equal(result.handover?.credentials.username, "a-machine-account");
  });

  it("keeps the token out of anything git can print", () => {
    const fx = fixture();
    const result = fx.run({ NAVBOOK_GIT_TOKEN: "a-secret-token" });

    const listed = result.handover?.configList ?? "";
    assert.match(listed, /credential\.helper=/, "the helper was never configured");
    assert.ok(!listed.includes("a-secret-token"), listed);
    assert.ok(
      !JSON.stringify(result.handover?.gitConfig).includes("a-secret-token"),
      "the token was written into a config value rather than named",
    );
  });

  it("offers no credentials at all when there is no token", () => {
    const fx = fixture();
    const result = fx.run({ NAVBOOK_GIT_TOKEN: undefined });

    assert.equal(result.handover?.credentials.password, undefined);
  });

  it("adds to the git configuration the caller already passed", () => {
    const fx = fixture();
    const result = fx.run({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.abbrev",
      GIT_CONFIG_VALUE_0: "12",
    });

    assert.equal(result.code, 0, result.stderr);
    // Both survive: the caller's entry, and the identity added after it.
    assert.equal(result.handover?.gitConfig["core.abbrev"], "12");
    assert.equal(result.handover?.gitConfig["user.email"], "navbook@test.invalid");
    assert.equal(result.handover?.identity.email, "navbook@test.invalid");
  });

  for (const missing of ["NAVBOOK_REPO_URL", "NAVBOOK_GIT_NAME", "NAVBOOK_GIT_EMAIL"]) {
    it(`refuses to start without ${missing}, and says so`, () => {
      const fx = fixture();
      const result = fx.run({ [missing]: undefined });

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, new RegExp(`${missing} is required`));
      assert.equal(result.handover, undefined, "the server was started anyway");
    });
  }

  it("makes the remote under the name the server synchronises with", () => {
    const fx = fixture();
    const result = fx.run({ NAV_SERVER_REMOTE: "upstream" });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(fx.git(["remote", "get-url", "upstream"]).stdout.trim(), fx.remoteUrl);
    assert.equal(result.handover?.branch, "main");
  });

  it("says which branch it cannot find rather than serving the wrong one", () => {
    const fx = fixture();
    const result = fx.run({ NAVBOOK_BRANCH: "not-a-branch" });

    assert.notEqual(result.code, 0);
    assert.equal(result.handover, undefined);
  });

  it("hands the server the flags it was given", () => {
    const fx = fixture();
    const result = fx.run({}, ["--pull-interval-ms", "2000"]);

    assert.deepEqual(result.handover?.args, ["--pull-interval-ms", "2000"]);
  });
});
