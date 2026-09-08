/**
 * Assembling the server: the schema, the identity check, and the clone.
 *
 * Kept apart from `main.ts` so a test can start one in process, on an arbitrary
 * port, without going near `process.argv` or `process.exit`.
 */

import { createServer } from "node:http";
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
import type { Config } from "./config.ts";
import { makeGraphQLCtx } from "./context.ts";
import { AuthorCache } from "./people.ts";
import { makeSchema } from "./schema.ts";
import { RepoSync } from "./sync.ts";

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

export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const { config } = opts;
  const env = opts.env ?? process.env;
  const report = opts.report ?? (() => undefined);

  const { repoRoot, navDir, remote, identity } = checkRepo(config, env);
  if (remote === null) {
    report(`warning: no '${config.remote}' remote; running local-only, nothing will be pushed`);
  }

  const auth =
    opts.auth ??
    (await makeAuthenticator({
      issuer: config.issuer,
      audience: config.audience,
      ...(config.jwksUrl === undefined ? {} : { jwksUrl: config.jwksUrl }),
    }));

  const sync = new RepoSync({
    repoRoot,
    remote,
    pullIntervalMs: config.pullIntervalMs,
  });

  // One per process, beside the clone it describes: the history it walks is
  // this checkout's, and the committer it leaves out is this clone's own.
  const authors = new AuthorCache({ repoRoot, exclude: identity });

  const yoga = createYoga({
    schema: makeSchema(),
    graphiql: config.graphiql,
    // Authentication runs here rather than in a resolver, so an unusable token
    // is refused before any operation is planned — and so every field is
    // covered, including ones added later.
    context: async ({ request }) => {
      const viewer = await auth.verify(request.headers.get("authorization"));
      return makeGraphQLCtx({ viewer, config, sync, authors, env, navDir });
    },
  });

  const server = createServer(yoga);
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  return {
    port,
    localOnly: remote === null,
    async close() {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      // Stop accepting, then hang up the keep-alive connections that are not
      // mid-request; without this, `close` waits for clients that will never
      // send anything again.
      server.closeIdleConnections();
      await closed;
      // Never cut an operation in half: a mutation between its commit and its
      // push is the one moment the clone's state depends on finishing.
      await sync.drain();
    },
  };
}
