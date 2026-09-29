/**
 * Building Commander commands out of manifests — spec 04 §4.3.
 *
 * Every command a plugin adds is built from its declaration, with no plugin
 * code loaded. That is what makes `nav --help` and shell completion work
 * without paying for an import, and it is what the manifest's shapes exist to
 * make possible. The plugin's own module is imported inside the action, the
 * moment somebody actually runs the command.
 *
 * A name that collides with a built-in noun, or with one an earlier plugin
 * took, is refused and the plugin skipped, because a word that means different
 * things depending on load order is worse than one that means nothing.
 */

import type { ArgumentSpec, CommandSpec, OptionSpec, VerbContribution } from "@navbook/core";
import { Command, Option } from "commander";
import { finiteNumber, wholeNumber } from "../args.ts";
import type { Ctx } from "../context.ts";
import type { LoadedPlugin } from "./resolve.ts";

/** Everything the CLI needs to know about one plugin's declared commands. */
export interface PluginCommands {
  /** Top-level nouns, by name, with the plugin that declared each. */
  nouns: Map<string, { plugin: LoadedPlugin; spec: CommandSpec }>;
  /** Contributions to existing verbs, keyed by the verb as typed. */
  contributions: Map<string, { plugin: LoadedPlugin; spec: VerbContribution }[]>;
  /** Plugins dropped for a collision, by name, so callers need not parse a message. */
  skipped: Set<string>;
  /** One line per plugin skipped, for stderr. */
  problems: string[];
}

/**
 * Sort out which plugin owns what, refusing collisions.
 *
 * `taken` is the built-in noun vocabulary. A plugin colliding with one of
 * those loses outright; two plugins colliding with each other are resolved by
 * which was resolved first, and the loser is named.
 */
export function collectCommands(
  plugins: readonly LoadedPlugin[],
  taken: readonly string[],
): PluginCommands {
  const nouns = new Map<string, { plugin: LoadedPlugin; spec: CommandSpec }>();
  const contributions = new Map<string, { plugin: LoadedPlugin; spec: VerbContribution }[]>();
  const skipped = new Set<string>();
  const problems: string[] = [];
  const builtin = new Set(taken);

  for (const plugin of plugins) {
    const declared = plugin.manifest.cli;
    if (declared === undefined) continue;

    const clash = (declared.commands ?? []).find(
      (spec) => builtin.has(spec.name) || nouns.has(spec.name),
    );
    if (clash !== undefined) {
      const owner = builtin.has(clash.name)
        ? "a built-in command"
        : `plugin ${nouns.get(clash.name)?.plugin.name}`;
      problems.push(
        `nav: plugin ${plugin.name} skipped: '${clash.name}' is already ${owner} (spec 04 §4.3)`,
      );
      skipped.add(plugin.name);
      continue;
    }
    for (const spec of declared.commands ?? []) nouns.set(spec.name, { plugin, spec });
    for (const spec of declared.contributions ?? []) {
      const existing = contributions.get(spec.on) ?? [];
      existing.push({ plugin, spec });
      contributions.set(spec.on, existing);
    }
  }

  return { nouns, contributions, skipped, problems };
}

/** How a plugin command's action is run once its module is loaded. */
export type RunCommand = (
  plugin: LoadedPlugin,
  path: string,
  args: string[],
  opts: Record<string, unknown>,
) => Promise<void>;

/** Build one plugin noun into a Commander command tree. */
export function buildPluginCommand(
  plugin: LoadedPlugin,
  spec: CommandSpec,
  getCtx: () => Ctx,
  run: RunCommand,
): Command {
  return buildCommand(plugin, spec, spec.name, getCtx, run);
}

