/**
 * The whole thing, running, for one test run.
 *
 * A fixture repository with an origin to push to, an identity provider, a real
 * `nav-server`, and the built bundle served as static files. Nothing is mocked
 * and nothing is stubbed: the point of this suite is to prove that a browser,
 * an OIDC flow, a GraphQL API and a git repository work together, and every
 * one of those substituted for a fake would be a thing not proved.
 *
 * The bundle is served from a copy with its `config.json` rewritten, because
 * the ports are ephemeral. Serving what `nuxi generate` actually produced —
 * rather than a dev server — is deliberate: it is what gets deployed, and the
 * SPA fallback that a bookmarked deep link depends on only exists there.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { type DevIssuer, startDevIssuer } from "../../script/dev-issuer.ts";
import { createFixtureRepo, type FixtureRepo } from "../../script/fixture-repo.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const PACKAGE_ROOT = resolve(HERE, "..", "..");
const BUNDLE = join(PACKAGE_ROOT, ".output", "public");
const SERVER_ENTRY = join(PACKAGE_ROOT, "..", "server", "src", "main.ts");

export interface Stack {
  /** Where the browser should go. */
  appUrl: string;
  issuer: DevIssuer;
  repo: FixtureRepo;
  apiUrl: string;
  /** Everything the API server wrote to stderr, for diagnosing a failure. */
  serverErrors(): string;
  stop(): Promise<void>;
}

const AUDIENCE = "navbook";

export interface StackOptions {
  /**
   * How long an access token lasts.
   *
   * The default is an hour, as a provider's would be. A spec that wants to
   * watch the client renew one asks for a few seconds instead — otherwise
   * renewal is a path no test ever takes, and the first anybody would hear of
   * it being broken is an hour into somebody's afternoon.
   */
  tokenLifetimeSeconds?: number;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  if (!existsSync(join(BUNDLE, "index.html"))) {
    throw new Error(
      `no bundle at ${BUNDLE}. Run \`pnpm --filter @navbook/web build\` before the end-to-end suite.`,
    );
  }

  const repo = createFixtureRepo();
  // localhost throughout: a token's `iss` claim is compared as a string, so
  // the issuer has to call itself what the browser and the server call it.
  const issuer = await startDevIssuer({
    port: 0,
    audience: AUDIENCE,
    hostname: "localhost",
    ...(options.tokenLifetimeSeconds === undefined
      ? {}
      : { lifetimeSeconds: options.tokenLifetimeSeconds }),
  });

  const server = spawn(
    process.execPath,
    [
      SERVER_ENTRY,
      "--repo",
      repo.dir,
      "--port",
      "0",
      "--oidc-issuer",
      issuer.issuer,
      "--oidc-audience",
      AUDIENCE,
      "--oidc-jwks-url",
      `${issuer.issuer}/jwks`,
      // Every read fetches, so a change made through one request is visible to
      // the next without waiting out a staleness window.
      "--pull-interval-ms",
      "0",
      "--no-graphiql",
    ],
    { env: { ...repo.env, PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] },
  );

  let errors = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk: string) => {
    errors += chunk;
  });

  const apiPort = await readyPort(server, () => errors);
  const apiUrl = `http://localhost:${apiPort}/graphql`;

  const { url: appUrl, close: closeStatic } = await serveBundle({
    graphqlUrl: apiUrl,
    oidc: { issuer: issuer.issuer, clientId: "navbook-web", audience: AUDIENCE },
  });

  return {
    appUrl,
    apiUrl,
    issuer,
    repo,
    serverErrors: () => errors,
    async stop() {
      await closeStatic();
      if (server.exitCode === null) {
        const exited = new Promise<void>((done) => server.once("exit", () => done()));
        server.kill("SIGTERM");
        await exited;
      }
      await issuer.close();
      repo.cleanup();
    },
  };
}

type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

/** The port from the readiness line, or whatever the server died complaining of. */
function readyPort(child: ServerProcess, errors: () => string): Promise<number> {
  return new Promise((done, fail) => {
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      const match = /listening on http:\/\/localhost:(\d+)/.exec(out);
      if (match) done(Number(match[1]));
    });
    child.once("exit", (code) => {
      fail(new Error(`nav-server exited with ${code} before listening:\n${errors()}`));
    });
  });
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * Serve the generated bundle, with the run's addresses written into it.
 *
 * The copy is what makes the ports ephemeral: `config.json` is the one file a
 * deployment overwrites, so overwriting it is exactly what a deployment does.
 * Unknown paths fall back to `200.html`, which is the SPA fallback `nuxi
 * generate` emits and the reason a deep link survives a reload.
 */
async function serveBundle(config: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), "navbook-bundle-"));
  cpSync(BUNDLE, root, { recursive: true });
  writeFileSync(join(root, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const fallback = join(root, "200.html");
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    // Resolved and checked, so a `..` in the request cannot escape the copy.
    const wanted = normalize(join(root, path));
    const file =
      (wanted === root || wanted.startsWith(root + sep)) && existsSync(wanted) && extname(wanted)
        ? wanted
        : fallback;
    try {
      const body = readFileSync(file);
      response
        .writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
        })
        .end(body);
    } catch {
      response.writeHead(404).end();
    }
  });

  // Awaited: `address()` reports nothing until the socket is actually bound,
  // and a port of 0 is one the browser refuses outright.
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("the static server bound no port");
  }
  const port = address.port;

  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => {
          rmSync(root, { recursive: true, force: true });
          done();
        });
      }),
  };
}
