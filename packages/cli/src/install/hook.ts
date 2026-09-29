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
#
# The status is captured rather than tested on the next line: this block is
# appended to whatever hook was already here, and under 'set -e' a bare
# 'nav doctor --staged' would end the hook on exit 1 (an operational error,
# not a format violation) before the test below ever ran.
if command -v nav >/dev/null 2>&1; then
  navbook_status=0
  nav doctor --staged || navbook_status=$?
  if [ "$navbook_status" -eq 2 ]; then
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

/**
 * Whether the hook has the block, and whether it is this `nav`'s.
 *
 * `outdated` is a block an older `nav` wrote: the markers are there but what
 * is between them is not what this one would write — the block before the
 * `set -e` fix, say. Seeing only the marker would leave every existing
 * install with the old block for good.
 */
export function hookState(repoRoot: string): "absent" | "current" | "outdated" {
  const path = hookPath(repoRoot);
  if (!existsSync(path)) return "absent";
  const block = findBlock(readFileSync(path, "utf8"));
  if (block === null) return "absent";
  return block.text === BODY ? "current" : "outdated";
}

/** The marked block's text and where it sits, or null when there is none. */
function findBlock(content: string): { start: number; end: number; text: string } | null {
  const start = content.indexOf(MARKER_BEGIN);
  if (start === -1) return null;
  const close = content.indexOf(MARKER_END, start);
  // An opening marker with no closing one is a block somebody cut short by
  // hand; it runs to the end of the file, which is what uninstall assumes too.
  const end = close === -1 ? content.length : close + MARKER_END.length;
  return { start, end, text: content.slice(start, end) };
}

/**
 * Write the marked block: appended, creating the hook file if there is none,
 * or put in place of an older block, leaving everything around it alone.
 */
export function installHook(repoRoot: string): void {
  const path = hookPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";

  const block = findBlock(existing);
  if (block !== null) {
    if (block.text === BODY) return;
    const replaced = `${existing.slice(0, block.start)}${BODY}${existing.slice(block.end)}`;
    writeFileSync(path, replaced.endsWith("\n") ? replaced : `${replaced}\n`, "utf8");
    chmodSync(path, statSync(path).mode | 0o111);
    return;
  }
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
