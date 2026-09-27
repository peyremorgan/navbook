/**
 * `nav feature <verb>` — spec 04 §4.3.
 *
 * A feature has no lifecycle and no discussion, so it borrows none of the
 * shared entity verbs: what it can be asked is what it is, what documents
 * describe it, and what has happened to it.
 *
 * The commands themselves are the ones that used to be built into the CLI,
 * reached through the plugin host instead. `host.ui` is what keeps them
 * looking like built-ins: the same table renderer, the same composing path
 * through `$EDITOR`, the same `fail` that becomes exit code 1.
 */

import type { CliPluginHost } from "@navbook/cli/plugin";
import type { EntityRecord } from "@navbook/core";
import {
  newFeatureFile,
  newSpecFile,
  readFeatures,
  specFileName,
  useCore,
  validateFeature,
  validateSpec,
} from "../core/files.ts";
import { featureJson, specJson } from "../core/json.ts";
import {
  addSpec,
  applyFeatureEdit,
  type Core,
  createFeature,
  featureCommits,
  featureMembers,
  findFeature,
  referencedFeatures,
  requireSpecFileName,
  resolveFeature,
  resolveFeatureForEdit,
  revalidateFeatureFile,
} from "../core/ops.ts";
import { kbOf } from "../core/tree.ts";

