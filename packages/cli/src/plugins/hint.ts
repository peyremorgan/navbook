/**
 * Saying that a tree holds data this `nav` cannot read.
 *
 * Spec 02 §2.12 requires a tool to preserve an extension namespace it does not
 * understand, and allows it to say the namespace is undeclared. Saying so is
 * the whole value of the declaration to somebody who has just cloned: the
 * files are there, `nav` is ignoring them, and nothing else on screen would
 * explain why.
 *
 * One line, on stderr, and never an error. The tree is conforming; this `nav`
 * simply has less of it than the repository expects.
 */

import { readdirSync } from "node:fs";
import type { PluginDeclarationReading } from "@navbook/core";
import type { Ctx } from "../context.ts";

/** Names this format defines at the top of the root; never a namespace. */
const FORMAT_NAMES = new Set(["issues", "prs", "archive", "sync", "navbook.json"]);

/**
 * Namespaces this project knows the plugin for, so the hint can name it.
 *
 * Only this repository's own plugins are listed, and deliberately: a namespace
 * whose plugin nobody here knows about gets the generic line below, which is
 * the honest thing to say about a directory some other project's plugin wrote.
 */
const KNOWN: Record<string, string> = {
  specs: "@navbook/plugin-kb",
  tests: "@navbook/plugin-tests",
};

/**
 * Directories at the top of the root that this format does not define.
 *
 * One `readdir` rather than a parse of the tree: the caller has usually just
 * read the whole repository, and reading it a second time to find out what the
 * first read ignored would cost more than the hint is worth.
 */
function namespaceDirs(navRoot: string): string[] {
  try {
    return readdirSync(navRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !FORMAT_NAMES.has(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Say once that the tree holds namespaces nothing here reads.
 *
 * `loaded` is the directories a plugin claimed, which are read rather than
 * ignored and so are not worth a word. `declaration` is what the marker says:
 * a namespace whose plugin is declared but missing has already been reported
 * by name, and saying it twice helps nobody.
 */
export function hintUndeclared(
  ctx: Ctx,
  declaration: PluginDeclarationReading,
  loaded: readonly string[],
): void {
  const claimed = new Set(loaded);
  for (const name of namespaceDirs(ctx.navRoot)) {
    if (claimed.has(name)) continue;
    const plugin = KNOWN[name];
    if (plugin !== undefined && declaration.plugins.has(plugin)) continue;
    ctx.stderr.write(
      plugin === undefined
        ? `nav: ${ctx.navDir}/${name}/ is not a shape this nav reads; it is preserved untouched (spec 02 §2.12)\n`
        : `nav: ${ctx.navDir}/${name}/ belongs to ${plugin}, which ${ctx.navDir}/navbook.json does not declare; add it and run 'nav plugin install'\n`,
    );
  }
}
