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

import {
  type Identity,
  loadRepo,
  makeWsCtx,
  type Repo,
  type ReviewPolicyReading,
  readReviewPolicy,
  type WsCtx,
} from "@navbook/core";
import type { RevisionCache } from "./changes.ts";
import type { Config } from "./config.ts";
import type { AuthorCache } from "./people.ts";
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
  /**
   * How this repository counts reviews (spec 02 §2.10), read at most once.
   *
   * Separate from `repo()` because most requests that need the policy do not
   * need the tree: a pull request read from a ref carries its own records, and
   * the policy is still the working tree's.
   */
  reviewPolicy(): Promise<ReviewPolicyReading>;
  /** Drops the memo after a write, so a payload reads the tree it just made. */
  invalidateRepo(): void;
  sync: RepoSync;
  /**
   * The authors of the history, remembered across requests rather than within
   * one: unlike the tree, it changes only when a commit lands.
   */
  authors: AuthorCache;
  /**
   * What each pull request revision changes, remembered across requests:
   * two SHAs name an answer that never changes.
   */
  revisions: RevisionCache;
  config: Config;
}

export interface MakeContextOptions {
  viewer: Identity;
  config: Config;
  sync: RepoSync;
  authors: AuthorCache;
  revisions: RevisionCache;
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
  let policyMemo: Promise<ReviewPolicyReading> | null = null;
  return {
    viewer: opts.viewer,
    ws,
    repo: () => (memo ??= opts.sync.locked(() => loadRepo(ws))),
    reviewPolicy: () => (policyMemo ??= opts.sync.locked(() => readReviewPolicy(ws))),
    invalidateRepo: () => {
      memo = null;
      // The marker is a file like any other, so a write may have changed it.
      policyMemo = null;
    },
    sync: opts.sync,
    authors: opts.authors,
    revisions: opts.revisions,
    config: opts.config,
  };
}
