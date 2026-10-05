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

  // Two questions in a row, so a pipe answering both proves each question
  // reads its own line and no more.
  host.command("probe ask", () => {
    const { ui } = host;
    const first = ui.ask("first? ");
    const second = ui.ask("second? ");
    ctx.stdout.write(`answers: ${JSON.stringify([first, second])}\n`);
    ctx.stdout.write(`interactive: ${ui.isInteractive()}\n`);
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

  // A write beside a pull request, wherever its branch is checked out.
  // `--async` makes it the mistake the host refuses: an async callback, which
  // stages the comment before its first await and returns a promise.
  host.command("probe note", ([id, text], opts) => {
    const note = (at, entity, commit) => {
      const content = core.newCommentFile({ author: core.currentAuthor(at), body: text });
      return core.applyComment(at, entity, { content }, { commit });
    };
    const written = host.ui.withPrWriteSite(
      id,
      { assumeYes: opts.yes === true },
      opts.async
        ? async (at, entity) => note(at, entity, false)
        : (at, entity) => note(at, entity, true),
    );
    ctx.stdout.write(`${host.ui.commitReport(written.run)}\n`);
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

  // Completion candidates and nothing else: a run of `pr list` must not
  // load the plugin for them.
  host.contribute("pr list", { listCompletions: () => ["ptag:flaky"] });

  host.contribute("issue show", {
    showSection: (entity) => {
      const tags = tagsOf(entity);
      return tags.length === 0 ? [] : [`Probe tags: ${tags.join(", ")}`];
    },
  });
}
