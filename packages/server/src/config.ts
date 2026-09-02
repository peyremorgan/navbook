/**
 * What the server needs to be told before it can start.
 *
 * Every setting has a flag and an environment variable, because the two ways a
 * server is actually configured are a command line and a container. Flags win
 * when both are given.
 *
 * Authentication is not optional: there is no flag that turns it off. A
 * deployment that wants an unauthenticated tracker can put one in front; a test
 * runs its own issuer (see `test/helpers/oidc.ts`).
 */

import { parseArgs } from "node:util";

export interface Config {
  /** The checkout the server operates on. */
  repoPath: string;
  port: number;
  /** OIDC issuer whose tokens are accepted. */
  issuer: string;
  /** The `aud` claim tokens must carry. */
  audience: string;
  /** JWKS endpoint; discovered from the issuer when not given. */
  jwksUrl?: string;
  /** Remote to synchronise with; local-only when the repository has none. */
  remote: string;
  /** How stale a read may let its view of the remote become, in milliseconds. */
  pullIntervalMs: number;
  graphiql: boolean;
}

export class ConfigError extends Error {}

const OPTIONS = {
  repo: { type: "string" },
  port: { type: "string" },
  "oidc-issuer": { type: "string" },
  "oidc-audience": { type: "string" },
  "oidc-jwks-url": { type: "string" },
  remote: { type: "string" },
  "pull-interval-ms": { type: "string" },
  "no-graphiql": { type: "boolean" },
  help: { type: "boolean" },
} as const;

export const USAGE = `Usage: nav-server [options]

  --repo <path>              checkout to serve (default: the working directory)
  --port <n>                 port to listen on, 0 for any free one (default: 4000)
  --oidc-issuer <url>        issuer whose tokens are accepted (required)
  --oidc-audience <aud>      audience tokens must carry (required)
  --oidc-jwks-url <url>      JWKS endpoint (default: discovered from the issuer)
  --remote <name>            remote to synchronise with (default: origin)
  --pull-interval-ms <n>     how stale a read may be (default: 10000)
  --no-graphiql              do not serve the GraphiQL explorer

Every option can also be given as an environment variable: --oidc-issuer is
NAV_SERVER_OIDC_ISSUER, and so on. Flags win over the environment.`;

export interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  help: boolean;
}

/** Parse argv, reporting a bad flag as a {@link ConfigError}. */
export function parseServerArgs(argv: readonly string[]): ParsedArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false }));
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
  return { values, help: values.help === true };
}

export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[]): Config {
  const { values } = parseServerArgs(argv);

  const read = (flag: string, variable: string): string | undefined => {
    const given = values[flag];
    if (typeof given === "string" && given !== "") return given;
    const fromEnv = env[variable];
    return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
  };
  const require = (flag: string, variable: string): string => {
    const value = read(flag, variable);
    if (value === undefined) {
      throw new ConfigError(`missing required option --${flag} (or ${variable})`);
    }
    return value;
  };

  const jwksUrl = read("oidc-jwks-url", "NAV_SERVER_OIDC_JWKS_URL");
  return {
    repoPath: read("repo", "NAV_SERVER_REPO") ?? process.cwd(),
    port: wholeNumber(read("port", "NAV_SERVER_PORT") ?? "4000", "--port"),
    issuer: require("oidc-issuer", "NAV_SERVER_OIDC_ISSUER"),
    audience: require("oidc-audience", "NAV_SERVER_OIDC_AUDIENCE"),
    ...(jwksUrl === undefined ? {} : { jwksUrl }),
    remote: read("remote", "NAV_SERVER_REMOTE") ?? "origin",
    pullIntervalMs: wholeNumber(
      read("pull-interval-ms", "NAV_SERVER_PULL_INTERVAL_MS") ?? "10000",
      "--pull-interval-ms",
    ),
    graphiql: values["no-graphiql"] !== true && env.NAV_SERVER_GRAPHIQL !== "false",
  };
}

function wholeNumber(value: string, what: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`${what} takes a whole number, got '${value}'`);
  }
  return parsed;
}