export function activate(host: CliPluginHost): void {
  const { core, ctx, ui } = host;
  // Each entry sets it: a host may load this one without the core entry —
  // `nav feature hello` needs no tree — and the format helpers must still have
  // a core to call. Setting it twice with the same instance is a no-op.
  useCore(core);

  /* ------------------------------------------------------------------ open */

  host.command("feature open", ([title], opts) => {
    if ((title ?? "").trim() === "") ui.fail("a feature needs a title");
    const { created } = core.prepareOpen(ctx);

    const composed = ui.composeFile({
      ...(opts.message === undefined ? {} : { message: String(opts.message) }),
      bufferName: "NAVBOOK_FEATURE.md",
      noun: "feature",
      // A feature is named by its title; the documents beside it carry the
      // detail, so an empty summary is a reasonable thing to commit.
      allowEmptyBody: true,
      render: (body) =>
        newFeatureFile({
          title: title as string,
          author: core.currentAuthor(ctx),
          created,
          ...(body ? { body } : {}),
        }),
      validate: validateFeature,
    });

    const { slug, dirPath, run } = createFeature(
      core,
      ctx,
      {
        content: composed.content,
        ...(opts.slug === undefined ? {} : { slug: String(opts.slug) }),
        fallbackTitle: title as string,
      },
      { commit: opts.commit === true },
    );

    ctx.stdout.write(`Created ${ctx.navDir}/${dirPath}/  (${slug})\n`);
    if (opts.commit) ctx.stdout.write(`${ui.commitReport(run)}\n`);
  });

  /* ------------------------------------------------------------------ list */

  host.command("feature list", (_args, opts) => {
    const repo = core.loadRepo(ctx, { comments: "none" });
    const rows = kbOf(repo.ext).features.map((feature) => {
      const attached = featureMembers(core, repo, feature.slug);
      return { feature, entities: [...attached.issues, ...attached.prs] };
    });

    if (opts.json) {
      if (rows.length === 0) return;
      const objects = rows.map(({ feature, entities }) =>
        featureJson(ctx.navDir, feature, memberIds(entities)),
      );
      ctx.stdout.write(`${core.toNdjson(objects)}\n`);
      return;
    }
    if (rows.length === 0) {
      ctx.stdout.write("No features yet.\n");
      return;
    }

    const cells = rows.map(({ feature, entities }) => [
      feature.slug,
      feature.title,
      String(feature.specs.length),
      String(entities.filter((entity) => entity.status === "open").length),
      String(entities.filter((entity) => entity.status !== "open").length),
    ]);
    ctx.stdout.write(
      `${ui.renderTable(
        [
          { header: "slug" },
          { header: "title", flexible: true, minWidth: 20 },
          { header: "specs" },
          { header: "open" },
          { header: "closed" },
        ],
        cells,
      )}\n`,
    );
  });

  /* ------------------------------------------------------------------ show */

  host.command("feature show", ([slug], opts) => {
    // Refused rather than read as "no history", and before anything is read:
    // a value that is not a whole number would otherwise drop the section, or
    // reach git and be refused there, and either way look like a feature
    // nothing has touched.
    const limit = opts.commits === undefined ? 10 : Number(opts.commits);
    if (!Number.isInteger(limit) || limit < 0) ui.fail("--commits takes a whole number of commits");
    const repo = core.loadRepo(ctx, { comments: "none" });
    const feature = resolveFeature(core, repo, slug as string);
    const attached = featureMembers(core, repo, feature.slug);

    if (opts.json) {
      const members = memberIds([...attached.issues, ...attached.prs]);
      ctx.stdout.write(`${JSON.stringify(featureJson(ctx.navDir, feature, members))}\n`);
      return;
    }

    const c = ctx.colors;
    const lines: string[] = [c.bold(feature.slug), ""];
    const label = (text: string): string => c.dim(`${text}:`.padEnd(11));
    lines.push(`${label("title")}${feature.title}`);
    if (typeof feature.fm.author === "string") lines.push(`${label("author")}${feature.fm.author}`);
    if (typeof feature.fm.created === "string") {
      lines.push(`${label("created")}${feature.fm.created}`);
    }
    lines.push(`${label("path")}${ctx.navDir}/${feature.dirPath}`);

    const summary = feature.body.trim();
    if (summary !== "") lines.push("", summary);

    lines.push("", c.dim(`specs (${feature.specs.length}):`));
    if (feature.specs.length === 0) lines.push(c.dim("  none"));
    for (const spec of feature.specs) lines.push(`  ${ui.pad(spec.fileName, 28)}${spec.title}`);

    const entities = [...attached.issues, ...attached.prs];
    lines.push("", c.dim(`issues and pull requests (${entities.length}):`));
    if (entities.length === 0) lines.push(c.dim("  none"));
    for (const entity of entities) {
      lines.push(`  #${entity.id}  ${entity.status.padEnd(7)}${entity.title}`);
    }

    if (limit > 0) {
      const commits = featureCommits(core, ctx, feature, attached, { limit });
      lines.push("", c.dim(`recent commits (${commits.length}):`));
      if (commits.length === 0) lines.push(c.dim("  none"));
      for (const commit of commits) {
        lines.push(`  ${c.dim(commit.sha.slice(0, 8))}  ${commit.subject}`);
      }
    }

    ctx.stdout.write(`${lines.join("\n")}\n`);
  });

  /* ------------------------------------------------------------------ edit */

  host.command("feature edit", ([slug], opts) => {
    editInPlace(slug as string, undefined, opts.commit === true);
  });

  /* ----------------------------------------------------------------- specs */

  host.command("feature spec add", ([slug, title], opts) => {
    if ((title ?? "").trim() === "") ui.fail("a specification document needs a title");
    // Resolved first: being told the feature does not exist is worth much more
    // before an editor has been filled in than after.
    const feature = findFeature(core, ctx, slug as string);
    const fileName = requireSpecFileName(
      core,
      opts.file === undefined ? specFileName(title as string) : String(opts.file),
    );

    const composed = ui.composeFile({
      ...(opts.message === undefined ? {} : { message: String(opts.message) }),
      bufferName: "NAVBOOK_SPEC.md",
      noun: "specification document",
      render: (body) => newSpecFile({ title: title as string, body }),
      validate: validateSpec,
    });

    const added = addSpec(
      core,
      ctx,
      feature.slug,
      { content: composed.content, fileName },
      { commit: opts.commit === true },
    );
    ctx.stdout.write(`Created ${ctx.navDir}/${added.path}\n`);
    if (opts.commit) ctx.stdout.write(`${ui.commitReport(added.run)}\n`);
  });

  host.command("feature spec edit", ([slug, file], opts) => {
    editInPlace(slug as string, file as string, opts.commit === true);
  });

  host.command("feature spec list", ([slug], opts) => {
    const feature = findFeature(core, ctx, slug as string);

    if (opts.json) {
      if (feature.specs.length === 0) return;
      const objects = feature.specs.map((spec) => specJson(ctx.navDir, feature, spec));
      ctx.stdout.write(`${core.toNdjson(objects)}\n`);
      return;
    }
    if (feature.specs.length === 0) {
      ctx.stdout.write(`Feature '${feature.slug}' has no specification documents yet.\n`);
      return;
    }
    ctx.stdout.write(
      `${ui.renderTable(
        [{ header: "file" }, { header: "title", flexible: true, minWidth: 20 }],
        feature.specs.map((spec) => [spec.fileName, spec.title]),
      )}\n`,
    );
  });

  /* --------------------------------------------------- contributed to others */

  // `--feature` on `issue open` and `pr open`, whose values become the
  // frontmatter key. The host writes it with the same composer that writes the
  // format's own keys, so it lands in the file exactly as a built-in would.
  const openFields = (opts: Record<string, unknown>): Record<string, readonly string[]> => {
    const values = Array.isArray(opts.feature) ? (opts.feature as string[]) : [];
    return values.length > 0 ? { feature: values } : {};
  };
  host.contribute("issue open", { openFields });
  host.contribute("pr open", { openFields });

  const listCompletions = (): string[] => featureSlugs().map((slug) => `feature:${slug}`);
  host.contribute("issue list", { listCompletions });
  host.contribute("pr list", { listCompletions });

  /* ----------------------------------------------------------- completions */

  host.completer("slug", () => featureSlugs());
  host.completer("spec-file", (words) => {
    // The slug is whichever word precedes the one being completed.
    const slug = words[words.length - 1];
    if (slug === undefined) return [];
    try {
      const repo = core.loadRepo(ctx, { comments: "none" });
      return (
        kbOf(repo.ext)
          .featureBySlug.get(slug)
          ?.specs.map((spec) => spec.fileName) ?? []
      );
    } catch {
      return [];
    }
  });

  /* -------------------------------------------------------------- helpers */

  /** Open a feature file or one of its documents in `$EDITOR` and record it. */
  function editInPlace(slug: string, fileName: string | undefined, commit: boolean): void {
    const target = resolveFeatureForEdit(core, ctx, slug, fileName);
    ui.editFile(target.path);

    const problems = revalidateFeatureFile(core, target.path, target.spec !== undefined);
    if (problems.length > 0) {
      ui.fail(
        `${ctx.navDir}/${target.filePath} is no longer valid; it was left as you saved it`,
        problems.map((problem) => `  ${problem}`),
      );
    }

    const run = applyFeatureEdit(core, ctx, target, { commit });
    ctx.stdout.write(`Edited ${ctx.navDir}/${target.filePath}\n`);
    if (commit) ctx.stdout.write(`${ui.commitReport(run)}\n`);
  }

  /**
   * Feature slugs offered for completion: those that exist, and those named.
   *
   * A slug an entity names but no directory holds is offered too — it is what
   * somebody typed, and completing it is how they find the typo (D14).
   */
  function featureSlugs(): string[] {
    try {
      return referencedFeatures(core, core.loadRepo(ctx, { comments: "none" }));
    } catch {
      return [];
    }
  }
}

/**
 * The `issues` and `prs` keys a feature's JSON carries.
 *
 * Both `list` and `show` emit them, and both emit IDs: a key must not change
 * type between commands, which is what makes the projection worth diffing
 * across implementations (spec 04 §4.2).
 */
function memberIds(entities: readonly EntityRecord[]): { issues: string[]; prs: string[] } {
  return {
    issues: entities.filter((e) => e.kind === "issue").map((e) => e.id),
    prs: entities.filter((e) => e.kind === "pr").map((e) => e.id),
  };
}

export type { Core };
export { readFeatures };
