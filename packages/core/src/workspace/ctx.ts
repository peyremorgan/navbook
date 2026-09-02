/**
 * Per-invocation context: where the repository is, what time it is, where IDs
 * come from, and who is acting.
 *
 * This is the one place the conformance hooks `NAV_NOW` and `NAV_IDS` are
 * honored (see `doc/spec/fixtures/README.md`). Keeping them here means `core`
 * has no notion of testing and every operation is deterministic under fixtures.
 *
 * Nothing here knows how output is written or styled. The CLI adds streams and
 * colors on top (`cli/context.ts`); a server, whose "output" is a response,
 * uses this context unchanged.
 */

import { webcrypto } from "node:crypto";
import { mintId as coreMintId, isId, type RandomBytes } from "../core/id.ts";
import { toIsoSeconds } from "../core/time.ts";
import {
  AmbiguousNavRootError,
  DEFAULT_NAV_DIR,
  findRepo,
  type Identity,
  type RepoPaths,
  userIdentity,
} from "../git/repo.ts";
import { wsFail } from "./errors.ts";

export const NAV_NOW_ENV = "NAV_NOW";
export const NAV_IDS_ENV = "NAV_IDS";
export const NAV_ROOT_ENV = "NAV_ROOT";

export interface WsCtx {
  cwd: string;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  /** The Navbook directory's name relative to `repoRoot`, in POSIX form. */
  navDir: string;
  navRoot: string;
  hasNavbook: boolean;
  /** Current instant; fixed by `NAV_NOW` under the conformance suite. */
  now(): Date;
  /** Mint an ID that is not already present in `taken`. */
  mintId(taken?: ReadonlySet<string>): string;
  /** Who is acting: git's configured user, unless one was supplied. */
  identity(): Identity;
}

export interface MakeWsCtxOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Set false to tolerate not being in a repository, for commands that work
   * outside one. Discovery still runs; only its failure stops being fatal.
   */
  requireRepo?: boolean;
  /**
   * The Navbook directory to use, overriding both `NAV_ROOT` and discovery.
   *
   * For a caller that already knows the name — an embedder, or a test. It is
   * validated exactly as the environment variable is, so no caller can smuggle
   * in a name that later reaches git as a pathspec.
   */
  navDir?: string;
  /**
   * Who is acting, when that is not the local git user.
   *
   * The CLI never sets this — the committer is the author (spec 04 §4.2). A
   * server acting on behalf of a signed-in person does, so that `author:`
   * records the person rather than the machine account (spec 06 §6.2).
   */
  identity?: Identity;
}

const defaultRandomBytes: RandomBytes = (n) => webcrypto.getRandomValues(new Uint8Array(n));

export function makeWsCtx(opts: MakeWsCtxOptions = {}): WsCtx {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  const navDir = parseNavDir(opts.navDir ?? env[NAV_ROOT_ENV]);

  let paths: RepoPaths;
  try {
    paths = findRepo(cwd, navDir);
  } catch (error) {
    // An ambiguous root is fatal even for commands that tolerate not being in a
    // repository: guessing which directory was meant is exactly what must not
    // happen, and the fix is to name one.
    if (error instanceof AmbiguousNavRootError) {
      wsFail("ambiguous-root", error.message, [
        `set ${NAV_ROOT_ENV} to the one you mean, e.g. ${NAV_ROOT_ENV}=${error.candidates[0]}`,
      ]);
    }
    if (opts.requireRepo === false) {
      paths = {
        repoRoot: cwd,
        navDir: navDir ?? DEFAULT_NAV_DIR,
        navRoot: "",
        hasNavbook: false,
      };
    } else {
      wsFail("not-a-git-repo", error instanceof Error ? error.message : String(error));
    }
  }

  const fixedNow = parseFixedNow(env[NAV_NOW_ENV]);
  const scriptedIds = parseScriptedIds(env[NAV_IDS_ENV]);
  const given = opts.identity;
  let idCursor = 0;

  return {
    cwd,
    env,
    repoRoot: paths.repoRoot,
    navDir: paths.navDir,
    navRoot: paths.navRoot,
    hasNavbook: paths.hasNavbook,
    now: () => (fixedNow ? new Date(fixedNow) : new Date()),
    mintId(taken?: ReadonlySet<string>) {
      if (scriptedIds) {
        const next = scriptedIds[idCursor++];
        if (next === undefined) {
          wsFail("ids-exhausted", `${NAV_IDS_ENV} is exhausted after ${scriptedIds.length} id(s)`);
        }
        return next;
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        const id = coreMintId(defaultRandomBytes);
        if (!taken?.has(id)) return id;
      }
      /* c8 ignore next */
      wsFail("mint-failed", "could not mint a collision-free id");
    },
    identity: () => given ?? userIdentity(paths.repoRoot),
  };
}

/**
 * Validate a Navbook directory name.
 *
 * The value is not just a string: it is joined to the repository root as a
 * path, and it reaches git as a *pathspec* — `git ls-files -- <dir>` in doctor
 * and `git checkout <ref> -- <dir>/…` in the merge path. So anything git would
 * read as a wildcard, or the filesystem as an escape upwards, is refused here
 * rather than silently matching the wrong files later. Unset and empty mean the
 * same thing: fall back to discovery.
 */
function parseNavDir(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const dir = value.trim();
  if (dir === "") return undefined;

  const bad = (reason: string): never => wsFail("bad-env", `${NAV_ROOT_ENV} ${reason}: ${value}`);

  if (hasControlChar(dir)) bad("contains a control character");
  if (dir.includes("\\")) bad("must separate segments with '/'");
  if (dir.startsWith("/") || /^[A-Za-z]:/.test(dir)) {
    bad("must be relative to the repository root");
  }
  if (/[*?[\]]/.test(dir) || dir.startsWith(":")) bad("must not contain pathspec magic");
  for (const segment of dir.split("/")) {
    if (segment === "") bad("must not have an empty path segment");
    if (segment === "." || segment === "..") bad("must not contain '.' or '..'");
    if (segment === ".git") bad("must not name the git directory");
  }
  return dir;
}

/** True when any character would be illegible in a path or a git argument. */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function parseFixedNow(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    wsFail("bad-env", `${NAV_NOW_ENV} is not a valid timestamp: ${value}`);
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
    if (!isId(id)) wsFail("bad-env", `${NAV_IDS_ENV} contains an invalid id: ${id}`);
  }
  return ids;
}

/** The current instant as an ISO 8601 string with second precision. */
export function nowIso(ws: WsCtx): string {
  return toIsoSeconds(ws.now());
}

/** Author string for the acting identity, in the form `Name <email>`. */
export function currentAuthor(ws: WsCtx): string {
  const identity = ws.identity();
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}
