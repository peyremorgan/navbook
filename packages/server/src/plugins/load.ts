/**
 * Loading the server's plugins at startup.
 *
 * Everything here runs once, before the first request is accepted, and any
 * fault is a `StartupError`: a plugin that cannot be loaded is a deployment
 * that was configured wrong, and the operator reading the log is the only
 * person who can fix it. Compare the CLI, where the same fault is one line and
 * a working command — see the note in `resolve.ts` for why the two differ.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "@navbook/core";
import {
  type CoreExtensions,
  type ExtensionParts,
  mergeExtensions,
  NO_EXTENSIONS,
} from "@navbook/core";
import { checkComposed, requireText } from "../compose.ts";
import type { Config } from "../config.ts";
import { invalidInput, run } from "../errors.ts";
import type { AuthorCache } from "../people.ts";
import { commitInfo } from "../resolvers/mutation.ts";
import type { RepoSync } from "../sync.ts";
import type { ServerPluginEntry, ServerPluginHost } from "./host.ts";
import { pluginConfig, pluginSchema, type ServerPlugin } from "./resolve.ts";
import { PluginRuntime } from "./runtime.ts";

/** What the loaded plugins amount to, ready to build a server from. */
export interface LoadedPlugins {
  /** Format registrations, for the workspace context every request builds. */
  ext: CoreExtensions;
  /** SDL fragments, merged into the schema. */
  typeDefs: string[];
  runtime: PluginRuntime;
  plugins: ServerPlugin[];
}

export interface LoadOptions {
  plugins: readonly ServerPlugin[];
  config: Config;
  env: NodeJS.ProcessEnv;
  sync: RepoSync;
  authors: AuthorCache;
  report: (line: string) => void;
}

/**
 * Import and activate every plugin's `./core` and `./server` entries.
 *
 * Order matters in one respect only: `./core` first, so a plugin's format is
 * registered before its resolvers could read a tree through it.
 */
export async function loadServerPlugins(opts: LoadOptions): Promise<LoadedPlugins> {
  const runtime = new PluginRuntime(opts.report);
  const registered: ExtensionParts[] = [];
  const typeDefs: string[] = [];

  for (const plugin of opts.plugins) {
    const settings = plugin.settings;

    const coreEntry = await importEntry<{ activate(host: unknown): void | Promise<void> }>(
      plugin,
      "core",
    );
    if (coreEntry !== null) {
      await coreEntry.activate({
        core,
        manifest: plugin.manifest,
        settings,
        register: (parts: ExtensionParts) => void registered.push(parts),
      });
    }

    const sdl = pluginSchema(plugin);
    if (sdl !== null) typeDefs.push(sdl);

    const serverEntry = await importEntry<ServerPluginEntry>(plugin, "server");
    if (serverEntry === null) continue;

    const host: ServerPluginHost = {
      core,
      manifest: plugin.manifest,
      settings,
      config: opts.config,
      pluginConfig: pluginConfig(plugin, opts.env),
      sync: opts.sync,
      authors: opts.authors,
      report: (line) => opts.report(`${plugin.name}: ${line}`),
      resolvers: (map) => runtime.addResolvers(map),
      service: (service) => runtime.addService(service),
      onMutation: (listener) => runtime.onMutation(listener),
      entityInput: (bridge) => runtime.addBridge(bridge),
      api: { run, invalidInput, requireText, checkComposed, commitInfo },
    };
    await serverEntry.activate(host);
    opts.report(`loaded plugin ${plugin.name}@${plugin.version}`);
  }

  return {
    ext: registered.length === 0 ? NO_EXTENSIONS : mergeExtensions(registered),
    typeDefs,
    runtime,
    plugins: [...opts.plugins],
  };
}

/** Import one part of one plugin, or null when it exports none. */
async function importEntry<T>(plugin: ServerPlugin, part: "core" | "server"): Promise<T | null> {
  const path = entryPath(plugin, part);
  if (path === null) return null;
  return (await import(pathToFileURL(path).href)) as T;
}

/** The file a plugin's `exports` maps a subpath to, or null when it has none. */
function entryPath(plugin: ServerPlugin, part: string): string | null {
  const pkg = readPackage(plugin.dir);
  const entry = pkg?.exports?.[`./${part}`];
  const file = typeof entry === "string" ? entry : resolveConditions(entry);
  if (file === null) return null;
  const path = join(plugin.dir, file);
  return existsSync(path) ? path : null;
}

function readPackage(dir: string): { exports?: Record<string, unknown> } | null {
  try {
    // Read rather than cached: this happens once per plugin, at startup.
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Pick a file out of a conditional exports object, preferring what Node runs. */
function resolveConditions(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const conditions = entry as Record<string, unknown>;
  for (const key of ["node", "import", "default", "require"]) {
    const value = conditions[key];
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
      const nested = resolveConditions(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}
