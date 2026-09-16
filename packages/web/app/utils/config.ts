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
  /**
   * The provider's discovery document, which names everything else about it.
   *
   * Its address rather than the issuer's, because the two are not always
   * one derivation apart: a provider may carry a path its document does not
   * sit under. The client has no use for the issuer on its own — it never
   * checks a token's `iss`; the server does — so the document is enough.
   */
  discoveryUrl: string;
  clientId: string;
  /** The `aud` the server checks. Requested so the provider mints it. */
  audience: string;
}

export interface WebConfig {
  graphqlUrl: string;
  oidc: OidcConfig;
}

export class ConfigError extends Error {}

/** The file's name; where it sits depends on where the app is mounted. */
export const CONFIG_FILE = "config.json";

/**
 * The URL to fetch it from, given the base the app is served under.
 *
 * It has to be absolute. A relative `config.json` resolves against the current
 * route, so a reload on `/issues/ab12cd34` would ask for
 * `/issues/config.json` — which an SPA host answers with the index page, and
 * the app then fails to parse as JSON on exactly the pages people bookmark.
 */
export function configUrl(baseUrl = "/"): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${CONFIG_FILE}`;
}

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
      discoveryUrl: requireString(oidc, "discoveryUrl", "oidc.discoveryUrl"),
      clientId: requireString(oidc, "clientId", "oidc.clientId"),
      audience: requireString(oidc, "audience", "oidc.audience"),
    },
  };
}

export interface LoadConfigOptions {
  /** Where to fetch it from; `configUrl()` builds this from the app's base. */
  url?: string;
  fetch?: typeof fetch;
}

/** Fetch and validate the runtime configuration. */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<WebConfig> {
  const url = options.url ?? configUrl();
  const fetchImpl = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, { cache: "no-store" });
  } catch (cause) {
    throw new ConfigError(`could not fetch ${url}: ${describe(cause)}`);
  }
  if (!response.ok) {
    throw new ConfigError(`could not fetch ${url}: HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ConfigError(`${url} is not valid JSON: ${describe(cause)}`);
  }
  return parseConfig(body);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
