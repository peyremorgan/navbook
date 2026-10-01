/**
 * Which plugins this invocation has, and which it was told about but lacks.
 *
 * Two sources, in order: `NAVBOOK_PLUGIN_PATH`, for a plugin being written and
 * not installed anywhere, and the store, for everything else. A path entry
 * shadows an installed copy of the same package — otherwise developing a
 * plugin you have also installed would silently test the installed one.
 *
 * The declaration (spec 02 §2.12) is read here, and read only to *report*:
 * nothing in this file fetches anything. A plugin the repository names and the
 * machine does not have is one line on stderr and a run that carries on, which
 * is the rule that makes cloning a repository safe.
 */

import { existsSync } from "node:fs";
import { delimiter, isAbsolute, resolve as resolvePath } from "node:path";
import {
  PLUGIN_API_VERSION,
  type PluginDeclarationReading,
  readPluginDeclaration,
  satisfiesRange,
  type WsCtx,
} from "@navbook/core";
import { type IndexedPlugin, readIndex, readPluginAt } from "./store.ts";

export const PLUGIN_PATH_ENV = "NAVBOOK_PLUGIN_PATH";

/** An installed plugin, with the settings the repository declares for it. */
export interface LoadedPlugin extends IndexedPlugin {
  /** What `navbook.json` declares under this name; empty when undeclared. */
  settings: Record<string, unknown>;
  /** True when the repository's marker names it (spec 02 §2.12). */
  declared: boolean;
  /** True when it came from `NAVBOOK_PLUGIN_PATH` rather than the store. */
  fromPath: boolean;
}

export interface ResolvedPlugins {
  /** Usable plugins, in the order their contributions should be applied. */
  active: LoadedPlugin[];
  /** Declared by the repository, absent from this machine. */
  missing: string[];
  /** Found but not used, each with the reason, for one line on stderr. */
  skipped: { name: string; reason: string }[];
  /** What the marker declared, for a caller that wants the settings or faults. */
  declaration: PluginDeclarationReading;
}

const NOTHING: ResolvedPlugins = {
  active: [],
  missing: [],
  skipped: [],
  declaration: { plugins: new Map(), declared: false, problems: [] },
};

/**
 * Resolve the plugins for this invocation.
 *
 * Costs one `plugins.json` read in the common case, and one `package.json`
 * read per `NAVBOOK_PLUGIN_PATH` entry, which is a development path. The
 * marker is read too, but the workspace reads it anyway for the review policy.
 */
export function resolvePlugins(ws: WsCtx, env: NodeJS.ProcessEnv): ResolvedPlugins {
  const fromPath = pathPlugins(env);
  const index = readIndex(env);
  if (fromPath.active.length === 0 && fromPath.skipped.length === 0 && index === null) {
    // Nothing installed and nothing on the path: the overwhelmingly common
    // case, and it must not cost a marker read of its own.
    return ws.hasNavbook ? undeclaredOnly(ws) : NOTHING;
  }

  const declaration = ws.hasNavbook
    ? readPluginDeclaration(ws)
    : { plugins: new Map<string, Record<string, unknown>>(), declared: false, problems: [] };

  const active: LoadedPlugin[] = [];
  const skipped = [...fromPath.skipped];
  const seen = new Set<string>();

  const admit = (plugin: IndexedPlugin, viaPath: boolean): void => {
    if (seen.has(plugin.name)) return;
    const problem = incompatible(plugin);
    if (problem !== null) {
      skipped.push({ name: plugin.name, reason: problem });
      seen.add(plugin.name);
      return;
    }
    seen.add(plugin.name);
    active.push({
      ...plugin,
      settings: declaration.plugins.get(plugin.name) ?? {},
      declared: declaration.plugins.has(plugin.name),
      fromPath: viaPath,
    });
  };

  // Path first, so a plugin being developed shadows an installed copy.
  for (const plugin of fromPath.active) admit(plugin, true);
  for (const plugin of Object.values(index?.plugins ?? {})) admit(plugin, false);

  const missing = [...declaration.plugins.keys()].filter((name) => !seen.has(name));
  return { active, missing, skipped, declaration };
}

/** The store is empty, so everything declared is missing. */
function undeclaredOnly(ws: WsCtx): ResolvedPlugins {
  const declaration = readPluginDeclaration(ws);
  return {
    active: [],
    missing: [...declaration.plugins.keys()],
    skipped: [],
    declaration,
  };
}

/** Read every directory `NAVBOOK_PLUGIN_PATH` names. */
function pathPlugins(env: NodeJS.ProcessEnv): {
  active: IndexedPlugin[];
  skipped: { name: string; reason: string }[];
} {
  const raw = env[PLUGIN_PATH_ENV];
  if (raw === undefined || raw.trim() === "") return { active: [], skipped: [] };

  const active: IndexedPlugin[] = [];
  const skipped: { name: string; reason: string }[] = [];
  // Separated as `PATH` is: `:`, or `;` on Windows, where `:` is in every path.
  for (const entry of raw.split(delimiter)) {
    const dir = entry.trim();
    if (dir === "") continue;
    const path = isAbsolute(dir) ? dir : resolvePath(dir);
    if (!existsSync(path)) {
      skipped.push({
        name: path,
        reason: `${PLUGIN_PATH_ENV} names a directory that is not there`,
      });
      continue;
    }
    const read = readPluginAt(path);
    if ("error" in read) {
      skipped.push({ name: path, reason: read.error });
      continue;
    }
    active.push(read);
  }
  return { active, skipped };
}

/**
 * Why a plugin cannot be used, or null when it can.
 *
 * A version mismatch is reported rather than risked. The alternative is
 * loading it anyway and discovering the mismatch as a missing function in the
 * middle of an operation, by which point the user is reading a stack trace
 * about a tree that is perfectly sound.
 */
function incompatible(plugin: IndexedPlugin): string | null {
  if (plugin.engines === null) {
    return `it declares no 'engines.navbook', so there is nothing to check it against`;
  }
  if (!satisfiesRange(plugin.engines, PLUGIN_API_VERSION)) {
    return `it needs a Navbook plugin API of ${plugin.engines}; this is ${PLUGIN_API_VERSION}`;
  }
  return null;
}

/** The line printed for a plugin the repository declares and the machine lacks. */
export function missingLine(name: string, navDir: string): string {
  return `nav: ${name} is declared in ${navDir}/navbook.json but is not installed; run 'nav plugin install'`;
}

/** The line printed for a plugin that was found but cannot be used. */
export function skippedLine(name: string, reason: string): string {
  return `nav: plugin ${name} skipped: ${reason}`;
}
