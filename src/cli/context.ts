/**
 * Per-invocation context: where the repository is, what time it is, where IDs
 * come from, and how output is styled.
 *
 * This is the one place the conformance hooks `NAV_NOW` and `NAV_IDS` are
 * honored (see `doc/spec/fixtures/README.md`). Keeping them here means `core`
 * has no notion of testing and every command is deterministic under fixtures.
 */

import { webcrypto } from "node:crypto";
import { mintId as coreMintId, isId, type RandomBytes } from "../core/id.ts";
import { toIsoSeconds } from "../core/time.ts";
import { findRepo, type Identity, type RepoPaths, userIdentity } from "../git/repo.ts";
import { NavError } from "./errors.ts";
import { type Colors, makeColors } from "./render/colors.ts";

export const NAV_NOW_ENV = "NAV_NOW";
export const NAV_IDS_ENV = "NAV_IDS";

export interface Ctx {
  cwd: string;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  navRoot: string;
  hasNavbook: boolean;
  colors: Colors;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  /** Current instant; fixed by `NAV_NOW` under the conformance suite. */
  now(): Date;
  /** Mint an ID that is not already present in `taken`. */
  mintId(taken?: ReadonlySet<string>): string;
  /** Committer identity from git config. */
  identity(): Identity;
}

export interface MakeContextOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  /** Skip repository discovery, for commands that work outside a repository. */
  requireRepo?: boolean;
}

const defaultRandomBytes: RandomBytes = (n) => webcrypto.getRandomValues(new Uint8Array(n));

export function makeContext(opts: MakeContextOptions = {}): Ctx {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  let paths: RepoPaths;
  try {
    paths = findRepo(cwd);
  } catch (error) {
    if (opts.requireRepo === false) {
      paths = { repoRoot: cwd, navRoot: "", hasNavbook: false };
    } else {
      throw new NavError(error instanceof Error ? error.message : String(error));
    }
  }

  const fixedNow = parseFixedNow(env[NAV_NOW_ENV]);
  const scriptedIds = parseScriptedIds(env[NAV_IDS_ENV]);
  let idCursor = 0;

  return {
    cwd,
    env,
    repoRoot: paths.repoRoot,
    navRoot: paths.navRoot,
    hasNavbook: paths.hasNavbook,
    colors: makeColors(stdout, env),
    stdout,
    stderr,
    now: () => (fixedNow ? new Date(fixedNow) : new Date()),
    mintId(taken?: ReadonlySet<string>) {
      if (scriptedIds) {
        const next = scriptedIds[idCursor++];
        if (next === undefined) {
          throw new NavError(`${NAV_IDS_ENV} is exhausted after ${scriptedIds.length} id(s)`);
        }
        return next;
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        const id = coreMintId(defaultRandomBytes);
        if (!taken?.has(id)) return id;
      }
      /* c8 ignore next */
      throw new NavError("could not mint a collision-free id");
    },
    identity: () => userIdentity(paths.repoRoot),
  };
}

function parseFixedNow(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NavError(`${NAV_NOW_ENV} is not a valid timestamp: ${value}`);
  }
  return date;
}

function parseScriptedIds(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  for (const id of ids) {
    if (!isId(id)) throw new NavError(`${NAV_IDS_ENV} contains an invalid id: ${id}`);
  }
  return ids;
}

/** The current instant as an ISO 8601 string with second precision. */
export function nowIso(ctx: Ctx): string {
  return toIsoSeconds(ctx.now());
}
