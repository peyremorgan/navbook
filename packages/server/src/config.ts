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
import type { OidcProvider } from "./auth.ts";
import {
  type AuthPolicy,
  type ClaimRequirement,
  normalizeDomain,
  parseClaimRequirement,
} from "./policy.ts";

export interface Config {
  /** The checkout the server operates on. */
  repoPath: string;
  port: number;
  /** The OIDC provider whose tokens are accepted. */
  provider: OidcProvider;
  /** The `aud` claim tokens must carry. */
  audience: string;
  /** Who, among the people the provider vouches for, is allowed in. */
  policy: AuthPolicy;
  /** Remote to synchronise with; local-only when the repository has none. */
  remote: string;
  /** How stale a read may let its view of the remote become, in milliseconds. */
  pullIntervalMs: number;
  /** How long a fetch or push may take before it is stopped, in milliseconds; 0 never stops one. */
  gitTimeoutMs: number;
  graphiql: boolean;
}

export class ConfigError extends Error {}

const OPTIONS = {
  repo: { type: "string" },
  port: { type: "string" },
  "oidc-discovery-url": { type: "string" },
  "oidc-issuer": { type: "string" },
  "oidc-jwks-url": { type: "string" },
  "oidc-audience": { type: "string" },
  "require-claim": { type: "string", multiple: true },
  "allow-email-domain": { type: "string", multiple: true },
  "require-email-verified": { type: "boolean" },
  remote: { type: "string" },
  "pull-interval-ms": { type: "string" },
  "git-timeout-ms": { type: "string" },
  "no-graphiql": { type: "boolean" },
  help: { type: "boolean" },
} as const;

export const USAGE = `Usage: nav-server [options]

  --repo <path>              checkout to serve (default: the working directory)
  --port <n>                 port to listen on, 0 for any free one (default: 4000)
  --oidc-discovery-url <url> the provider's discovery document, which names
                             the issuer and its keys (required, unless the
                             next two are given instead)
  --oidc-issuer <url>        issuer whose tokens are accepted
  --oidc-jwks-url <url>      its JWKS endpoint; together with --oidc-issuer,
                             for a provider the server cannot discover
  --oidc-audience <aud>      audience tokens must carry (required)
  --require-claim <name>=<value>
                             only admit a token whose claim carries the value;
                             repeatable, and every one must hold
  --allow-email-domain <domain>
                             only admit an email under this domain; repeatable
  --require-email-verified   only admit a token whose email_verified is true
  --remote <name>            remote to synchronise with (default: origin)
  --pull-interval-ms <n>     how stale a read may be (default: 10000)
  --git-timeout-ms <n>       how long a fetch or push may take, 0 for as long
                             as git allows (default: 30000)
  --no-graphiql              do not serve the GraphiQL explorer

Every option can also be given as an environment variable: --oidc-audience is
NAV_SERVER_OIDC_AUDIENCE, and so on. Flags win over the environment. The
repeatable options are comma-separated there: NAV_SERVER_REQUIRE_CLAIMS and
NAV_SERVER_ALLOW_EMAIL_DOMAINS; NAV_SERVER_REQUIRE_EMAIL_VERIFIED=true is the
boolean. With no policy at all, every token the provider signs for the
audience may read and write.`;

export interface ParsedArgs {
  values: Record<string, string | string[] | boolean | undefined>;
  help: boolean;
}

/** Parse argv, reporting a bad flag as a {@link ConfigError}. */
export function parseServerArgs(argv: readonly string[]): ParsedArgs {
  let values: Record<string, string | string[] | boolean | undefined>;
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

  return {
    repoPath: read("repo", "NAV_SERVER_REPO") ?? process.cwd(),
    port: wholeNumber(read("port", "NAV_SERVER_PORT") ?? "4000", "--port"),
    provider: provider(read),
    audience: require("oidc-audience", "NAV_SERVER_OIDC_AUDIENCE"),
    policy: policy(values, env),
    remote: read("remote", "NAV_SERVER_REMOTE") ?? "origin",
    pullIntervalMs: wholeNumber(
      read("pull-interval-ms", "NAV_SERVER_PULL_INTERVAL_MS") ?? "10000",
      "--pull-interval-ms",
    ),
    gitTimeoutMs: wholeNumber(
      read("git-timeout-ms", "NAV_SERVER_GIT_TIMEOUT_MS") ?? "30000",
      "--git-timeout-ms",
    ),
    graphiql: values["no-graphiql"] !== true && env.NAV_SERVER_GRAPHIQL !== "false",
  };
}

