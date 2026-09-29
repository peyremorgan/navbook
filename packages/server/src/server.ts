/**
 * Assembling the server: the schema, the identity check, and the clone.
 *
 * Kept apart from `main.ts` so a test can start one in process, on an arbitrary
 * port, without going near `process.argv` or `process.exit`.
 */

import { createServer, type Server } from "node:http";
import {
  currentBranch,
  hasRemote,
  type Identity,
  isTreeClean,
  makeWsCtx,
  userIdentity,
  WorkspaceError,
} from "@navbook/core";
import { createYoga } from "graphql-yoga";
import { type Authenticator, makeAuthenticator } from "./auth.ts";
import { RevisionCache } from "./changes.ts";
import type { Config } from "./config.ts";
import { makeGraphQLCtx } from "./context.ts";
import { clearLeftovers, clearLeftoversAtStart, gitDirs } from "./leftovers.ts";
import { Maintenance } from "./maintenance.ts";
import { AuthorCache } from "./people.ts";
import { type LoadedPlugins, loadServerPlugins } from "./plugins/load.ts";
import { resolveServerPlugins } from "./plugins/resolve.ts";
import { isOpen } from "./policy.ts";
import { makeSchema } from "./schema.ts";
import { RepoSync } from "./sync.ts";
import { TreeCache } from "./trees.ts";
import { sweepTemporaryWorktrees } from "./write-site.ts";

export class StartupError extends Error {}

export interface ServerHandle {
  /** The port actually bound, which matters when the config asked for 0. */
  port: number;
  /** True when the repository has no remote and nothing is pushed. */
  localOnly: boolean;
  close(): Promise<void>;
}

export interface StartOptions {
  config: Config;
  env?: NodeJS.ProcessEnv;
  /** Key source, injected by tests that run their own issuer. */
  auth?: Authenticator;
  /** Told the port once bound, and anything worth saying at startup. */
  report?: (line: string) => void;
}

/**
 * Check the clone can actually serve requests, before anything is accepted.
 *
 * Each of these would otherwise surface as a puzzling failure on somebody's
 * first mutation, long after the deployment that caused it.
 */
