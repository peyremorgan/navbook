/**
 * The Discord bridge's format half — `doc/spec.md`.
 *
 * The bridge keeps nothing in the tree but its settings, so this is small: the
 * commit scope its link commits are written under, and the check `nav doctor`
 * runs over those settings, so a typo in a channel id is found at a terminal
 * rather than by a thread that never appears.
 */

import type { CorePluginHost, Repo } from "@navbook/core";
import { PLUGIN_NAME, parseSettings } from "./settings.ts";

export { editPeople, MarkerError } from "./marker.ts";
export * from "./settings.ts";

/** The check over the settings block. */
export const SETTINGS_CHECK = "X-discord-1";

export function activate(host: CorePluginHost): void {
  const { core } = host;
  host.register({
    commitScopes: ["discord"],
    doctorChecks: [
      {
        id: SETTINGS_CHECK,
        level: "error",
        run: (repo: Repo) => {
          // Undeclared, there is nothing to check: the plugin was loaded from
          // its development path, or the declaration's own fault is D15's.
          const settings = repo.plugins.plugins.get(PLUGIN_NAME);
          if (settings === undefined) return [];
          const reading = parseSettings(settings, core);
          if (reading.ok) return [];
          return reading.problems.map((problem) => ({
            check: SETTINGS_CHECK,
            level: "error" as const,
            path: core.NAV_MARKER,
            message: `${PLUGIN_NAME} settings, ${problem}`,
          }));
        },
      },
    ],
  });
}
