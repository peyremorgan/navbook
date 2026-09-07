/**
 * `nav feature <verb>` — spec 04 §4.3.
 *
 * A feature has no lifecycle and no discussion, so it borrows none of the
 * shared entity verbs: what it can be asked is what it is, what documents
 * describe it, and what has happened to it.
 */

import {
  addSpec,
  applyFeatureEdit,
  commitReport,
  createFeature,
  currentAuthor,
  type EntityRecord,
  featureCommits,
  featureJson,
  featureMembers,
  findFeature,
  loadRepo,
  newFeatureFile,
  newSpecFile,
  prepareOpen,
  referencedFeatures,
  requireSpecFileName,
  resolveFeature,
  resolveFeatureForEdit,
  revalidateFeatureFile,
  specFileName,
  specJson,
  toNdjson,
  validateFeature,
  validateSpec,
} from "@navbook/core";
import type { Ctx } from "../context.ts";
import { openInEditor } from "../editor.ts";
import { fail } from "../errors.ts";
import { type Column, renderTable } from "../render/table.ts";
import { composeFile } from "./compose.ts";
import type { GlobalFlags } from "./entity.ts";

/* --------------------------------------------------------------------- open */

export interface FeatureOpenOptions extends GlobalFlags {
  message?: string;
  slug?: string;
}

export function cmdFeatureOpen(ctx: Ctx, title: string, opts: FeatureOpenOptions): void {
  if (title.trim() === "") fail("a feature needs a title");
  const { created } = prepareOpen(ctx);

  const composed = composeFile(ctx, {
    ...(opts.message === undefined ? {} : { message: opts.message }),
    bufferName: "NAVBOOK_FEATURE.md",
    noun: "feature",
    // A feature is named by its title; the documents beside it carry the detail.
    allowEmptyBody: true,
    render: (body) =>
      newFeatureFile({ title, author: currentAuthor(ctx), created, ...(body ? { body } : {}) }),
    validate: validateFeature,
  });

  const { slug, dirPath, run } = createFeature(
    ctx,
    {
      content: composed.content,
      ...(opts.slug === undefined ? {} : { slug: opts.slug }),
      fallbackTitle: title,
    },
    { commit: opts.commit },
  );

  ctx.stdout.write(`Created ${ctx.navDir}/${dirPath}/  (${slug})\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

/* --------------------------------------------------------------------- list */

export function cmdFeatureList(ctx: Ctx, opts: GlobalFlags): void {
  const repo = loadRepo(ctx, { comments: "none" });
  const rows = repo.features.map((feature) => {
    const attached = featureMembers(repo, feature.slug);
    return { feature, entities: [...attached.issues, ...attached.prs] };
  });

  if (opts.json) {
    if (rows.length === 0) return;
    const objects = rows.map(({ feature, entities }) =>
      featureJson(ctx.navDir, feature, memberIds(entities)),
    );
    ctx.stdout.write(`${toNdjson(objects)}\n`);
    return;
  }
  if (rows.length === 0) {
    ctx.stdout.write("No features yet.\n");
    return;
  }

  const columns: Column[] = [
    { header: "slug" },
    { header: "title", flexible: true, minWidth: 20 },
    { header: "specs" },
    { header: "open" },
    { header: "closed" },
  ];
  const cells = rows.map(({ feature, entities }) => [
    feature.slug,
    feature.title,
    String(feature.specs.length),
    String(entities.filter((entity) => entity.status === "open").length),
    String(entities.filter((entity) => entity.status !== "open").length),
  ]);
  ctx.stdout.write(
    `${renderTable(columns, cells, { colors: ctx.colors, width: terminalWidth(ctx) })}\n`,
  );
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

/* --------------------------------------------------------------------- show */

export interface FeatureShowOptions extends GlobalFlags {
  commits?: number;
}

export function cmdFeatureShow(ctx: Ctx, slug: string, opts: FeatureShowOptions): void {
  const repo = loadRepo(ctx, { comments: "none" });
  const feature = resolveFeature(repo, slug);
  const attached = featureMembers(repo, feature.slug);

  if (opts.json) {
    ctx.stdout.write(
      `${JSON.stringify(featureJson(ctx.navDir, feature, memberIds([...attached.issues, ...attached.prs])))}\n`,
    );
    return;
  }

  const c = ctx.colors;
  const lines: string[] = [c.bold(feature.slug), ""];
  const label = (text: string) => c.dim(`${text}:`.padEnd(11));
  lines.push(`${label("title")}${feature.title}`);
  if (typeof feature.fm.author === "string") lines.push(`${label("author")}${feature.fm.author}`);
  if (typeof feature.fm.created === "string")
    lines.push(`${label("created")}${feature.fm.created}`);
  lines.push(`${label("path")}${ctx.navDir}/${feature.dirPath}`);

  const summary = feature.body.trim();
  if (summary !== "") lines.push("", summary);

  lines.push("", c.dim(`specs (${feature.specs.length}):`));
  if (feature.specs.length === 0) lines.push(c.dim("  none"));
  for (const spec of feature.specs) {
    lines.push(`  ${spec.fileName.padEnd(28)}${spec.title}`);
  }

  const entities = [...attached.issues, ...attached.prs];
  lines.push("", c.dim(`issues and pull requests (${entities.length}):`));
  if (entities.length === 0) lines.push(c.dim("  none"));
  for (const entity of entities) {
    lines.push(`  #${entity.id}  ${entity.status.padEnd(7)}${entity.title}`);
  }

  const limit = opts.commits ?? 10;
  if (limit > 0) {
    const commits = featureCommits(ctx, feature, attached, { limit });
    lines.push("", c.dim(`recent commits (${commits.length}):`));
    if (commits.length === 0) lines.push(c.dim("  none"));
    for (const commit of commits) {
      lines.push(`  ${c.dim(commit.sha.slice(0, 8))}  ${commit.subject}`);
    }
  }

  ctx.stdout.write(`${lines.join("\n")}\n`);
}

