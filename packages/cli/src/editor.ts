/**
 * `$EDITOR` integration for the `--edit` flows.
 *
 * The editor is always opened on the real Navbook file, exactly as spec 04 §4.3
 * describes, so nothing has to be parsed back out of a scratch buffer.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitDir, gitMaybe } from "@navbook/core";
import type { Ctx } from "./context.ts";
import { fail } from "./errors.ts";

/**
 * How to run `editor` on `path`: the way git runs its own editor.
 *
 * `sh -c '<editor> "$@"' <editor> <path>` — a shell, because `$EDITOR` may carry
 * flags of its own (`code -w`), and the path as an argument rather than spliced
 * into the command, so that nothing in it needs quoting. `sh` is the system's
 * on POSIX, and on Windows the one Git for Windows ships and runs its own
 * editor with, so `EDITOR=vim` means in `nav` what it means in `git commit`.
 * Where no such shell is found, Windows's own runs the command, with the path
 * in double quotes, which no Windows path can contain.
 */
export function editorInvocation(
  editor: string,
  path: string,
  sh: string | null,
): { file: string; args: string[]; shell: boolean } {
  if (sh !== null) return { file: sh, args: ["-c", `${editor} "$@"`, editor, path], shell: false };
  return { file: `${editor} "${path}"`, args: [], shell: true };
}

/** The POSIX shell to run an editor with, or null on a Windows without one. */
export function posixShell(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return "/bin/sh";
  // `<git>/<mingw64 or ucrt64>/libexec/git-core`, three levels below where
  // the installation keeps `bin/sh.exe`.
  const execPath = gitMaybe(["--exec-path"]);
  if (execPath === null) return null;
  const sh = join(execPath, "..", "..", "..", "bin", "sh.exe");
  return existsSync(sh) ? sh : null;
}

/** The editor command to use, or null when none can be determined. */
export function editorCommand(env: NodeJS.ProcessEnv): string | null {
  for (const key of ["VISUAL", "EDITOR"]) {
    const value = env[key];
    if (value && value.trim() !== "") return value.trim();
  }
  return null;
}

/** Open `absolutePath` in the user's editor, failing if it exits non-zero. */
export function openInEditor(ctx: Ctx, absolutePath: string): void {
  const editor = editorCommand(ctx.env);
  if (!editor) {
    fail("no editor configured", [
      "set $VISUAL or $EDITOR, or pass -m/--message to supply the text directly",
    ]);
  }
  const run = editorInvocation(editor, absolutePath, posixShell());
  const result = spawnSync(run.file, run.args, {
    stdio: "inherit",
    shell: run.shell,
    cwd: ctx.repoRoot,
    env: ctx.env,
  });
  if (result.error) fail(`could not start editor '${editor}': ${result.error.message}`);
  // Ctrl-C reaches the editor too, and a killed process has a signal, not a
  // status: "status null" would say nothing about what happened.
  if (result.signal)
    fail(`editor '${editor}' was interrupted (${result.signal}); nothing was written`);
  if ((result.status ?? 1) !== 0) fail(`editor '${editor}' exited with status ${result.status}`);
}

/**
 * Edit a Navbook file before it exists.
 *
 * The buffer is a real `.md` file (so editors highlight it) held next to
 * `COMMIT_EDITMSG` in the git directory, and it is prefilled with the exact
 * frontmatter the file will carry — the author can adjust the title, labels and
 * body in one pass. Nothing is created in `.navbook/` until the text is valid,
 * so an abort leaves no partial entity behind.
 */
export function editBuffer(ctx: Ctx, name: string, initial: string): string {
  const path = join(gitDir(ctx.repoRoot), name);
  writeFileSync(path, initial, "utf8");
  try {
    openInEditor(ctx, path);
    return readFileSync(path, "utf8");
  } finally {
    rmSync(path, { force: true });
  }
}
