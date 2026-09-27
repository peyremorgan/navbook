/**
 * Configuration through the environment, as git itself reads it.
 *
 * Asserted against a real git, because what matters is not which variables
 * are set but what git makes of them: the entry added last must win, and the
 * ones already there must survive.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { appendGitConfig, disableAutoMaintenance } from "../../src/git-env.ts";

/** What git reads for `key` with only `env`'s configuration: no files at all. */
function gitSees(env: NodeJS.ProcessEnv, key: string): string | null {
  const result = spawnSync("git", ["config", "--get", key], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: "/nonexistent",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...env,
    },
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

describe("appendGitConfig", () => {
  it("starts a count where there is none", () => {
    const env: NodeJS.ProcessEnv = {};
    appendGitConfig(env, "maintenance.auto", "false");
    assert.deepEqual(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "maintenance.auto",
      GIT_CONFIG_VALUE_0: "false",
    });
    assert.equal(gitSees(env, "maintenance.auto"), "false");
  });

  it("reads an empty count as none, as git does", () => {
    const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: "" };
    appendGitConfig(env, "user.name", "Nav Server");
    assert.equal(env.GIT_CONFIG_COUNT, "1");
    assert.equal(gitSees(env, "user.name"), "Nav Server");
  });

  it("continues what the entrypoint passed, keeping it, and wins over an earlier value", () => {
    const env: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "Nav Server",
      GIT_CONFIG_KEY_1: "maintenance.auto",
      GIT_CONFIG_VALUE_1: "true",
    };
    disableAutoMaintenance(env);
    assert.equal(env.GIT_CONFIG_COUNT, "3");
    assert.equal(env.GIT_CONFIG_KEY_2, "maintenance.auto");
    assert.equal(gitSees(env, "user.name"), "Nav Server");
    assert.equal(gitSees(env, "maintenance.auto"), "false");
  });

  it("reads a count as git reads it, octal and hexadecimal included", () => {
    for (const [given, count] of [
      [" 1", 1],
      ["+1", 1],
      ["007", 7],
      ["010", 8],
      ["0x2", 2],
      ["0", 0],
    ] as const) {
      const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: given };
      for (let i = 0; i < count; i++) {
        env[`GIT_CONFIG_KEY_${i}`] = `test.k${i}`;
        env[`GIT_CONFIG_VALUE_${i}`] = "v";
      }
      disableAutoMaintenance(env);
      assert.equal(env.GIT_CONFIG_COUNT, String(count + 1), `after '${given}'`);
      assert.equal(env[`GIT_CONFIG_KEY_${count}`], "maintenance.auto");
      assert.equal(gitSees(env, "maintenance.auto"), "false", `git's reading after '${given}'`);
      if (count > 0) assert.equal(gitSees(env, `test.k${count - 1}`), "v");
    }
  });

  it("refuses a count git would refuse, rather than guessing past it", () => {
    for (const count of ["two", "-1", "1.5", "1 ", "  ", "08", "0x"]) {
      const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: count };
      assert.throws(
        () => appendGitConfig(env, "maintenance.auto", "false"),
        /GIT_CONFIG_COUNT is '.*', which git does not accept as a count/,
      );
      assert.deepEqual(env, { GIT_CONFIG_COUNT: count }, "a refused count is left untouched");
      // And git agrees that it is no count at all.
      assert.equal(gitSees({ GIT_CONFIG_COUNT: count }, "user.name"), null);
    }
  });
});
