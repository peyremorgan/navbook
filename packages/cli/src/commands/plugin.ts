/**
 * `nav plugin install | remove | update | list` — spec 04 §4.3.
 *
 * The verbs that put a plugin on a machine, and the one place in Navbook that
 * fetches anything. Two rules shape all of it:
 *
 * - **Installing is explicit.** `install` with no argument reads the
 *   repository's declaration and offers to install what is missing; it never
 *   acts on it without being told. The declaration says what a tree contains,
 *   not what this machine should run.
 * - **What arrives is checked.** npm will happily install any package by that
 *   name. Before a package is recorded as a plugin, its name, its keyword and
 *   its manifest are checked, and a package that fails is uninstalled again
 *   rather than left in a store that claims it is a plugin.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandPluginName, hasPluginKeyword, isPluginPackageName } from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import { resolvePlugins } from "../plugins/resolve.ts";
import {
  type IndexedPlugin,
  installCommand,
  npmInstall,
  npmRemove,
  type PluginIndex,
  packageDir,
  readIndex,
  readPluginAt,
  storeDependencies,
  storeDir,
  writeIndex,
} from "../plugins/store.ts";
import { confirmAndPerform } from "../prompt.ts";

export interface PluginInstallOptions {
  yes?: boolean;
}

export interface PluginListOptions {
  json?: boolean;
}

/**
 * Install plugins, or the ones the repository declares and this machine lacks.
 *
 * The npm command is printed before it runs, so what the user agrees to is the
 * command rather than a summary of it — the `nav install` rule (spec 04 §4.3).
 */
export function cmdPluginInstall(ctx: Ctx, names: string[], opts: PluginInstallOptions): void {
  const wanted = names.length > 0 ? names.map((name) => resolveName(name)) : declared(ctx);
  if (wanted.length === 0) {
    ctx.stdout.write(
      ctx.hasNavbook
        ? "Nothing to do: every plugin this repository declares is installed.\n"
        : "Nothing to do: name a plugin to install.\n",
    );
    return;
  }

  const agreed = confirmAndPerform(ctx, {
    title: "nav plugin install will:",
    actions: [
      {
        description: `run ${installCommand(wanted)}`,
        perform: () => {
          const result = npmInstall(ctx.env, wanted);
          if (!result.ok) fail("npm could not install the plugin", result.output.split("\n"));
        },
      },
    ],
    assumeYes: opts.yes,
  });
  if (!agreed) return;

  const index = readIndex(ctx.env) ?? { version: 1 as const, plugins: {} };
  // What npm actually installed, by its real name. `wanted` may hold tarball
  // paths and short names, and neither is a name `node_modules` is keyed by;
  // the store's own manifest is where npm wrote what each one resolved to.
  const resolved = new Set([
    ...wanted.filter((spec) => !looksLocal(spec)),
    // Only the ones this install added: the store's manifest lists everything
    // it has, and reporting a plugin installed months ago as installed now
    // would be a lie in the output of a command that installed something else.
    ...storeDependencies(ctx.env).filter((name) => index.plugins[name] === undefined),
  ]);
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const name of resolved) {
    const problem = record(ctx, index, name);
    if (problem === null) kept.push(name);
    else {
      rejected.push(name);
      ctx.stderr.write(`nav: ${problem}\n`);
    }
  }
  if (rejected.length > 0) {
    // A package that is not a plugin must not be left in the store looking
    // like one. Removing it is the only way `nav plugin list` stays truthful.
    npmRemove(ctx.env, rejected);
  }
  writeIndex(ctx.env, index);

  for (const name of kept) {
    const plugin = index.plugins[name];
    ctx.stdout.write(`Installed ${name}@${plugin?.version ?? "?"}\n`);
  }
  if (kept.length > 0 && ctx.hasNavbook) {
    const undeclaredNow = kept.filter((name) => !isDeclared(ctx, name));
    for (const name of undeclaredNow) {
      ctx.stdout.write(
        `Note: ${ctx.navDir}/navbook.json does not declare ${name}; add it so every clone knows.\n`,
      );
    }
  }
  if (kept.length === 0) fail("nothing was installed");
}

/** Check what npm fetched, and record it in the index. Returns a fault, or null. */
function record(ctx: Ctx, index: PluginIndex, name: string): string | null {
  const dir = packageDir(ctx.env, name);
  const read = readPluginAt(dir);
  if ("error" in read) return read.error;
  if (!isPluginPackageName(read.name)) {
    return `${read.name} is not named as a plugin (spec 04 §4.3)`;
  }
  if (!hasKeyword(dir)) {
    return `${read.name} does not carry the 'navbook-plugin' keyword`;
  }
  index.plugins[read.name] = read;
  return null;
}

