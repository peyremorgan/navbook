/**
 * Editing the `people` map in `navbook.json` — `doc/spec.md`, "The people map".
 *
 * The marker is JSON that `nav init` writes two-space indented with a final
 * newline, and every tool that rewrites it writes it back the same way; so
 * does this. Keys keep their order, and nothing outside this plugin's
 * `people` is touched — not the other plugins' settings, not the policies.
 */

import { isPlainObject, PLUGIN_NAME } from "./settings.ts";

/** Why the marker cannot be edited: it is no JSON object, or does not declare this plugin. */
export class MarkerError extends Error {}

/** What an edit did to the map, for the commit subject and the reply. */
export interface PeopleEdit {
  /** The marker's new text; equal to the old one when nothing changed. */
  text: string;
  changed: boolean;
}

/**
 * Apply `edit` to the plugin's `people` map in `markerText`.
 *
 * Refuses a marker that does not declare the plugin: linking somebody is no
 * reason to start using a plugin the repository never asked for, and a
 * declaration written as a side effect would be one nobody decided on. An
 * emptied map is removed rather than left as `{}`.
 */
export function editPeople(
  markerText: string | undefined,
  edit: (people: Record<string, string>) => void,
): PeopleEdit {
  if (markerText === undefined) {
    throw new MarkerError("there is no navbook.json to record links in");
  }
  let marker: unknown;
  try {
    marker = JSON.parse(markerText);
  } catch {
    throw new MarkerError("navbook.json is not valid JSON");
  }
  if (!isPlainObject(marker)) throw new MarkerError("navbook.json is not a JSON object");
  const plugins = marker.plugins;
  const settings = isPlainObject(plugins) ? plugins[PLUGIN_NAME] : undefined;
  if (!isPlainObject(settings)) {
    throw new MarkerError(`navbook.json does not declare ${PLUGIN_NAME} in its plugins`);
  }
  const before = isPlainObject(settings.people) ? settings.people : {};
  const people: Record<string, string> = {};
  for (const [id, email] of Object.entries(before)) {
    if (typeof email === "string") people[id] = email;
  }
  edit(people);
  if (Object.keys(people).length === 0) delete settings.people;
  else settings.people = people;
  const text = `${JSON.stringify(marker, null, 2)}\n`;
  // Compared as data, so a marker written by hand in another style is not
  // rewritten — and committed — for an edit that changed nothing.
  const changed = JSON.stringify(before) !== JSON.stringify(settings.people ?? {});
  return { text: changed ? text : markerText, changed };
}
