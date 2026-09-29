/**
 * Which endpoint and model to use, and the key to use it with.
 *
 * Three places, in order: a flag for this run, the environment, and the
 * plugin's settings in `navbook.json`. The settings are committed and shared
 * by everyone who clones, which makes them the place for the team's choice of
 * endpoint and model and never the place for a key: the key is read from the
 * environment only (doc/plugins.md, "Using them").
 */

export interface ChatConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** `NAV_CHAT_` for the CLI, `NAV_SERVER_CHAT_` for the server (spec 06 §6.2). */
export type EnvPrefix = "NAV_CHAT_" | "NAV_SERVER_CHAT_";

export interface ConfigSources {
  env: Readonly<Record<string, string | undefined>>;
  prefix: EnvPrefix;
  /** The plugin's entry in `navbook.json`. */
  settings: Readonly<Record<string, unknown>>;
  /** What this run was told on its command line. */
  flags?: { model?: string };
}

export type ConfigReading =
  | { ok: true; config: ChatConfig }
  | { ok: false; message: string; details: string[] };

export function resolveChatConfig(sources: ConfigSources): ConfigReading {
  const env = (key: string): string | undefined => nonEmpty(sources.env[`${sources.prefix}${key}`]);
  const setting = (key: string): string | undefined => {
    const value = sources.settings[key];
    return typeof value === "string" ? nonEmpty(value) : undefined;
  };

  const model = nonEmpty(sources.flags?.model) ?? env("MODEL") ?? setting("model");
  if (model === undefined) {
    return {
      ok: false,
      message: "no model is configured for the assistant",
      details:
        sources.prefix === "NAV_CHAT_"
          ? [
              "pass --model <id>, set NAV_CHAT_MODEL,",
              'or add { "model": "<id>" } under "@navbook/plugin-chat" in the plugins of navbook.json',
            ]
          : [
              "set NAV_SERVER_CHAT_MODEL,",
              'or add { "model": "<id>" } under "@navbook/plugin-chat" in the plugins of navbook.json',
            ],
    };
  }

  const baseUrl = (env("BASE_URL") ?? setting("baseUrl") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
  } catch {
    return {
      ok: false,
      message: `the assistant's base URL is not an http(s) URL: ${baseUrl}`,
      details: [
        `set ${sources.prefix}BASE_URL, or "baseUrl" in navbook.json, to e.g. ${DEFAULT_BASE_URL}`,
      ],
    };
  }

  const apiKey = env("API_KEY");
  return { ok: true, config: { baseUrl, model, ...(apiKey === undefined ? {} : { apiKey }) } };
}

/** Where the endpoint is, as it is safe to show anybody: scheme and host only. */
export function endpointOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
