/**
 * The CLI's plugin runtime: what is installed, what it contributes, and when
 * its code is actually loaded.
 *
 * One of these is built per invocation and threaded through the program. It
 * holds the resolution (cheap, always done) and memoises the loading
 * (expensive, done only when a declaration says it is needed).
 *
 * The division of labour with `program.ts` is worth stating: the program asks
 * this for *declarations* while building the command tree, and for
 * *implementations* inside an action. Nothing in the build phase can trigger a
 * load, which is how spec 04 §4.3's rule is kept structurally rather than by
 * remembering to.
 */

import type { CoreExtensions } from "@navbook/core";
import { commitReport } from "@navbook/core";
import { composeFile } from "../commands/compose.ts";
import type { Ctx } from "../context.ts";
import { openInEditor } from "../editor.ts";
import { fail, failFormat } from "../errors.ts";
import { askYesNo, confirmAndPerform } from "../prompt.ts";
import { renderTable, terminalWidth } from "../render/table.ts";
import { collectCommands, type PluginCommands } from "./commands.ts";
import type { CliPluginHost, CliPluginUi, VerbHandlers } from "./host.ts";
import { importEntry, loadCoreExtensions } from "./loader.ts";
import type { LoadedPlugin, ResolvedPlugins } from "./resolve.ts";

export class PluginRuntime {
  readonly resolved: ResolvedPlugins;
  readonly commands: PluginCommands;
  /** Everything worth saying on stderr once, collected while resolving. */
  readonly notices: string[];

  #ext: CoreExtensions | null = null;
  #activated = new Map<string, ActivatedCli>();

  constructor(resolved: ResolvedPlugins, builtinNouns: readonly string[]) {
    this.resolved = resolved;
    this.commands = collectCommands(resolved.active, builtinNouns);
    this.notices = [...this.commands.problems];
  }

  /** True when no plugin is installed, which is the common case. */
  get empty(): boolean {
    return this.resolved.active.length === 0;
  }

  /**
   * Whether this command line needs the format extensions loaded.
   *
   * Decided from the manifests and the words typed, before anything parses,
   * because loading them means importing plugin code — and spec 04 §4.3 says
   * no plugin code is loaded for a command whose declaration does not name it.
   * `nav issue list` with five plugins installed answers false here and
   * imports nothing.
   *
   * The four cases that answer true:
   *
   * - a plugin noun is the first word, and its declaration asks for core;
   * - a plugin contributes to this exact `noun verb`;
   * - a term on the line names a query key a plugin declared;
   * - the command is `doctor`, which runs every registered check.
   */
  needsCoreFor(argv: readonly string[]): boolean {
    if (this.empty) return false;
    // `--help` runs no command: Commander prints what the manifests already
    // built and exits, so there is nothing for an extension to be needed by.
    if (argv.some((word) => word === "--help" || word === "-h")) return false;
    const words = argv.filter((word) => !word.startsWith("-"));
    const [noun, verb] = words;
    if (noun === undefined) return false;
    if (noun === "doctor") return true;

    const declared = this.commands.nouns.get(noun);
    if (declared !== undefined) {
      // A noun's own commands default to needing core: nearly all of them read
      // the tree, and a plugin that does not can say so.
      const leaf = (declared.spec.commands ?? []).find((child) => child.name === verb);
      return (leaf ?? declared.spec).needsCore !== false;
    }
    if (verb !== undefined && this.commands.contributions.has(`${noun} ${verb}`)) return true;

    const keys = new Set<string>();
    for (const plugin of this.usable) {
      for (const key of plugin.manifest.core?.queryKeys ?? []) keys.add(`${key.key}:`);
    }
    return argv.some((word) => {
      const colon = word.indexOf(":");
      return colon > 0 && keys.has(word.slice(0, colon + 1));
    });
  }

  /** Plugins whose commands are still usable after collision checking. */
  get usable(): LoadedPlugin[] {
    return this.resolved.active.filter((plugin) => !this.commands.skipped.has(plugin.name));
  }