function checkRepo(
  config: Config,
  env: NodeJS.ProcessEnv,
): { repoRoot: string; navDir: string; remote: string | null; identity: Identity } {
  let ws: ReturnType<typeof makeWsCtx>;
  try {
    ws = makeWsCtx({ cwd: config.repoPath, env });
  } catch (error) {
    throw new StartupError(error instanceof WorkspaceError ? error.message : String(error));
  }
  if (!ws.hasNavbook) {
    throw new StartupError(`${config.repoPath} is not a Navbook repository (no ${ws.navDir}/)`);
  }
  if (currentBranch(ws.repoRoot) === null) {
    throw new StartupError("HEAD is detached; check out the branch the server should serve");
  }
  // Every mutation commits, and --commit refuses to run while unrelated work is
  // staged (spec 04 §4.2). A dirty clone would therefore fail every write.
  if (!isTreeClean(ws.repoRoot)) {
    throw new StartupError("the clone has uncommitted changes; the server needs a clean tree");
  }
  let identity: Identity;
  try {
    identity = userIdentity(ws.repoRoot);
  } catch (error) {
    throw new StartupError(
      `the clone has no committer identity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    repoRoot: ws.repoRoot,
    navDir: ws.navDir,
    remote: hasRemote(ws.repoRoot, config.remote) ? config.remote : null,
    identity,
  };
}

/**
 * Start a server on the clone `config` names.
 *
 * It runs git's housekeeping on the clone itself (`maintenance.ts`), and
 * expects git not to start its own: `main.ts` sets `maintenance.auto=false`
 * for every git the process runs, before calling this. A process that embeds
 * the server does the same (`disableAutoMaintenance`), or gets both — and a
 * detached run of git's may be cut off when the process ends.
 */
export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const { config } = opts;
  const env = opts.env ?? process.env;
  const report = opts.report ?? (() => undefined);
  // What the clone held before this server started is what an earlier one left.
  const startedAt = Date.now();

  const { repoRoot, navDir, remote, identity } = checkRepo(config, env);
  const dirs = gitDirs(repoRoot);
  // Before any git of this server's runs: a stale `packed-refs.lock` would fail
  // its first fetch. Only when the server owns housekeeping — otherwise
  // whatever does may be running beside it, holding the very same lock.
  clearLeftoversAtStart(dirs, repoRoot, {
    before: startedAt,
    remove: config.maintenanceIntervalMs > 0,
    report,
  });
  // A temporary worktree is only ever one write's, so any that exists now was
  // left by a server that was killed mid-write.
  sweepTemporaryWorktrees(repoRoot, report);
  if (remote === null) {
    report(`warning: no '${config.remote}' remote; running local-only, nothing will be pushed`);
  }
  // A choice worth seeing made: nothing packs the clone unless something else does.
  if (config.maintenanceIntervalMs === 0) {
    report(
      "warning: --maintenance-interval-ms is 0; the server runs no git maintenance on the clone, " +
        "so run `git maintenance run --auto` there from somewhere else",
    );
  }

  // An open deployment is a choice worth seeing made: with a shared provider
  // it means everybody that provider knows, and nothing else would say so.
  if (isOpen(config.policy)) {
    report(
      `warning: no authorization policy; every token the provider signs for '${config.audience}' may read and write`,
    );
  }

  const auth =
    opts.auth ??
    (await makeAuthenticator({
      provider: config.provider,
      audience: config.audience,
      policy: config.policy,
      // Which rule refused whom is the operator's to know and the client's not to.
      report,
    }));

  // One per process, beside the clone it describes, for `AuthorCache`'s reason.
  const trees = new TreeCache({ repoRoot, navDir, intervalMs: config.pullIntervalMs, report });
  const maintenance = new Maintenance({
    repoRoot,
    intervalMs: config.maintenanceIntervalMs,
    report,
    // A run that ran out of time goes while the server carries on, and a
    // fetch writes the same kind of temporary file: clear up only when no git
    // of the server's can be writing one.
    tidy: (since) =>
      sync.exclusive(() => clearLeftovers(dirs, repoRoot, { since, remove: true, report })),
  });
  const sync = new RepoSync({
    repoRoot,
    remote,
    pullIntervalMs: config.pullIntervalMs,
    gitTimeoutMs: config.gitTimeoutMs,
    // A stopped fetch or push is the operator's news as much as the client's.
    report,
    onWrite: () => trees.invalidate(),
    afterSync: () => maintenance.request(),
  });

  // One per process, beside the clone it describes: the history it walks is
  // this checkout's, and the committer it leaves out is this clone's own.
  const authors = new AuthorCache({ repoRoot, exclude: identity });
  // Likewise one per process: a revision's diff is the same for everybody.
  const revisions = new RevisionCache({ repoRoot, navDir });

  // Plugins before the schema, because the schema is partly theirs. A fault in
  // any of this is a StartupError, reported by `main` and fatal: see
  // `plugins/resolve.ts` for why a server refuses where the CLI carries on.
  let loaded: LoadedPlugins;
  try {
    loaded = await loadServerPlugins({
      plugins: resolveServerPlugins(makeWsCtx({ cwd: config.repoPath, env }), env),
      config,
      env,
      sync,
      authors,
      report,
    });
  } catch (error) {
    throw new StartupError(error instanceof Error ? error.message : String(error));
  }

  const yoga = createYoga({
    schema: makeSchema({ typeDefs: loaded.typeDefs, resolvers: loaded.runtime.resolvers }),
    graphiql: config.graphiql,
    // Authentication runs here rather than in a resolver, so an unusable token
    // is refused before any operation is planned — and so every field is
    // covered, including ones added later.
    context: async ({ request }) => {
      const viewer = await auth.verify(request.headers.get("authorization"));
      return makeGraphQLCtx({
        viewer,
        config,
        sync,
        authors,
        revisions,
        trees,
        env,
        navDir,
        ext: loaded.ext,
        plugins: loaded.runtime,
        report,
      });
    },
  });

  // Services start before the port opens: a bridge that has not connected is
  // not ready to be told about a mutation, and one that cannot start is a
  // deployment fault rather than something to discover later (spec 06 §6.2).
  await loaded.runtime.start();

  // The background pull and the tree watchdog start last, once nothing left
  // can refuse to start: a plugin that failed above would otherwise leave
  // both running behind a server that never opened its port.
  trees.start();
  sync.start();

  /**
   * Stop everything started above, once nothing can reach it any more.
   *
   * Services stop before the clone settles: one of them may still be holding
   * a socket that would deliver a message nothing is left to handle. Then the
   * clone is never cut off mid-operation: a mutation between its commit and
   * its push is the one moment the clone's state depends on finishing.
   * `housekeeping` is maintenance already told to stop, whose budget runs
   * beside everything here rather than after it.
   */
  const release = async (housekeeping: Promise<void>): Promise<void> => {
    await loaded.runtime.stop();
    await sync.stop();
    await trees.stop();
    await Promise.all([sync.drain(), housekeeping]);
  };

  const server = createServer(yoga);
  try {
    await listen(server, config.port);
  } catch (error) {
    // A port already taken, or one this process may not bind, is a deployment
    // fault like any other above, and is said the same way. Left to itself it
    // was an uncaught exception, after the services, the background pull and
    // the watchdog had all started, with nothing to stop them on the way out.
    await release(maintenance.stop());
    throw new StartupError(
      `could not listen on port ${config.port}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  return {
    port,
    localOnly: remote === null,
    async close() {
      // At once, so its budget runs beside everything below rather than after it.
      const housekeeping = maintenance.stop();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      // Stop accepting, then hang up the keep-alive connections that are not
      // mid-request; without this, `close` waits for clients that will never
      // send anything again.
      server.closeIdleConnections();
      await closed;
      await release(housekeeping);
    },
  };
}

/**
 * Open the port, or reject with why not.
 *
 * `listen` reports a failure as an 'error' event rather than to its callback,
 * and an 'error' nobody listens for is thrown from wherever the event loop
 * happens to be. Only the first attempt's failure is this function's: once
 * listening, the handler goes, and whatever the server says later is its own.
 */
function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
