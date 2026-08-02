/**
 * The git configuration Navbook manages on the user's behalf.
 */

import { git, gitMaybe } from "./exec.ts";

export const ALIAS_DEFAULT = "nav";
export const DIRECTORY_RENAMES_KEY = "merge.directoryRenames";

/** The `git nav` style alias: `git config --global alias.<name> '!nav'`. */
export function aliasCommand(name: string): string[] {
  return ["config", "--global", `alias.${name}`, "!nav"];
}

export function readGlobal(key: string): string | null {
  return gitMaybe(["config", "--global", "--get", key]);
}

export function unsetGlobal(key: string): void {
  // --unset fails with exit 5 when the key is already absent, which is fine.
  gitMaybe(["config", "--global", "--unset", key]);
}

export function readLocal(cwd: string, key: string): string | null {
  return gitMaybe(["config", "--local", "--get", key], { cwd });
}

export function setLocal(cwd: string, key: string, value: string): void {
  git(["config", "--local", key, value], { cwd });
}

export function unsetLocal(cwd: string, key: string): void {
  gitMaybe(["config", "--local", "--unset", key], { cwd });
}
