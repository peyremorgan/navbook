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
    // The pair that keeps a second `@navbook/core` out of the store. A plugin
    // declares core as a peer for its types; installing peers would give it a
    // copy of its own, and then `instanceof WorkspaceError` would be false
    // across the boundary and the YAML parser would be loaded twice.
    // `--omit=peer` alone only leaves peers off the disk: npm still resolves
    // them, from the registry, and refuses the install when a web half's
    // optional framework peers do not reconcile. `--legacy-peer-deps` stops it
    // resolving them at all — the host provides every one.
    "--omit=peer",
    "--legacy-peer-deps",
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
  const npm = npmInvocation(args);
  const result = spawnSync(npm.file, npm.args, {
    cwd: dir,
    encoding: "utf8",
    shell: false,
    windowsVerbatimArguments: npm.verbatim,
    env: { ...env },
  });
  if (result.error) return { ok: false, output: result.error.message };
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

/**
 * How to run `npm <args>` on this platform, without a shell to interpret them.
 *
 * Everywhere but Windows npm is an executable, run directly. On Windows it is
 * `npm.cmd`, a batch file, which only `cmd.exe` can run, and which Node will
 * not launch without a shell. So there `cmd.exe /d /s /c` runs it, with every
 * argument quoted and every character cmd treats specially escaped, twice:
 * once for the command line, and once more for the batch file reading `%*`.
 * Without that, a spec carrying `&` or `%` — a URL, a path — would be read by
 * cmd as something to do. It is the quoting `cross-spawn` uses, after
 * https://qntm.org/cmd, kept to the one command that needs it.
 */
export function npmInvocation(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; verbatim: boolean } {
  if (platform !== "win32") return { file: "npm", args: [...args], verbatim: false };
  const line = ["npm", ...args.map(cmdArgument)].join(" ");
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

/** The characters cmd.exe gives a meaning to, which `^` makes literal. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument as cmd.exe will hand it, unchanged, to a batch file's `%*`. */
function cmdArgument(arg: string): string {
  // Backslashes before a quote double, and the quote is escaped, as the C
  // runtime unquotes them; backslashes before the closing quote double too.
  // The lookahead keeps the match linear, whatever the input.
  const inner = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, "$1$1");
  return `"${inner}"`.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
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

/**
 * The packages the store depends on, as npm recorded them: each real package
 * name, and the specifier npm saved for it.
 *
 * What was *asked* for and what was *installed* are not the same string: a
 * tarball path, a git URL and a short name all resolve to a package whose real
 * name is inside it, and looking in `node_modules/<what-was-typed>` finds
 * nothing. npm writes the real name into the store's own `package.json`, so
 * reading it back — before an install and again after — is how an install
 * learns what it actually got. The specifier is kept too, because a new
 * version of a plugin already installed changes it without adding a name.
 */
export function storeDependencies(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(storeDir(env), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}) };
  } catch {
    return {};
  }
}
