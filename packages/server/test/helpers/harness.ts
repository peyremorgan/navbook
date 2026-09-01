/**
 * One running server, its clone, and its issuer.
 *
 * The server is spawned rather than started in process, which is what the CLI
 * suite does and for the same reason: git reads dates and identity from the
 * process environment, so only a child process can have them pinned. It also
 * makes these genuinely black-box — nothing is proved about a path a client
 * could not reach.
 *
 * The stub issuer runs here in the test process; the server fetches its keys
 * over HTTP exactly as it would from a real provider.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { AUDIENCE, type SignOptions, type StubIssuer, startStubIssuer } from "./oidc.ts";
import { type Fixture, type FixtureOptions, makeFixture, serverCommand } from "./temprepo.ts";

export interface GraphQLResponse<T = Record<string, unknown>> {
  status: number;
  data: T | null;
  errors: { message: string; extensions?: Record<string, unknown> }[];
}

export interface Harness {
  fixture: Fixture;
  issuer: StubIssuer;
  port: number;
  /** Everything the server has written to stderr, for startup assertions. */
  stderr(): string;
  /** A signed token; the default one carries a name and an email. */
  token(opts?: SignOptions): Promise<string>;
  /** Send an operation, authenticated with the default token unless told otherwise. */
  gql<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    auth?: string | null,
  ): Promise<GraphQLResponse<T>>;
  stop(): Promise<void>;
}

export interface HarnessOptions extends FixtureOptions {
  /** How stale a read may be; 0 makes every read fetch, as the sync tests need. */
  pullIntervalMs?: number;
  /** Discover the JWKS through the issuer rather than being told where it is. */
  discover?: boolean;
  /** Set the clone up before the server is started, e.g. onto another branch. */
  prepare?: (fixture: Fixture) => void;
  /** Serve the GraphiQL explorer, as a default deployment does. */
  graphiql?: boolean;
}

/** Start a server, or report why it would not start. */
export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const fixture = makeFixture(opts);
  opts.prepare?.(fixture);
  const issuer = await startStubIssuer();

  const [command, ...leading] = serverCommand();
  const child = spawn(
    command as string,
    [
      ...leading,
      "--repo",
      fixture.server.dir,
      "--port",
      "0",
      "--oidc-issuer",
      issuer.issuer,
      "--oidc-audience",
      AUDIENCE,
      ...(opts.discover ? [] : ["--oidc-jwks-url", issuer.jwksUrl]),
      "--pull-interval-ms",
      String(opts.pullIntervalMs ?? 0),
      ...(opts.graphiql ? [] : ["--no-graphiql"]),
    ],
    { env: fixture.env, stdio: ["ignore", "pipe", "pipe"] },
  );

  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    errors += chunk;
  });

  const port = await readyPort(child, () => errors);
  const defaultToken = await issuer.sign({ name: "A Person", email: "person@example.invalid" });

  const stop = async (): Promise<void> => {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await exited;
    }
    await issuer.close();
    fixture.cleanup();
  };

  return {
    fixture,
    issuer,
    port,
    stderr: () => errors,
    token: (signOpts) => issuer.sign(signOpts),
    async gql(query, variables, auth) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const bearer = auth === undefined ? defaultToken : auth;
      if (bearer !== null) headers.authorization = `Bearer ${bearer}`;

      const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
      });
      const body = (await response.json()) as {
        data?: unknown;
        errors?: { message: string; extensions?: Record<string, unknown> }[];
      };
      return {
        status: response.status,
        data: (body.data ?? null) as never,
        errors: body.errors ?? [],
      };
    },
    stop,
  };
}

/** The server as spawned: stdin closed, both output streams piped. */
type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

/** The port from the readiness line, or whatever the server died complaining of. */
function readyPort(child: ServerProcess, errors: () => string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      const match = /listening on http:\/\/localhost:(\d+)/.exec(out);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", (code) => {
      reject(new Error(`nav-server exited with ${code} before listening:\n${errors()}`));
    });
  });
}

/** The first error's `extensions.code`, or null when the operation succeeded. */
export function errorCode(response: GraphQLResponse<unknown>): string | null {
  const code = response.errors[0]?.extensions?.code;
  return typeof code === "string" ? code : null;
}

/** Assert an operation succeeded, and return its data. */
export function ok<T>(response: GraphQLResponse<T>): T {
  if (response.errors.length > 0 || response.data === null) {
    throw new Error(`operation failed: ${JSON.stringify(response.errors)}`);
  }
  return response.data;
}
