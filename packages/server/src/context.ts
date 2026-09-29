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
  type CommentScope,
  type CoreExtensions,
  type EntityRecord,
  type Identity,
  makeWsCtx,
  type Repo,
  type ReviewPolicyReading,
  readReviewPolicy,
  type WsCtx,
  withComments,
} from "@navbook/core";
import type { RevisionCache } from "./changes.ts";
import type { Config } from "./config.ts";
import type { AuthorCache } from "./people.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";
import type { RepoSync } from "./sync.ts";
import type { TreeCache } from "./trees.ts";

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
   * parent's transaction has already released it. Read without comments, which
   * are most of what a parse costs and which no link needs; a field that wants
   * an entity's asks {@link commented}.
   */
  repo(): Promise<Repo>;
  /**
   * The tree as it is now, kept as this request's `repo()`.
   *
   * For a root resolver whose fields go on to ask for the tree: it parses it
   * once, inside its own transaction, and the fields read that same parse
   * rather than making a second one after the lock has let go — which on a
   * large repository doubled what the request cost (#esqpmn7i), and could
   * describe a tree a write had moved in between. Call it only inside
   * `sync.read` or `sync.write`, where the tree is held still.
   *
   * `comments` says whose comments to read; the fields read the others through
   * {@link commented} if they need them.
   */
  loadRepo(comments: CommentScope): Repo;
  /**
   * The entity with its comments, read when the tree it came from left them out.
   *
   * Every resolver that reads an entity's comments goes through this, so a
   * record from a read without them answers with its comments, not with an
   * empty list. Read under the lock, at most once per record per request.
   */
  commented(entity: EntityRecord): Promise<EntityRecord>;
  /**
   * How this repository counts reviews (spec 02 §2.10), read at most once.
   *
   * Separate from `repo()` because most requests that need the policy do not
   * need the tree: a pull request read from a ref carries its own records, and
   * the policy is still the working tree's.
   */
  reviewPolicy(): Promise<ReviewPolicyReading>;
  /**
   * Drops the memo after a write, so a payload reads the tree it just made.
   * The trees remembered across requests go with it, for the same reason.
   */
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
  /**
   * What the loaded plugins registered.
   *
   * A plugin's own resolvers reach their settings and their services through
   * this, and every mutation emits its event through it (spec 06 §6.2).
   */
  plugins: PluginRuntime;
  /** Where to say what an operator should know: the server's log. */
  report: (line: string) => void;
}

export interface MakeContextOptions {
  viewer: Identity;
  config: Config;
  sync: RepoSync;
  authors: AuthorCache;
  revisions: RevisionCache;
  /** Parsed trees, remembered across requests against the commit they describe. */
  trees: TreeCache;
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
  /** What the loaded plugins registered (spec 02 §2.12). */
  ext?: CoreExtensions;
  /** The plugin runtime, for resolvers and the mutation event. */
  plugins: PluginRuntime;
  /** The server's log; nothing is said when it is omitted. */
  report?: (line: string) => void;
}

export function makeGraphQLCtx(opts: MakeContextOptions): GraphQLCtx {
  const ws = makeWsCtx({
    cwd: opts.config.repoPath,
    env: opts.env ?? process.env,
    identity: opts.viewer,
    ...(opts.navDir === undefined ? {} : { navDir: opts.navDir }),
    ...(opts.ext === undefined ? {} : { ext: opts.ext }),
  });

  // The promise is what is memoized, so several field resolvers asking at once
  // share one load rather than queueing one apiece behind the lock.
  let memo: Promise<Repo> | null = null;
  let policyMemo: Promise<ReviewPolicyReading> | null = null;
  const commentMemo = new WeakMap<EntityRecord, Promise<EntityRecord>>();
  return {
    viewer: opts.viewer,
    ws,
    plugins: opts.plugins,
    repo: () => (memo ??= opts.sync.locked(() => opts.trees.at(ws, "none"))),
    loadRepo: (comments) => {
      const repo = opts.trees.at(ws, comments);
      memo = Promise.resolve(repo);
      return repo;
    },
    commented: (entity) => {
      if (entity.commentsLoaded) return Promise.resolve(entity);
      let read = commentMemo.get(entity);
      if (!read) {
        read = opts.sync.locked(() => withComments(ws, entity));
        commentMemo.set(entity, read);
      }
      return read;
    },
    reviewPolicy: () => (policyMemo ??= opts.sync.locked(() => readReviewPolicy(ws))),
    invalidateRepo: () => {
      memo = null;
      opts.trees.invalidate();
      // The marker is a file like any other, so a write may have changed it.
      policyMemo = null;
    },
    sync: opts.sync,
    authors: opts.authors,
    revisions: opts.revisions,
    config: opts.config,
    report: opts.report ?? (() => undefined),
  };
}
