/**
 * `nav install` / `nav uninstall` — spec 04 §4.1, §4.3, §4.5.
 *
 * Everything that touches the user's environment lives here, and nothing
 * happens without printing the exact action first: the `git config` command to
 * be run, the hook path, the completions file.
 */

import {
  ALIAS_DEFAULT,
  aliasCommand,
  DIRECTORY_RENAMES_KEY,
  git,
  readGlobal,
  readLocal,
  setLocal,
  unsetGlobal,
  unsetLocal,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { fail } from "../errors.ts";
import {
  completionNote,
  completionPath,
  completionScript,
  detectShell,
  installCompletions,
  isShell,
  type Shell,
  uninstallCompletions,
} from "../install/completions.ts";
import { hookPath, installHook, isInstalled, uninstallHook } from "../install/hook.ts";
import { type Action, confirmAndPerform } from "../prompt.ts";

export interface InstallOptions {
  alias?: string | boolean;
  hooks?: boolean;
  completions?: string | boolean;
  mergeConfig?: boolean;
  yes?: boolean;
}

/** True when the user asked for specific pieces rather than "everything". */
function isSelective(opts: InstallOptions): boolean {
  return (
    opts.alias !== undefined ||
    opts.hooks !== undefined ||
    opts.completions !== undefined ||
    opts.mergeConfig !== undefined
  );
}

function resolveShell(value: string | boolean | undefined, ctx: Ctx): Shell {
  if (typeof value === "string" && value !== "") {
    if (!isShell(value)) fail(`unknown shell '${value}'; expected bash, zsh or fish`);
    return value;
  }
  return detectShell(ctx.env);
}

export function cmdInstall(ctx: Ctx, opts: InstallOptions): void {
  const selective = isSelective(opts);

  // Asking for completions explicitly prints the script and changes nothing,
  // so it never prompts; only install-everything mode writes the file
  // (spec 04 §4.3). A bare `--completions` is the explicit form.
  if (selective && opts.completions !== undefined) {
    ctx.stdout.write(completionScript(resolveShell(opts.completions, ctx)));
    return;
  }

  const actions: Action[] = [];
  const notes: string[] = [];

  if (!selective || opts.alias !== undefined) {
    const name = typeof opts.alias === "string" && opts.alias !== "" ? opts.alias : ALIAS_DEFAULT;
    const existing = readGlobal(`alias.${name}`);
    if (existing === "!nav") {
      notes.push(`git alias '${name}' is already set up`);
    } else if (existing !== null) {
      notes.push(
        `git alias '${name}' already exists as ${JSON.stringify(existing)}; leaving it alone`,
      );
    } else {
      actions.push({
        description: `git ${aliasCommand(name).join(" ")}   (enables 'git ${name} <cmd>')`,
        perform: () => void git(aliasCommand(name)),
      });
    }
  }

  if (!selective || opts.mergeConfig !== undefined) {
    const current = readLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY);
    if (current === "true") {
      notes.push(`${DIRECTORY_RENAMES_KEY} is already true in this repository`);
    } else {
      actions.push({
        description: `git config --local ${DIRECTORY_RENAMES_KEY} true   (lets a comment racing a close merge cleanly)`,
        perform: () => setLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY, "true"),
      });
    }
  }

  if (!selective || opts.hooks !== undefined) {
    if (isInstalled(ctx.repoRoot)) {
      notes.push("the pre-commit hook is already installed");
    } else {
      actions.push({
        description: `append the navbook block to ${hookPath(ctx.repoRoot)}`,
        perform: () => installHook(ctx.repoRoot),
      });
    }
  }

  if (!selective || opts.completions !== undefined) {
    const shell = resolveShell(opts.completions, ctx);
    const path = completionPath(shell, ctx.env);
    actions.push({
      description: `write ${shell} completions to ${path}`,
      perform: () => void installCompletions(shell, ctx.env),
    });
    const note = completionNote(shell, path);
    if (note) notes.push(note);
  }

  const performed = confirmAndPerform(ctx, {
    title: "nav install will:",
    actions,
    assumeYes: opts.yes,
  });
  if (performed) for (const note of notes) ctx.stdout.write(`${note}\n`);
}

export function cmdUninstall(ctx: Ctx, opts: InstallOptions): void {
  const selective = isSelective(opts);
  const actions: Action[] = [];

  if (!selective || opts.alias !== undefined) {
    const name = typeof opts.alias === "string" && opts.alias !== "" ? opts.alias : ALIAS_DEFAULT;
    if (readGlobal(`alias.${name}`) === "!nav") {
      actions.push({
        description: `git config --global --unset alias.${name}`,
        perform: () => unsetGlobal(`alias.${name}`),
      });
    }
  }

  if (!selective || opts.mergeConfig !== undefined) {
    if (readLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY) !== null) {
      actions.push({
        description: `git config --local --unset ${DIRECTORY_RENAMES_KEY}`,
        perform: () => unsetLocal(ctx.repoRoot, DIRECTORY_RENAMES_KEY),
      });
    }
  }

  if (!selective || opts.hooks !== undefined) {
    if (isInstalled(ctx.repoRoot)) {
      actions.push({
        description: `remove the navbook block from ${hookPath(ctx.repoRoot)}`,
        perform: () => uninstallHook(ctx.repoRoot),
      });
    }
  }

  if (!selective || opts.completions !== undefined) {
    const shell = resolveShell(opts.completions, ctx);
    const path = completionPath(shell, ctx.env);
    actions.push({
      description: `remove ${path} if navbook wrote it`,
      perform: () => void uninstallCompletions(shell, ctx.env),
    });
  }

  confirmAndPerform(ctx, { title: "nav uninstall will:", actions, assumeYes: opts.yes });
}
