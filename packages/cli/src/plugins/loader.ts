/**
 * Importing a plugin's code, as late as possible — spec 04 §4.3, 05 §5.2.
 *
 * The rule this file exists to keep: nothing here runs for a command whose
 * manifest does not name it. `nav issue list` on a machine with five plugins
 * installed imports none of them, and `nav --help` imports none of them
 * either, because the help was built from manifests. An `import()` of one
 * plugin costs more than the whole of `nav issue list`'s budget, so this is
 * not a micro-optimisation: it is the difference between plugins being
 * affordable and not.
 *
 * What triggers a load is therefore always a *declaration* — a command the
 * plugin declared being run, a contribution it declared being reached, a
 * query term it declared being typed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "@navbook/core";
import {
  type CoreExtensions,
  ExtensionConflictError,
  mergeExtensions,
  NO_EXTENSIONS,
} from "@navbook/core";
import type { CorePluginHost, PluginEntry } from "./host.ts";
import type { LoadedPlugin } from "./resolve.ts";

/** Which part of a plugin to import; the `exports` subpath, without the dot. */
export type PluginPart = "core" | "cli" | "server" | "web";

/** One import per part per process, however many commands ask for it. */
const loaded = new Map<string, Promise<unknown>>();

/**
 * The file a plugin's `exports` maps a subpath to.
 *
 * Read from the package's own `package.json` rather than guessed, because the
 * whole point of `exports` is that a package decides its own layout — and a
 * published plugin's `./cli` points into `dist/` while the same plugin in a
 * checkout points into `src/`.
 */
export function entryPath(plugin: LoadedPlugin, part: PluginPart): string | null {
  let pkg: { exports?: Record<string, unknown> };
  try {
    pkg = JSON.parse(readFileSync(join(plugin.dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const entry = pkg.exports?.[`./${part}`];
  const file = typeof entry === "string" ? entry : resolveConditions(entry);
  if (file === null) return null;
  const path = join(plugin.dir, file);
  return existsSync(path) ? path : null;
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

/** Import one part of one plugin, memoised. */
export async function importEntry<H>(
  plugin: LoadedPlugin,
  part: PluginPart,
): Promise<PluginEntry<H> | null> {
  const key = `${plugin.name}#${part}`;
  const existing = loaded.get(key);
  if (existing !== undefined) return (await existing) as PluginEntry<H> | null;

  const path = entryPath(plugin, part);
  if (path === null) {
    loaded.set(key, Promise.resolve(null));
    return null;
  }
  const pending = import(pathToFileURL(path).href);
  loaded.set(key, pending);
  return (await pending) as PluginEntry<H>;
}

/** Clear the memo. For tests that load the same plugin under two settings. */
export function forgetLoaded(): void {
  loaded.clear();
}

/** A plugin's `./core` part, activated, with whatever went wrong. */
export interface CoreLoad {
  ext: CoreExtensions;
  /** One line per plugin that could not contribute, for stderr. */
  problems: string[];
}

/**
 * Activate every plugin's `./core` entry and merge what they registered.
 *
 * A plugin that throws while activating, or that collides with one already
 * merged, is dropped and reported — the run continues with the plugins that
 * worked. Dropping one plugin loses that plugin's data; refusing to start
 * loses the user's whole tracker, and the second is not a better answer to a
 * bad `package.json` somebody published.
 */
export async function loadCoreExtensions(plugins: readonly LoadedPlugin[]): Promise<CoreLoad> {
  if (plugins.length === 0) return { ext: NO_EXTENSIONS, problems: [] };

  const parts: { name: string; registered: Parameters<CorePluginHost["register"]>[0][] }[] = [];
  const problems: string[] = [];

  for (const plugin of plugins) {
    const entry = await importEntry<CorePluginHost>(plugin, "core").catch((error: unknown) => {
      problems.push(`nav: plugin ${plugin.name} could not be loaded: ${message(error)}`);
      return null;
    });
    if (entry === null) continue;
    if (typeof entry.activate !== "function") {
      problems.push(`nav: plugin ${plugin.name} exports no activate() from './core'`);
      continue;
    }
    const registered: Parameters<CorePluginHost["register"]>[0][] = [];
    try {
      await entry.activate({
        core,
        manifest: plugin.manifest,
        settings: plugin.settings,
        register: (received) => void registered.push(received),
      });
    } catch (error) {
      problems.push(`nav: plugin ${plugin.name} failed to activate: ${message(error)}`);
      continue;
    }
    parts.push({ name: plugin.name, registered });
  }

  // Merge one plugin at a time, so a collision names the plugin that lost and
  // the ones before it survive. Merging everything at once would only be able
  // to say that two plugins collided, which is true but not actionable.
  const kept: Parameters<CorePluginHost["register"]>[0][] = [];
  for (const part of parts) {
    try {
      mergeExtensions([...kept, ...part.registered]);
      kept.push(...part.registered);
    } catch (error) {
      if (error instanceof ExtensionConflictError) {
        problems.push(`nav: plugin ${part.name} skipped: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  return { ext: kept.length === 0 ? NO_EXTENSIONS : mergeExtensions(kept), problems };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
