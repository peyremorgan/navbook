/**
 * The `pre-commit` hook — spec 04 §4.5.
 *
 * The hook is a thin shell script that calls the binary, so `--no-verify` and
 * manual hook removal behave exactly as users expect. It is written as a marked
 * block appended to any existing hook, and `nav uninstall --hooks` removes
 * precisely that block and nothing else.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { hooksDir } from "@navbook/core";

export const MARKER_BEGIN = "# >>> navbook >>>";
export const MARKER_END = "# <<< navbook <<<";
export const HOOK_NAME = "pre-commit";

const SHEBANG = "#!/bin/sh";

const BODY = `${MARKER_BEGIN}
# Validate staged Navbook files. Only a format violation (exit 2) blocks the
# commit; warnings never do, and a clone without nav installed is unaffected.
# Commit with --no-verify, or delete this block, to skip the check.
if command -v nav >/dev/null 2>&1; then
  nav doctor --staged
  if [ $? -eq 2 ]; then
    exit 1
  fi
fi
${MARKER_END}`;

export function hookPath(repoRoot: string): string {
  return join(hooksDir(repoRoot), HOOK_NAME);
}

export function isInstalled(repoRoot: string): boolean {
  const path = hookPath(repoRoot);
  return existsSync(path) && readFileSync(path, "utf8").includes(MARKER_BEGIN);
}

/** Append the marked block, creating the hook file if there is none. */
export function installHook(repoRoot: string): void {
  const path = hookPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";

  if (existing.includes(MARKER_BEGIN)) return;
  const content =
    existing.trim() === ""
      ? `${SHEBANG}\n${BODY}\n`
      : `${existing.replace(/\n*$/, "\n")}\n${BODY}\n`;
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

/**
 * Remove exactly the marked block. A hook that contained nothing else is
 * deleted; a hook the user also wrote by hand keeps everything they wrote.
 */
export function uninstallHook(repoRoot: string): void {
  const path = hookPath(repoRoot);
  if (!existsSync(path)) return;
  const existing = readFileSync(path, "utf8");
  if (!existing.includes(MARKER_BEGIN)) return;

  const stripped = existing
    .split("\n")
    .reduce<{ lines: string[]; inside: boolean }>(
      (state, line) => {
        if (line.trim() === MARKER_BEGIN) return { lines: state.lines, inside: true };
        if (line.trim() === MARKER_END) return { lines: state.lines, inside: false };
        if (!state.inside) state.lines.push(line);
        return state;
      },
      { lines: [], inside: false },
    )
    .lines.join("\n");

  const remainder = stripped.replace(SHEBANG, "").trim();
  if (remainder === "") {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, `${stripped.replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n")}`, "utf8");
  chmodSync(path, statSync(path).mode | 0o111);
}
