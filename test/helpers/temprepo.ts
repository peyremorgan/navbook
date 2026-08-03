/**
 * A throwaway git repository for tests, with every source of nondeterminism
 * pinned: fixed identity, fixed dates, no global or system git config, UTC.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_IDENTITY = { name: "Nav Test", email: "nav@test.invalid" };
export const FIXTURE_DATE = "2026-08-01T10:00:00Z";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(HERE, "..", "..");

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface TempRepo {
  dir: string;
  home: string;
  /** `input` is fed to stdin; without it the command reads EOF, as in a pipeline. */
  nav(args: string[], env?: NodeJS.ProcessEnv, input?: string): RunResult;
  git(args: string[], env?: NodeJS.ProcessEnv): RunResult;
  write(relativePath: string, content: string): void;
  /** Write an executable shell script outside the repo and return its path. */
  script(name: string, body: string): string;
  commitAll(message: string, date?: string): void;
  cleanup(): void;
}

/** The command under test: `node src/cli/main.ts`, or `$NAV_BIN` when set. */
export function navCommand(): string[] {
  const override = process.env.NAV_BIN;
  if (override && override.trim() !== "") return override.trim().split(/\s+/);
  return [process.execPath, join(PROJECT_ROOT, "src", "cli", "main.ts")];
}

/**
 * Environment that makes git and nav byte-for-byte reproducible.
 *
 * `NAV_NOW` is pinned alongside the git dates, not left to the wall clock:
 * without it every `created:` stamp drifts away from the commit that carries
 * it, and the suite starts failing D10 (timestamp skew) purely because time
 * has passed since the fixture date. Tests that need a different instant pass
 * their own `NAV_NOW`, which overrides this one.
 */
export function deterministicEnv(home: string, date = FIXTURE_DATE): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TZ: "UTC",
    NAV_NOW: date,
    LC_ALL: "C",
    LANG: "C",
    NO_COLOR: "1",
    // A writable but private global config: isolated from the developer's own
    // settings, while still letting `nav install --alias` do its work.
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: FIXTURE_IDENTITY.name,
    GIT_AUTHOR_EMAIL: FIXTURE_IDENTITY.email,
    GIT_COMMITTER_NAME: FIXTURE_IDENTITY.name,
    GIT_COMMITTER_EMAIL: FIXTURE_IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

export function makeTempRepo(): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "navbook-test-"));
  const dir = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });

  const runIn = (
    command: string[],
    args: string[],
    env?: NodeJS.ProcessEnv,
    input?: string,
  ): RunResult => {
    const result = spawnSync(command[0] as string, [...command.slice(1), ...args], {
      cwd: dir,
      encoding: "utf8",
      input,
      env: { ...deterministicEnv(home), ...env },
    });
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  const repo: TempRepo = {
    dir,
    home,
    git: (args, env) => runIn(["git"], args, env),
    nav: (args, env, input) => runIn(navCommand(), args, env, input),
    write(relativePath, content) {
      const target = join(dir, ...relativePath.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    },
    script(name, body) {
      const path = join(home, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`, { encoding: "utf8", mode: 0o755 });
      return path;
    },
    commitAll(message, date) {
      repo.git(["add", "-A"]);
      const env = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
      const result = repo.git(["commit", "--quiet", "-m", message], env);
      if (result.code !== 0) throw new Error(`fixture commit failed: ${result.stderr}`);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  repo.git(["init", "--quiet"]);
  repo.git(["symbolic-ref", "HEAD", "refs/heads/main"]);
  repo.git(["config", "user.name", FIXTURE_IDENTITY.name]);
  repo.git(["config", "user.email", FIXTURE_IDENTITY.email]);
  repo.git(["config", "commit.gpgsign", "false"]);
  return repo;
}

/** A repository that already has `.navbook/` and one commit. */
export function makeNavRepo(): TempRepo {
  const repo = makeTempRepo();
  const result = repo.nav(["init", "--commit"]);
  if (result.code !== 0) throw new Error(`nav init failed: ${result.stderr}`);
  return repo;
}
