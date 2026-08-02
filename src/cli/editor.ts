/**
 * `$EDITOR` integration for the `--edit` flows.
 *
 * The editor is always opened on the real Navbook file, exactly as spec 04 §4.3
 * describes, so nothing has to be parsed back out of a scratch buffer.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitDir } from "../git/repo.ts";
import type { Ctx } from "./context.ts";
import { fail } from "./errors.ts";

/** Single-quote a path for a POSIX shell, escaping any embedded quotes. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
  // $EDITOR may carry its own flags ("code -w"), so it is interpreted by a
  // shell; the path is quoted rather than passed as an argument, because a
  // shell command string has no argv to bind positional parameters from.
  const result = spawnSync(`${editor} ${shellQuote(absolutePath)}`, {
    stdio: "inherit",
    shell: true,
    cwd: ctx.repoRoot,
    env: ctx.env,
  });
  if (result.error) fail(`could not start editor '${editor}': ${result.error.message}`);
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
