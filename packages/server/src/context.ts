/**
 * What a resolver is given.
 *
 * The CLI extends the workspace context with streams and colors; a server
 * extends it with who is asking and how to reach the clone. Both leave the
 * context itself — where the repository is, what time it is, where IDs come
 * from — exactly as `core` defines it, which is what makes `NAV_NOW` and
 * `NAV_IDS` work here for free.
 *
 * A fresh context per request is the point rather than an overhead: it is what
 * carries the signed-in person's identity into `author:` (spec 06 §6.2).
 */

import { type Identity, loadRepo, makeWsCtx, type Repo, type WsCtx } from "@navbook/core";
import type { Config } from "./config.ts";
import type { RepoSync } from "./sync.ts";

export interface GraphQLCtx {
  /** Who the presented token says is acting. */
  viewer: Identity;
  ws: WsCtx;
  /**
   * The parsed tree, read at most once per request.
   *
   * Link fields resolve against the whole tree, and a subtask forest asks for
   * it at every node; parsing it per node would make rendering one issue cost
   * as much as rendering the repository.
   *
   * Read under the repository lock, because a field resolver runs after its
   * parent's transaction has already released it.
   */
  repo(): Promise<Repo>;
  /** Drops the memo after a write, so a payload reads the tree it just made. */
  invalidateRepo(): void;
  sync: RepoSync;
  config: Config;
}

export interface MakeContextOptions {
  viewer: Identity;
  config: Config;
  sync: RepoSync;
  env?: NodeJS.ProcessEnv;
  /**
   * The Navbook directory, already resolved at startup.
   *
   * Passed in rather than rediscovered: a context is built per request, and a
   * directory found by searching would otherwise repeat that search — a
   * `git ls-files` per request for a root nested too deep to scan for. It also
   * guarantees every request agrees with the tree startup actually validated.
   */
  navDir?: string;
}

export function makeGraphQLCtx(opts: MakeContextOptions): GraphQLCtx {
  const ws = makeWsCtx({
    cwd: opts.config.repoPath,
    env: opts.env ?? process.env,
    identity: opts.viewer,
    ...(opts.navDir === undefined ? {} : { navDir: opts.navDir }),
  });

  // The promise is what is memoized, so several field resolvers asking at once
  // share one load rather than queueing one apiece behind the lock.
  let memo: Promise<Repo> | null = null;
  return {
    viewer: opts.viewer,
    ws,
    repo: () => (memo ??= opts.sync.locked(() => loadRepo(ws))),
    invalidateRepo: () => {
      memo = null;
    },
    sync: opts.sync,
    config: opts.config,
  };
}