function buildCommand(
  plugin: LoadedPlugin,
  spec: CommandSpec,
  path: string,
  getCtx: () => Ctx,
  run: RunCommand,
): Command {
  const command = new Command(spec.name).description(spec.description);

  // A group — a noun with verbs under it — has no action of its own, and
  // Commander's implicit `help` verb is dropped for the reason the built-in
  // nouns drop it: it prints exactly what `--help` prints.
  if (spec.commands?.length) {
    command.helpCommand(false);
    for (const child of spec.commands) {
      command.addCommand(buildCommand(plugin, child, `${path} ${child.name}`, getCtx, run));
    }
    return command;
  }

  for (const argument of spec.arguments ?? []) command.argument(...argumentOf(argument));
  for (const option of spec.options ?? []) applyOption(command, option);

  command.action(async (...received: unknown[]) => {
    // Commander hands the action its positional arguments, then the parsed
    // options, then the command itself. The declared arguments say how many
    // positionals there are, so the split needs no guessing.
    const count = spec.arguments?.length ?? 0;
    const args = received.slice(0, count) as string[];
    const opts = (received[count] ?? {}) as Record<string, unknown>;
    // Touch the context before loading the plugin: a command run outside a
    // repository should say so in the CLI's own words rather than in whatever
    // the plugin says when it finds no tree.
    getCtx();
    await run(plugin, path, args, opts);
  });
  return command;
}

/** A declared argument, in the `[name]` / `<name...>` shape Commander parses. */
function argumentOf(spec: ArgumentSpec): [string, string] {
  const dots = spec.variadic === true ? "..." : "";
  const name = spec.optional === true ? `[${spec.name}${dots}]` : `<${spec.name}${dots}>`;
  return [name, spec.description ?? ""];
}

/** Apply one declared option to a command. */
export function applyOption(command: Command, spec: OptionSpec): void {
  const option = new Option(spec.flags, spec.description);
  if (spec.repeatable === true) {
    option.argParser((value: string, previous: string[] = []) => [...previous, value]);
    option.default([]);
  } else if (spec.parse === "int") {
    // The parsers the built-in options use, so a plugin's count is refused
    // where the built-in ones are: `parseInt` read `2.5` as 2 and `3abc` as 3,
    // and `Number` reads `0x10` and `1e1` and rounds past 2^53 (#kw143sq9).
    option.argParser(wholeNumber(null));
  } else if (spec.parse === "number") {
    option.argParser(finiteNumber);
  }
  if (spec.default !== undefined) option.default(spec.default);
  command.addOption(option);
}

/**
 * Why a declared option cannot be applied, or null when it can.
 *
 * Two different rules, because two different namespaces are at stake.
 *
 * On a plugin's **own** command the plugin owns every flag, so a short one is
 * its business: `nav feature open -m "…"` reads exactly as `nav issue open -m
 * "…"` does, and denying it would make a plugin's commands feel like
 * second-class ones for no gain.
 *
 * On a **contribution** to a built-in verb the namespace is shared, and short
 * flags are the scarce part of it — `-m`, `-y`, `-n` already mean things
 * across the whole CLI. A plugin taking one there would be discovered by
 * whoever installed two plugins rather than by whoever wrote the second, so
 * they are refused outright rather than raced for.
 *
 * A long flag that is already taken is refused either way, and checked before
 * Commander sees it: `.option()` throws on a duplicate, which would take the
 * whole CLI down over one plugin's manifest.
 */
export function optionCollision(
  command: Command,
  spec: OptionSpec,
  where: "own" | "contribution" = "contribution",
): string | null {
  const flags = spec.flags.split(/[ ,|]+/).filter((part) => part.startsWith("-"));
  if (where === "contribution") {
    const short = flags.find((flag) => /^-[^-]/.test(flag));
    if (short !== undefined) {
      return `'${short}' is a short flag, which a plugin may not add to a built-in verb`;
    }
  }
  for (const flag of flags) {
    if (command.options.some((existing) => existing.long === flag || existing.short === flag)) {
      return `'${flag}' is already an option of '${command.name()}'`;
    }
  }
  return null;
}
