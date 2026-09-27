/**
 * Finding the plugins a served clone declares — spec 02 §2.12, 06 §6.3.
 *
 * The rule here is the opposite of the CLI's, and deliberately so. A person at
 * a terminal who is missing a plugin gets one line and a working `nav`,
 * because the tracker is still readable and refusing to list their issues
 * would be absurd. A *server* missing one refuses to start.
 *
 * The difference is who finds out. The CLI's user is the person who can fix
 * it, standing in the repository, reading the line. A server's users are
 * everyone with a browser, and what they would see is not an error but an
 * absence — a tree quietly missing whatever the plugin contributes, with
 * nothing on screen to say so and no way for them to act on it. That is the
 * same reasoning that already refuses to start on a dirty clone or a detached
 * HEAD: a puzzling failure on somebody's first mutation is worse than a clear
 * one in the operator's log.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import {
  PLUGIN_API_VERSION,
  type PluginManifest,
  parsePluginPackage,
  readPluginDeclaration,
  satisfiesRange,
  type WsCtx,
} from "@navbook/core";

export const PLUGIN_PATH_ENV = "NAVBOOK_PLUGIN_PATH";

/** A plugin the server will load. */
export interface ServerPlugin {
  name: string;
  version: string;
  dir: string;
  manifest: PluginManifest;
  /** What `navbook.json` declares under this name. */
  settings: Record<string, unknown>;
}

export class PluginResolutionError extends Error {}

/**
 * Resolve every plugin the clone declares.
 *
 * Declared plugins are located by asking Node to resolve `<name>/server` from
 * this module, which finds a plugin installed beside `@navbook/server` — the
 * arrangement the container image builds (spec 05 §5.2). A plugin with no
 * `./server` export is still resolved, through its `package.json`: plenty of
 * plugins add a format and a CLI verb and nothing the API needs, and refusing
 * to start over one would be refusing over nothing.
 */
export function resolveServerPlugins(ws: WsCtx, env: NodeJS.ProcessEnv): ServerPlugin[] {
  const declaration = readPluginDeclaration(ws);
  const byPath = pathPlugins(env);
  const out: ServerPlugin[] = [];

  for (const [name, settings] of declaration.plugins) {
    const found = byPath.get(name) ?? installedPlugin(name);
    if (found === null) {
      throw new PluginResolutionError(
        `${name} is declared in ${ws.navDir}/navbook.json but is not installed beside nav-server`,
      );
    }
    if ("error" in found) throw new PluginResolutionError(`${name}: ${found.error}`);
    out.push({ ...found, settings });
  }

  // A plugin on the path that the clone does not declare is a plugin somebody
  // is developing against this server. It loads, and says nothing: refusing it
  // would make testing a plugin require committing a declaration first.
  for (const [name, found] of byPath) {
    if (declaration.plugins.has(name)) continue;
    if ("error" in found) throw new PluginResolutionError(`${name}: ${found.error}`);
    out.push({ ...found, settings: {} });
  }

  return out;
}

type Found = Omit<ServerPlugin, "settings"> | { error: string };

/** Read a package directory as a plugin, checking the API version. */
function readPlugin(dir: string): Found {
  const manifestPath = join(dir, "package.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { error: `${manifestPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const read = parsePluginPackage(raw);
  if (!read.ok) return { error: read.error };
  const { name, version, manifest, engines } = read.plugin;
  if (engines === null) {
    return { error: "it declares no 'engines.navbook', so there is nothing to check it against" };
  }
  if (!satisfiesRange(engines, PLUGIN_API_VERSION)) {
    return {
      error: `it needs a Navbook plugin API of ${engines}; this is ${PLUGIN_API_VERSION}`,
    };
  }
  return { name, version, dir, manifest };
}

/** Locate a plugin installed beside the server. */
function installedPlugin(name: string): Found | null {
  const require = createRequire(import.meta.url);
  for (const specifier of [`${name}/package.json`, name]) {
    try {
      const resolved = require.resolve(specifier);
      const dir = specifier.endsWith("package.json") ? dirname(resolved) : packageRootOf(resolved);
      if (dir !== null) return readPlugin(dir);
    } catch {
      // Try the next specifier; a plugin need not export its package.json.
    }
  }
  return null;
}

/** Walk up from a resolved file to the package directory that holds it. */
function packageRootOf(file: string): string | null {
  let dir = dirname(file);
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Plugins named by `NAVBOOK_PLUGIN_PATH`, by package name. */
function pathPlugins(env: NodeJS.ProcessEnv): Map<string, Found> {
  const out = new Map<string, Found>();
  const raw = env[PLUGIN_PATH_ENV];
  if (raw === undefined || raw.trim() === "") return out;

  for (const entry of raw.split(":")) {
    const dir = entry.trim();
    if (dir === "") continue;
    const path = isAbsolute(dir) ? dir : resolvePath(dir);
    const found = readPlugin(path);
    if ("error" in found) {
      // Keyed by the directory, so the message names what the operator typed.
      out.set(path, found);
      continue;
    }
    out.set(found.name, found);
  }
  return out;
}

/**
 * Read and check this plugin's `NAV_SERVER_<SHORT>_*` configuration.
 *
 * Required keys are checked here, at startup, with the server's own — so a
 * bridge with no token refuses to come up rather than failing on its first
 * message, hours later, in front of somebody who did not deploy it.
 */
export function pluginConfig(plugin: ServerPlugin, env: NodeJS.ProcessEnv): Record<string, string> {
  const prefix = `NAV_SERVER_${plugin.manifest.short.toUpperCase()}_`;
  const out: Record<string, string> = {};
  for (const spec of plugin.manifest.server?.config ?? []) {
    if (!spec.env.startsWith(prefix)) {
      throw new PluginResolutionError(
        `${plugin.name}: '${spec.env}' must begin with ${prefix} (spec 04 §4.3)`,
      );
    }
    const value = env[spec.env];
    if (value === undefined || value === "") {
      if (spec.required === true) {
        throw new PluginResolutionError(`${plugin.name} needs ${spec.env}: ${spec.description}`);
      }
      continue;
    }
    out[spec.env] = value;
  }
  return out;
}

/** The SDL a plugin contributes, or null when it adds none. */
export function pluginSchema(plugin: ServerPlugin): string | null {
  const relative = plugin.manifest.server?.schema;
  if (relative === undefined) return null;
  const path = join(plugin.dir, relative);
  if (!existsSync(path)) {
    throw new PluginResolutionError(
      `${plugin.name}: 'navbook.server.schema' names ${relative}, which is not in the package`,
    );
  }
  return readFileSync(path, "utf8");
}
