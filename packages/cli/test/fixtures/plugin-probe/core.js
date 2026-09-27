/**
 * The probe's format half.
 *
 * Every entry of this plugin appends its own name to the file `$PROBE_LOG`
 * names, which is how the suite proves what was imported and, much more
 * importantly, what was not: the assertion that `nav issue list` leaves the
 * log empty is the one that keeps spec 04 §4.3's loading rule honest.
 */

import { appendFileSync } from "node:fs";

if (process.env.PROBE_LOG) appendFileSync(process.env.PROBE_LOG, "core\n");

/** Tags read off an entity, in either spelling the format allows. */
function tagsOf(core, entity) {
  return core.readStringOrList(entity.fm, "probe-tag");
}

export function activate(host) {
  if (process.env.PROBE_LOG) appendFileSync(process.env.PROBE_LOG, "core:activate\n");

  host.register({
    treeLocations: [
      {
        dir: "probe",
        build(_files, paths) {
          const reports = [];
          const problems = [];
          for (const path of paths) {
            const name = path.slice("probe/".length);
            if (name.endsWith(".json")) reports.push(name);
            else
              problems.push({ path, message: `'probe/' holds .json files; '${name}' is not one` });
          }
          return { model: { reports }, problems };
        },
      },
    ],
    frontmatterKeys: [
      {
        key: "probe-tag",
        kinds: ["issue", "pr"],
        shape: "string-or-list",
        validate: (value) =>
          Array.isArray(value) || typeof value === "string"
            ? []
            : [{ key: "probe-tag", message: "'probe-tag' must be a tag or a list of them" }],
      },
    ],
    queryKeys: [
      {
        key: "ptag",
        kinds: ["issue", "pr"],
        matches: (values, entity) => {
          const tags = tagsOf(host.core, entity);
          return values.every((wanted) => tags.includes(wanted));
        },
      },
    ],
    doctorChecks: [
      {
        id: "X-probe-1",
        level: "error",
        run: (repo) =>
          (repo.extProblems.get("probe") ?? []).map((problem) => ({
            check: "X-probe-1",
            level: "error",
            path: problem.path,
            message: problem.message,
          })),
      },
    ],
    commitScopes: ["probe"],
  });
}
