/**
 * The per-user plugin store — spec 04 §4.3.
 *
 * Plugins live in a directory `nav` owns rather than beside `nav` itself,
 * because where `nav` itself lives is not knowable: it may have arrived by
 * `npm -g`, by pnpm, through a version manager, or not be installed at all
 * under `npx`. A directory of our own works the same way in every one of those.
 *
 * The store is an ordinary npm project — a `package.json` and a `node_modules`
 * — so resolution, transitive dependencies and updates are npm's problem and
 * not ours. What we add on top is `plugins.json`: an index of what is
 * installed, with each plugin's manifest copied into it. That file is why
 * startup costs one read. Scanning `node_modules` to find out what is there
 * would cost a directory walk and a `package.json` parse per plugin on every
 * single `nav` invocation, which is the cost spec 05 §5.2 says we cannot pay —
 * and is exactly the mistake Prettier removed its plugin search for.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PluginManifest, parsePluginPackage } from "@navbook/core";

/** Where the store lives, honouring `$XDG_DATA_HOME` (spec 04 §4.3). */
export function storeDir(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_DATA_HOME;
  if (xdg !== undefined && xdg.trim() !== "") return join(xdg, "navbook", "plugins");
  const home = env.HOME ?? env.USERPROFILE ?? "";
  return join(home, ".local", "share", "navbook", "plugins");
}

/** One installed plugin, as the index records it. */
export interface IndexedPlugin {
  name: string;
  version: string;
  /** Absolute path to the package directory inside the store. */
  dir: string;
  /** The `engines.navbook` range, or null when the plugin names none. */
  engines: string | null;
  /**
   * The manifest, copied at install time.
   *
   * A copy rather than a reference to the package's own `package.json`,
   * because reading that file is precisely the work the index exists to avoid.
   * It goes stale only when the package is replaced, and replacing it goes
   * through `nav plugin`, which rewrites the index.
   */
  manifest: PluginManifest;
}

export interface PluginIndex {
  version: 1;
  plugins: Record<string, IndexedPlugin>;
}

const INDEX_FILE = "plugins.json";
const STORE_PACKAGE = {
  name: "navbook-plugins",
  private: true,
  description: "Plugins installed for the nav CLI. Managed by `nav plugin`.",
  version: "1.0.0",
};

export function indexPath(env: NodeJS.ProcessEnv): string {
  return join(storeDir(env), INDEX_FILE);
}

/**
 * Read the index, or null when there is none.
 *
 * Null for every fault — no store, no file, unreadable, not JSON, a version
 * from some future `nav`. A store this `nav` cannot read is a store with no
 * plugins in it as far as this run is concerned, and refusing to list issues
 * because of a file in the user's data directory would be absurd. The repair
 * is `nav plugin install`, which rewrites it.
 */
export function readIndex(env: NodeJS.ProcessEnv): PluginIndex | null {
  const path = indexPath(env);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PluginIndex;
    if (parsed.version !== 1 || typeof parsed.plugins !== "object" || parsed.plugins === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeIndex(env: NodeJS.ProcessEnv, index: PluginIndex): void {
  const dir = storeDir(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
}

/** Create the store's own `package.json` if it is not there yet. */
export function ensureStore(env: NodeJS.ProcessEnv): string {
  const dir = storeDir(env);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) {
    writeFileSync(manifest, `${JSON.stringify(STORE_PACKAGE, null, 2)}\n`);
  }
  return dir;
}

export interface NpmResult {
  ok: boolean;
  /** Everything npm said, for a failure worth showing in full. */
  output: string;
}

/**
 * The npm command a given install would run, as a string to print.
 *
 * Printed before it runs (spec 04 §4.3), so that what the user agrees to is
 * the command rather than a summary of it.
 */
export function installCommand(specs: readonly string[]): string {
  return `npm ${installArgs(specs).join(" ")}`;
}

function installArgs(specs: readonly string[]): string[] {
  return [
    "install",
    // A plugin is code somebody chose to install, but its *dependencies* are
    // not, and a postinstall script is the classic way a package does
    // something nobody asked for. npm runs none of them here.
    "--ignore-scripts",
    // The one that keeps a second `@navbook/core` out of the store. A plugin
    // declares core as a peer for its types; installing peers would give it a
    // copy of its own, and then `instanceof WorkspaceError` would be false
    // across the boundary and the YAML parser would be loaded twice.
    "--omit=peer",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    ...specs,
  ];
}

/** Run npm in the store. Its output is captured rather than streamed. */
export function npmInstall(env: NodeJS.ProcessEnv, specs: readonly string[]): NpmResult {
  return runNpm(env, installArgs(specs));
}

export function npmRemove(env: NodeJS.ProcessEnv, names: readonly string[]): NpmResult {
  return runNpm(env, ["uninstall", "--no-audit", "--no-fund", ...names]);
}

function runNpm(env: NodeJS.ProcessEnv, args: readonly string[]): NpmResult {
  const dir = ensureStore(env);
  const result = spawnSync("npm", [...args], {
    cwd: dir,
    encoding: "utf8",
    // npm is a shell script on Windows; everywhere Navbook supports it is not.
    shell: false,
    env: { ...env },
  });
  if (result.error) return { ok: false, output: result.error.message };
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

/**
 * Read an installed package directory as a plugin.
 *
 * Used at install time to check what npm actually fetched, and by
 * `NAVBOOK_PLUGIN_PATH` to read a plugin nobody installed. Faults come back as
 * a message so the caller can name the directory alongside them.
 */
export function readPluginAt(dir: string): IndexedPlugin | { error: string } {
  const manifestPath = join(dir, "package.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { error: `${manifestPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const read = parsePluginPackage(raw);
  if (!read.ok) return { error: read.error };
  return {
    name: read.plugin.name,
    version: read.plugin.version,
    dir,
    engines: read.plugin.engines,
    manifest: read.plugin.manifest,
  };
}

/** Where npm put a package inside the store. */
export function packageDir(env: NodeJS.ProcessEnv, name: string): string {
  return join(storeDir(env), "node_modules", ...name.split("/"));
}