  /**
   * The registered format extensions, loading the `./core` entries once.
   *
   * Everything that reads or validates a tree needs these; nothing else does.
   * The caller decides whether this invocation is one of those, which is where
   * the startup budget is actually spent or saved.
   */
  async coreExtensions(ctx: Ctx): Promise<CoreExtensions> {
    if (this.#ext !== null) return this.#ext;
    const { ext, problems } = await loadCoreExtensions(this.usable);
    for (const line of problems) ctx.stderr.write(`${line}\n`);
    this.#ext = ext;
    return ext;
  }

  /** What a plugin registered for a verb, loading its `./cli` entry if needed. */
  async handlersFor(ctx: Ctx, verb: string): Promise<VerbHandlers[]> {
    const declared = this.commands.contributions.get(verb) ?? [];
    const out: VerbHandlers[] = [];
    for (const { plugin } of declared) {
      const activated = await this.#activate(ctx, plugin);
      const handlers = activated?.handlers.get(verb);
      if (handlers !== undefined) out.push(handlers);
    }
    return out;
  }

  /** Run a plugin command, loading its `./cli` entry. */
  async run(
    ctx: Ctx,
    plugin: LoadedPlugin,
    path: string,
    args: string[],
    opts: Record<string, unknown>,
  ): Promise<void> {
    const activated = await this.#activate(ctx, plugin);
    const run = activated?.commands.get(path);
    if (run === undefined) {
      fail(`plugin ${plugin.name} declares '${path}' but does not implement it`);
    }
    await run(args, opts);
  }

  /** Completion candidates a plugin offers for a declared completer. */
  async completions(
    ctx: Ctx,
    plugin: LoadedPlugin,
    id: string,
    words: string[],
  ): Promise<string[]> {
    const activated = await this.#activate(ctx, plugin);
    return activated?.completers.get(id)?.(words) ?? [];
  }

  /** Activate a plugin's CLI entry once per process. */
  async #activate(ctx: Ctx, plugin: LoadedPlugin): Promise<ActivatedCli | null> {
    const existing = this.#activated.get(plugin.name);
    if (existing !== undefined) return existing;

    const entry = await importEntry<CliPluginHost>(plugin, "cli").catch((error: unknown) => {
      ctx.stderr.write(`nav: plugin ${plugin.name} could not be loaded: ${message(error)}\n`);
      return null;
    });
    if (entry === null || typeof entry.activate !== "function") return null;

    const activated: ActivatedCli = {
      commands: new Map(),
      handlers: new Map(),
      completers: new Map(),
    };
    const declaredPaths = declaredCommandPaths(plugin);
    const declaredVerbs = new Set(
      (plugin.manifest.cli?.contributions ?? []).map((contribution) => contribution.on),
    );

    const host: CliPluginHost = {
      core: await coreModule(),
      manifest: plugin.manifest,
      settings: plugin.settings,
      // The core registrations happen through `coreExtensions`; a CLI entry
      // calling `register` is registering for nothing, so it is refused rather
      // than silently ignored.
      register: () => {
        fail(`plugin ${plugin.name}: register() belongs in './core', not './cli'`);
      },
      ctx,
      command: (path, run) => {
        if (!declaredPaths.has(path)) {
          ctx.stderr.write(
            `nav: plugin ${plugin.name} implements '${path}', which its manifest does not declare\n`,
          );
          return;
        }
        activated.commands.set(path, run);
      },
      contribute: (on, handlers) => {
        if (!declaredVerbs.has(on)) {
          ctx.stderr.write(
            `nav: plugin ${plugin.name} contributes to '${on}', which its manifest does not declare\n`,
          );
          return;
        }
        activated.handlers.set(on, handlers);
      },
      completer: (id, complete) => void activated.completers.set(id, complete),
      ui: makeUi(ctx),
    };

    try {
      await entry.activate(host);
    } catch (error) {
      ctx.stderr.write(`nav: plugin ${plugin.name} failed to activate: ${message(error)}\n`);
      return null;
    }
    this.#activated.set(plugin.name, activated);
    return activated;
  }
}

interface ActivatedCli {
  commands: Map<string, (args: string[], opts: Record<string, unknown>) => void | Promise<void>>;
  handlers: Map<string, VerbHandlers>;
  completers: Map<string, (words: string[]) => string[]>;
}

/** Every command path a plugin's manifest declares, `noun verb` style. */
function declaredCommandPaths(plugin: LoadedPlugin): Set<string> {
  const paths = new Set<string>();
  const walk = (
    specs: readonly { name: string; commands?: readonly unknown[] }[],
    prefix: string,
  ) => {
    for (const spec of specs) {
      const path = prefix === "" ? spec.name : `${prefix} ${spec.name}`;
      const children = spec.commands as readonly { name: string; commands?: readonly unknown[] }[];
      if (children?.length) walk(children, path);
      else paths.add(path);
    }
  };
  walk(plugin.manifest.cli?.commands ?? [], "");
  return paths;
}

/** The running core, imported once and shared with every plugin. */
async function coreModule(): Promise<CliPluginHost["core"]> {
  return await import("@navbook/core");
}

function makeUi(ctx: Ctx): CliPluginUi {
  return {
    fail: (message, details) => fail(message, details ?? []),
    failFormat: (message, details) => failFormat(message, details ?? []),
    askYesNo: (question) => askYesNo(ctx, question),
    confirmAndPerform: (opts) => confirmAndPerform(ctx, opts),
    composeFile: (opts) => composeFile(ctx, opts),
    editFile: (path) => openInEditor(ctx, path),
    renderTable: (columns, rows) =>
      renderTable([...columns], rows, { colors: ctx.colors, width: terminalWidth(ctx.stdout) }),
    commitReport,
    collect: (value: string, previous: string[] = []) => [...previous, value],
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
