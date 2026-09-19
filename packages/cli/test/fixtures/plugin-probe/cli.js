/**
 * The probe's terminal half: one noun with two verbs, and contributions to
 * three of the issue verbs.
 */

import { appendFileSync } from "node:fs";

if (process.env.PROBE_LOG) appendFileSync(process.env.PROBE_LOG, "cli\n");

export function activate(host) {
  if (process.env.PROBE_LOG) appendFileSync(process.env.PROBE_LOG, "cli:activate\n");

  const { core, ctx } = host;
  const tagsOf = (entity) => core.readStringOrList(entity.fm, "probe-tag");

  host.command("probe hello", ([who]) => {
    ctx.stdout.write(`probe says hello to ${who ?? "nobody"}\n`);
  });

  // The verb that reads the tree, to prove a plugin gets the same repository
  // the built-in verbs get, with its own directory already parsed.
  host.command("probe tags", () => {
    const repo = core.loadRepo(ctx);
    const seen = new Set();
    for (const entity of core.allEntities(repo)) for (const tag of tagsOf(entity)) seen.add(tag);
    const model = repo.ext.get("probe");
    ctx.stdout.write(`tags: ${[...seen].sort().join(", ") || "none"}\n`);
    ctx.stdout.write(`reports: ${model?.reports.length ?? 0}\n`);
  });

  host.contribute("issue open", {
    openFields: (opts) => (opts.probeTag?.length ? { "probe-tag": opts.probeTag } : {}),
  });

  host.contribute("issue list", {
    columns: [
      {
        header: "tags",
        value: (entity) => tagsOf(entity).join(","),
        when: (entities) => entities.some((entity) => tagsOf(entity).length > 0),
      },
    ],
    jsonExtra: (entity) => ({ probeTags: tagsOf(entity) }),
    listCompletions: () => ["ptag:flaky", "ptag:slow"],
  });

  host.contribute("issue show", {
    showSection: (entity) => {
      const tags = tagsOf(entity);
      return tags.length === 0 ? [] : [`Probe tags: ${tags.join(", ")}`];
    },
  });
}