/**
 * One of two shapes: the discovery document alone, or the issuer and its keys
 * spelled out. Half of the second is a mistake worth naming, and both shapes at
 * once would leave it unsaid which one the document is checked against.
 */
function provider(read: (flag: string, variable: string) => string | undefined): OidcProvider {
  const discoveryUrl = read("oidc-discovery-url", "NAV_SERVER_OIDC_DISCOVERY_URL");
  const issuer = read("oidc-issuer", "NAV_SERVER_OIDC_ISSUER");
  const jwksUrl = read("oidc-jwks-url", "NAV_SERVER_OIDC_JWKS_URL");

  if (discoveryUrl !== undefined) {
    if (issuer !== undefined || jwksUrl !== undefined) {
      throw new ConfigError(
        "--oidc-discovery-url replaces --oidc-issuer and --oidc-jwks-url; give one or the other",
      );
    }
    return { discoveryUrl };
  }
  if (issuer !== undefined && jwksUrl !== undefined) return { issuer, jwksUrl };
  if (issuer === undefined && jwksUrl === undefined) {
    throw new ConfigError(
      "missing required option --oidc-discovery-url (or NAV_SERVER_OIDC_DISCOVERY_URL)",
    );
  }
  throw new ConfigError(
    "--oidc-issuer and --oidc-jwks-url go together; give both, or --oidc-discovery-url instead",
  );
}

/**
 * The authorization policy, from three optional settings.
 *
 * A repeatable flag is a list of values; its variable is the same list with
 * commas between, since an environment entry is one string. Flags win whole:
 * a claim given on the command line replaces the variable's list rather than
 * joining it, as every other setting's flag replaces its variable.
 */
function policy(
  values: Record<string, string | string[] | boolean | undefined>,
  env: NodeJS.ProcessEnv,
): AuthPolicy {
  const list = (flag: string, variable: string): string[] => {
    const given = values[flag];
    if (Array.isArray(given) && given.length > 0) return given;
    const fromEnv = env[variable];
    return fromEnv === undefined ? [] : fromEnv.split(",");
  };

  const requireClaims: ClaimRequirement[] = [];
  for (const text of list("require-claim", "NAV_SERVER_REQUIRE_CLAIMS")) {
    if (text.trim() === "") continue;
    const requirement = parseClaimRequirement(text);
    if (requirement === null) {
      throw new ConfigError(`--require-claim takes <name>=<value>, got '${text}'`);
    }
    requireClaims.push(requirement);
  }

  const allowEmailDomains: string[] = [];
  for (const text of list("allow-email-domain", "NAV_SERVER_ALLOW_EMAIL_DOMAINS")) {
    if (text.trim() === "") continue;
    const domain = normalizeDomain(text);
    if (domain === null) {
      throw new ConfigError(
        `--allow-email-domain takes a domain such as example.com, got '${text}'`,
      );
    }
    allowEmailDomains.push(domain);
  }

  const verified = env.NAV_SERVER_REQUIRE_EMAIL_VERIFIED;
  if (verified !== undefined && verified !== "" && verified !== "true" && verified !== "false") {
    throw new ConfigError(
      `NAV_SERVER_REQUIRE_EMAIL_VERIFIED takes true or false, got '${verified}'`,
    );
  }
  return {
    requireClaims,
    allowEmailDomains,
    requireEmailVerified: values["require-email-verified"] === true || verified === "true",
  };
}

function wholeNumber(value: string, what: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`${what} takes a whole number, got '${value}'`);
  }
  return parsed;
}