/* --------------------------------------------------------------------- edit */

export function cmdFeatureEdit(ctx: Ctx, slug: string, opts: GlobalFlags): void {
  editInPlace(ctx, slug, undefined, opts);
}

/* -------------------------------------------------------------------- specs */

export interface SpecAddOptions extends GlobalFlags {
  message?: string;
  file?: string;
}

export function cmdSpecAdd(ctx: Ctx, slug: string, title: string, opts: SpecAddOptions): void {
  if (title.trim() === "") fail("a specification document needs a title");
  // Resolved first: being told the feature does not exist is worth much more
  // before an editor has been filled in than after.
  const feature = findFeature(ctx, slug);
  const fileName = requireSpecFileName(opts.file ?? specFileName(title));

  const composed = composeFile(ctx, {
    ...(opts.message === undefined ? {} : { message: opts.message }),
    bufferName: "NAVBOOK_SPEC.md",
    noun: "specification document",
    render: (body) => newSpecFile({ title, body }),
    validate: validateSpec,
  });

  const added = addSpec(
    ctx,
    feature.slug,
    { content: composed.content, fileName },
    { commit: opts.commit },
  );
  ctx.stdout.write(`Created ${ctx.navDir}/${added.path}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(added.run)}\n`);
}

export function cmdSpecEdit(ctx: Ctx, slug: string, file: string, opts: GlobalFlags): void {
  editInPlace(ctx, slug, file, opts);
}

export function cmdSpecList(ctx: Ctx, slug: string, opts: GlobalFlags): void {
  const feature = findFeature(ctx, slug);

  if (opts.json) {
    if (feature.specs.length === 0) return;
    const objects = feature.specs.map((spec) => specJson(ctx.navDir, feature, spec));
    ctx.stdout.write(`${toNdjson(objects)}\n`);
    return;
  }
  if (feature.specs.length === 0) {
    ctx.stdout.write(`Feature '${feature.slug}' has no specification documents yet.\n`);
    return;
  }
  const columns: Column[] = [{ header: "file" }, { header: "title", flexible: true, minWidth: 20 }];
  const rows = feature.specs.map((spec) => [spec.fileName, spec.title]);
  ctx.stdout.write(
    `${renderTable(columns, rows, { colors: ctx.colors, width: terminalWidth(ctx) })}\n`,
  );
}

/* ------------------------------------------------------------------ helpers */

/** Open a feature file or one of its documents in `$EDITOR` and record it. */
function editInPlace(
  ctx: Ctx,
  slug: string,
  fileName: string | undefined,
  opts: GlobalFlags,
): void {
  const target = resolveFeatureForEdit(ctx, slug, fileName);
  openInEditor(ctx, target.path);

  const problems = revalidateFeatureFile(target.path, target.spec !== undefined);
  if (problems.length > 0) {
    fail(
      `${ctx.navDir}/${target.filePath} is no longer valid; it was left as you saved it`,
      problems.map((problem) => `  ${problem}`),
    );
  }

  const run = applyFeatureEdit(ctx, target, { commit: opts.commit });
  ctx.stdout.write(`Edited ${ctx.navDir}/${target.filePath}\n`);
  if (opts.commit) ctx.stdout.write(`${commitReport(run)}\n`);
}

function terminalWidth(ctx: Ctx): number | undefined {
  const columns = ctx.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : undefined;
}

/**
 * Feature slugs offered for completion: those that exist, and those named.
 *
 * A slug an entity names but no directory holds is offered too — it is what
 * somebody typed, and completing it is how they find the typo (D14).
 */
export function featureSlugs(ctx: Ctx): string[] {
  try {
    return referencedFeatures(loadRepo(ctx, { comments: "none" }));
  } catch {
    return [];
  }
}
