/**
 * A remote to seed from, and a stand-in for the server the entrypoint becomes.
 *
 * These tests run the deployment's shell for real — the same `entrypoint.sh`
 * the image copies in, against a real git — because everything it does is
 * something only git can confirm: that identity passed through the environment
 * is what `git config --get` answers, that the credential helper is what `git
 * credential fill` calls, that a half-made clone is finished rather than
 * served. A rewrite of that logic in TypeScript would prove nothing about the
 * file that ships.
 *
 * What is stubbed is `nav-server` itself, and only because the assertions are
 * about the state it would have been handed. `packages/server/test` covers what
 * it does with it.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../packages/cli/test/helpers/temprepo.ts";

/** The file the image copies to `/entrypoint.sh`. */
export const ENTRYPOINT = join(REPO_ROOT, "packages", "server", "docker", "entrypoint.sh");
/** The script the web image drops into nginx's start-up directory. */
export const WEB_CONFIG_SCRIPT = join(REPO_ROOT, "packages", "web", "docker", "config.sh");

/** What the stub server saw when the entrypoint handed over. */
export interface Handover {
  cwd: string;
  args: string[];
  identity: { name: string; email: string };
  branch: string;
  clean: boolean;
  /** What `git credential fill` answers, which is what a push would be given. */
  credentials: Record<string, string>;
  /** The configuration git was handed through the environment, by key. */
  gitConfig: Record<string, string>;
  /** Everything `git config --list` shows from inside the container. */
  configList: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Absent when the entrypoint failed before reaching the server. */
  handover?: Handover;
}

export interface Fixture {
  dir: string;
  /** The bare repository the entrypoint is pointed at. */
  remoteUrl: string;
  /** That same repository as a path, for arranging what it holds. */
  remotePath: string;
  /** Where a seeded clone is expected to appear. */
  clonePath: string;
  git(args: string[], cwd?: string): { code: number; stdout: string; stderr: string };
  /** Run the entrypoint, with `env` merged over the isolated defaults. */
  run(env?: Record<string, string | undefined>, args?: string[]): RunResult;
  cleanup(): void;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Git with nothing of the developer's machine in it.
 *
 * The global config is the point: a person with `credential.helper = osxkeychain`
 * would otherwise see it in the assertions, and a person with no `user.email`
 * set would see a different failure than CI does.
 */
function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TZ: "UTC",
    LC_ALL: "C",
    LANG: "C",
    NO_COLOR: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * A source repository with a Navbook directory in it, cloned to a bare remote.
 *
 * `defaultBranch` is what the remote's HEAD points at, which is what the
 * entrypoint has to discover when nothing names a branch.
 */
export function makeFixture(options: { defaultBranch?: string } = {}): Fixture {
  const branch = options.defaultBranch ?? "main";
  const dir = mkdtempSync(join(tmpdir(), "navbook-deploy-"));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const env = isolatedEnv(home);

  const source = join(dir, "source");
  mkdirSync(source, { recursive: true });
  const git = (args: string[], cwd = source) => run("git", args, { cwd, env });

  git(["init", "-q", "-b", branch]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@test.invalid"]);
  mkdirSync(join(source, ".navbook", "issues", "open"), { recursive: true });
  writeFileSync(join(source, ".navbook", "navbook.json"), "{}\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "the repository being served"]);

  const remote = join(dir, "remote.git");
  run("git", ["clone", "-q", "--bare", source, remote], { cwd: dir, env });

  // A stub on PATH ahead of anything real, reporting the state it was handed.
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "nav-server");
  writeFileSync(stub, STUB_SERVER);
  chmodSync(stub, 0o755);

  const clonePath = join(dir, "clone");

  return {
    dir,
    remoteUrl: `file://${remote}`,
    remotePath: remote,
    clonePath,
    git: (args, cwd = clonePath) => run("git", args, { cwd, env }),
    run(overrides = {}, args = []) {
      const report = join(dir, `handover-${Math.random().toString(36).slice(2)}.json`);
      const merged: NodeJS.ProcessEnv = {
        ...env,
        PATH: `${bin}:${env.PATH}`,
        NAVBOOK_TEST_HANDOVER: report,
        NAV_SERVER_REPO: clonePath,
        NAVBOOK_REPO_URL: `file://${remote}`,
        NAVBOOK_GIT_NAME: "Navbook",
        NAVBOOK_GIT_EMAIL: "navbook@test.invalid",
      };
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      const result = run("sh", [ENTRYPOINT, ...args], { cwd: dir, env: merged });
      let handover: Handover | undefined;
      try {
        handover = JSON.parse(readFileSync(report, "utf8")) as Handover;
      } catch {
        handover = undefined;
      }
      return { ...result, ...(handover === undefined ? {} : { handover }) };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Run the web image's start-up script against a directory standing in for the
 * bundle, with `env` as the whole of its environment.
 */
export function runWebConfig(
  root: string,
  env: Record<string, string | undefined>,
): { code: number; stdout: string; stderr: string } {
  const merged: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", NAVBOOK_WEB_ROOT: root };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) merged[key] = value;
  }
  return run("sh", [WEB_CONFIG_SCRIPT], { env: merged });
}

/** Reports what the real server would have found, then exits as it would. */
const STUB_SERVER = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (args, input) =>
  spawnSync("git", args, { encoding: "utf8", ...(input === undefined ? {} : { input }) });
const value = (args) => (git(args).stdout ?? "").trim();

const credentials = {};
const filled = git(["credential", "fill"], "protocol=https\\nhost=example.com\\n\\n");
for (const line of (filled.stdout ?? "").split("\\n")) {
  const at = line.indexOf("=");
  if (at > 0) credentials[line.slice(0, at)] = line.slice(at + 1);
}

// What the environment actually handed git, in the order it was handed over.
const gitConfig = {};
const count = Number(process.env.GIT_CONFIG_COUNT ?? "0");
for (let i = 0; i < count; i += 1) {
  const key = process.env["GIT_CONFIG_KEY_" + i];
  if (key) gitConfig[key] = process.env["GIT_CONFIG_VALUE_" + i] ?? "";
}

writeFileSync(
  process.env.NAVBOOK_TEST_HANDOVER,
  JSON.stringify({
    cwd: process.cwd(),
    args: process.argv.slice(2),
    identity: { name: value(["config", "--get", "user.name"]), email: value(["config", "--get", "user.email"]) },
    branch: value(["rev-parse", "--abbrev-ref", "HEAD"]),
    clean: value(["status", "--porcelain"]) === "",
    credentials,
    gitConfig,
    configList: value(["config", "--list"]),
  }),
);
`;