function hasKeyword(dir: string): boolean {
  try {
    return hasPluginKeyword(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
  } catch {
    return false;
  }
}

/** Expand a short name to the package it means, refusing one that is not a plugin's. */
function resolveName(name: string): string {
  const candidates = expandPluginName(name);
  const only = candidates[0] as string;
  if (candidates.length === 1) {
    if (!isPluginPackageName(only) && !looksLocal(only)) {
      fail(`${only} is not named as a plugin`, [
        "a plugin is @navbook/plugin-<name>, navbook-plugin-<name>, or @scope/navbook-plugin-<name>",
      ]);
    }
    return only;
  }
  // A short name: npm decides which of the candidates exists, and the install
  // reports whichever it could not find. Trying them here would mean a network
  // call before the user has agreed to anything.
  return only;
}

/** True for a specifier npm reads as a path or a URL rather than a package name. */
function looksLocal(spec: string): boolean {
  return (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("file:") ||
    spec.startsWith("git+") ||
    spec.endsWith(".tgz")
  );
}

/** The declared plugins this machine does not have. */
function declared(ctx: Ctx): string[] {
  if (!ctx.hasNavbook) return [];
  return resolvePlugins(ctx, ctx.env).missing;
}

function isDeclared(ctx: Ctx, name: string): boolean {
  return resolvePlugins(ctx, ctx.env).declaration.plugins.has(name);
}

export function cmdPluginRemove(ctx: Ctx, names: string[], opts: PluginInstallOptions): void {
  const index = readIndex(ctx.env);
  const known = names.filter((name) => index?.plugins[name] !== undefined);
  const unknown = names.filter((name) => index?.plugins[name] === undefined);
  for (const name of unknown) ctx.stderr.write(`nav: ${name} is not installed\n`);
  if (known.length === 0) fail("nothing to remove");

  const removed = confirmAndPerform(ctx, {
    title: "nav plugin remove will:",
    actions: known.map((name) => ({
      description: `remove ${name} from ${storeDir(ctx.env)}`,
      perform: () => {
        const result = npmRemove(ctx.env, [name]);
        if (!result.ok) fail(`npm could not remove ${name}`, result.output.split("\n"));
      },
    })),
    assumeYes: opts.yes,
  });
  if (!removed || index === null) return;

  for (const name of known) delete index.plugins[name];
  writeIndex(ctx.env, index);
  for (const name of known) ctx.stdout.write(`Removed ${name}\n`);
  // Deliberately silent about the declaration: what a repository says its tree
  // contains is a property of the tree, and one machine's uninstall does not
  // change it (spec 04 §4.3).
}

export function cmdPluginUpdate(ctx: Ctx, names: string[], opts: PluginInstallOptions): void {
  const index = readIndex(ctx.env);
  const installed = Object.keys(index?.plugins ?? {});
  const wanted = names.length > 0 ? names : installed;
  if (wanted.length === 0) {
    ctx.stdout.write("Nothing to do: no plugins are installed.\n");
    return;
  }
  const unknown = wanted.filter((name) => !installed.includes(name));
  if (unknown.length > 0) fail(`not installed: ${unknown.join(", ")}`);

  const updated = confirmAndPerform(ctx, {
    title: "nav plugin update will:",
    actions: [
      {
        description: `run ${installCommand(wanted.map((name) => `${name}@latest`))}`,
        perform: () => {
          const result = npmInstall(
            ctx.env,
            wanted.map((name) => `${name}@latest`),
          );
          if (!result.ok) fail("npm could not update the plugins", result.output.split("\n"));
        },
      },
    ],
    assumeYes: opts.yes,
  });
  if (!updated || index === null) return;

  for (const name of wanted) {
    const before = index.plugins[name]?.version;
    const problem = record(ctx, index, name);
    if (problem !== null) {
      ctx.stderr.write(`nav: ${problem}\n`);
      continue;
    }
    const after = index.plugins[name]?.version;
    ctx.stdout.write(
      before === after ? `${name} is already ${after}\n` : `Updated ${name} ${before} → ${after}\n`,
    );
  }
  writeIndex(ctx.env, index);
}

export function cmdPluginList(ctx: Ctx, opts: PluginListOptions): void {
  const resolved = resolvePlugins(ctx, ctx.env);
  const rows = resolved.active.map((plugin) => ({
    name: plugin.name,
    version: plugin.version,
    declared: plugin.declared,
    source: plugin.fromPath ? ("path" as const) : ("store" as const),
    dir: plugin.dir,
  }));

  if (opts.json) {
    for (const row of rows) ctx.stdout.write(`${JSON.stringify(row)}\n`);
    for (const name of resolved.missing) {
      ctx.stdout.write(`${JSON.stringify({ name, declared: true, missing: true })}\n`);
    }
    return;
  }

  if (rows.length === 0 && resolved.missing.length === 0) {
    ctx.stdout.write(`No plugins installed. The store is ${storeDir(ctx.env)}\n`);
    return;
  }
  for (const row of rows) {
    const where = row.source === "path" ? `  (${row.dir})` : "";
    const state = row.declared ? "declared" : "not declared here";
    ctx.stdout.write(`${row.name}  ${row.version}  ${state}${where}\n`);
  }
  for (const name of resolved.missing) {
    ctx.stdout.write(`${name}  —  declared, not installed\n`);
  }
  for (const { name, reason } of resolved.skipped) {
    ctx.stderr.write(`nav: plugin ${name} skipped: ${reason}\n`);
  }
}

/** Names in the store's `node_modules`, for a caller that wants to look. */
export function installedNames(env: NodeJS.ProcessEnv): string[] {
  try {
    return readdirSync(`${storeDir(env)}/node_modules`).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

export type { IndexedPlugin };
