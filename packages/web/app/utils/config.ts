/**
 * The handful of facts a build cannot know.
 *
 * A static bundle is copied to whatever host serves it, so the address of the
 * API and the identity provider cannot be compiled in: one artefact has to work
 * for every deployment. They are read from `config.json` beside the bundle at
 * boot instead, which a deployment overwrites without rebuilding anything.
 *
 * Parsing is strict and the messages name the key, because the failure mode
 * this replaces — a typo that silently becomes `undefined` and surfaces three
 * screens later as a fetch to `undefined/graphql` — is miserable to diagnose.
 */

export interface OidcConfig {
  /** Base URL of the OIDC provider; discovery hangs off it. */
  issuer: string;
  clientId: string;
  /** The `aud` the server checks. Requested so the provider mints it. */
  audience: string;
}

export interface WebConfig {
  graphqlUrl: string;
  oidc: OidcConfig;
}

export class ConfigError extends Error {}

/** Where `config.json` sits, relative to wherever the app is mounted. */
export const CONFIG_PATH = "config.json";

function requireString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`config.json: ${path} must be a non-empty string`);
  }
  return value.trim();
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`config.json: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Validate a parsed `config.json`, or say exactly which key is wrong. */
export function parseConfig(raw: unknown): WebConfig {
  const root = requireObject(raw, "the document");
  const oidc = requireObject(root.oidc, "oidc");
  return {
    graphqlUrl: requireString(root, "graphqlUrl", "graphqlUrl"),
    oidc: {
      issuer: requireString(oidc, "issuer", "oidc.issuer"),
      clientId: requireString(oidc, "clientId", "oidc.clientId"),
      audience: requireString(oidc, "audience", "oidc.audience"),
    },
  };
}

/** Fetch and validate the runtime configuration. */
export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<WebConfig> {
  let response: Response;
  try {
    response = await fetchImpl(CONFIG_PATH, { cache: "no-store" });
  } catch (cause) {
    throw new ConfigError(`could not fetch ${CONFIG_PATH}: ${describe(cause)}`);
  }
  if (!response.ok) {
    throw new ConfigError(`could not fetch ${CONFIG_PATH}: HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ConfigError(`${CONFIG_PATH} is not valid JSON: ${describe(cause)}`);
  }
  return parseConfig(body);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
