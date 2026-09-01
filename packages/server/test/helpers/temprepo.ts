/**
 * A throwaway origin and the clones around it.
 *
 * The server's whole reason for existing is that it owns a clone, so a fixture
 * that is only a repository would not exercise it: there has to be somewhere to
 * push to, and somebody else pushing there.
 *
 * `deterministicEnv` is deliberately a copy of the CLI suite's rather than a
 * shared helper — the rest of that file spawns `nav`, which is no use here, and
 * a package extracted for two callers is a package to keep in step for two.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentAuthor,
  makeWsCtx,
  newIssueFile,
  newPrFile,
  openIssue,
  openPr,
  preparePrOpen,
} from "@navbook/core";

export const FIXTURE_IDENTITY = { name: "Nav Server", email: "server@test.invalid" };
export const FIXTURE_DATE = "2026-08-01T10:00:00Z";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, "..", "..");
export const SERVER_ENTRY = join(PACKAGE_ROOT, "src", "main.ts");

/** Environment that makes git and the server byte-for-byte reproducible. */
export function deterministicEnv(home: string, date = FIXTURE_DATE): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TZ: "UTC",
    NAV_NOW: date,
    LC_ALL: "C",
    LANG: "C",
    NO_COLOR: "1",
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

export interface Clone {
  dir: string;
  git(args: string[], env?: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string };
  /** Open an issue in this clone, as somebody working from a terminal would. */
  fileIssue(title: string, body: string, ids: string): void;
  /** Open a pull request on a new branch, and go back to main. */
  filePr(title: string, body: string, ids: string, branch: string): void;
  write(relativePath: string, content: string): void;
  commitAll(message: string): void;
}

export interface Fixture {
  /** The bare repository both clones push to. */
  origin: string;
  /** The clone the server serves. */
  server: Clone;
  /** A second clone, standing in for somebody working from a terminal. */
  peer: Clone;
  home: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

export interface FixtureOptions {
  /** Leave the clone with no remote, to exercise local-only mode. */
  noRemote?: boolean;
}

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "navbook-server-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const env = deterministicEnv(home);

  const run = (
    dir: string,
    args: string[],
    extra?: NodeJS.ProcessEnv,
  ): { code: number; stdout: string; stderr: string } => {
    const result = spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...env, ...extra },
    });
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };

  const origin = join(root, "origin.git");
  spawnSync("git", ["init", "--quiet", "--bare", "-b", "main", origin], { env });

  const makeClone = (name: string): Clone => {
    const dir = join(root, name);
    if (opts.noRemote) {
      spawnSync("git", ["init", "--quiet", "-b", "main", dir], { env });
    } else {
      spawnSync("git", ["clone", "--quiet", origin, dir], { env });
    }
    run(dir, ["config", "user.name", FIXTURE_IDENTITY.name]);
    run(dir, ["config", "user.email", FIXTURE_IDENTITY.email]);
    run(dir, ["config", "commit.gpgsign", "false"]);

    const clone: Clone = {
      dir,
      git: (args, extra) => run(dir, args, extra),
      write(relativePath, content) {
        const target = join(dir, ...relativePath.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      },
      commitAll(message) {
        run(dir, ["add", "-A"]);
        const result = run(dir, ["commit", "--quiet", "-m", message]);
        if (result.code !== 0) throw new Error(`fixture commit failed: ${result.stderr}`);
      },
      fileIssue(title, body, ids) {
        const ws = makeWsCtx({ cwd: dir, env: { ...env, NAV_IDS: ids } });
        const content = newIssueFile({
          title,
          author: currentAuthor(ws),
          created: FIXTURE_DATE,
          body,
        });
        openIssue(ws, { content, fallbackTitle: title }, { commit: true });
      },
      filePr(title, body, ids, branch) {
        // A pull request rides on the branch it proposes to merge (spec 03
        // §3.5), so it is opened from there and left there.
        run(dir, ["checkout", "--quiet", "-b", branch]);
        clone.write(`${branch}.txt`, `work on ${branch}\n`);
        clone.commitAll(`feat: ${title}`);

        const ws = makeWsCtx({ cwd: dir, env: { ...env, NAV_IDS: ids } });
        const draft = preparePrOpen(ws, { title });
        const content = newPrFile({
          title,
          author: currentAuthor(ws),
          created: FIXTURE_DATE,
          body,
          target: draft.target,
          source: draft.source,
          revisions: [draft.revision],
        });
        openPr(ws, { content, fallbackTitle: title }, { commit: true });
        run(dir, ["checkout", "--quiet", "main"]);
      },
    };
    return clone;
  };

  // The `.navbook/` skeleton is made once and pushed, so both clones start from
  // the same history — which is what makes their later pushes fast-forwards.
  const seed = makeClone("seed");
  seed.write(".navbook/issues/open/.gitkeep", "");
  seed.write(".navbook/issues/closed/.gitkeep", "");
  seed.write(".navbook/prs/open/.gitkeep", "");
  seed.write(".navbook/prs/merged/.gitkeep", "");
  seed.write(".navbook/prs/closed/.gitkeep", "");
  seed.commitAll("docs(navbook): initialise");
  if (!opts.noRemote) {
    const pushed = seed.git(["push", "--quiet", "origin", "main:main"]);
    if (pushed.code !== 0) throw new Error(`fixture push failed: ${pushed.stderr}`);
  }

  const server = opts.noRemote ? seed : makeClone("server");
  const peer = opts.noRemote ? seed : makeClone("peer");

  return {
    origin,
    server,
    peer,
    home,
    env,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Commit subjects on a ref of the bare origin, newest first. */
export function originSubjects(origin: string, ref = "main"): string[] {
  const result = spawnSync("git", ["log", "--format=%s", ref], {
    cwd: origin,
    encoding: "utf8",
  });
  return (result.stdout ?? "").split("\n").filter((line) => line !== "");
}
