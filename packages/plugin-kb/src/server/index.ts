/**
 * The knowledge base's half of the API — spec 06 §6.3.
 *
 * The resolvers that used to sit in `@navbook/server`, registered instead. The
 * schema beside them (`schema.graphql`) is merged into the one the server
 * serves, so `Query.features` and the four mutations exist exactly when this
 * plugin is loaded and not otherwise.
 *
 * Every write goes through `ctx.sync.write`, the same transaction the built-in
 * mutations use, and reports through `host.api.commitInfo` — which is what
 * makes a feature's commit emit the mutation event a chat bridge subscribes
 * to, without this file knowing that bridges exist.
 *
 * The resolvers are hand-typed against the records this plugin builds rather
 * than generated. A plugin's SDL is only a schema in combination with the
 * host's, so generating types for it means running codegen over both, which is
 * a build step this package does not otherwise need. The shapes are small and
 * the SDL is beside them.
 */

import { readFileSync } from "node:fs";
import type { EntityRecord } from "@navbook/core";
import type { GraphQLCtx, ServerPluginHost } from "@navbook/server/plugin";
import {
  newFeatureFile,
  newSpecFile,
  readFeatures,
  specFileName,
  useCore,
  validateFeature,
  validateSpec,
} from "../core/files.ts";
import {
  addSpec,
  createFeature,
  editFeature,
  editSpec,
  featureCommits,
  featureMembers,
  findFeature,
  resolveFeature,
  resolveSpec,
} from "../core/ops.ts";
import type { FeatureRecord, SpecRecord } from "../core/tree.ts";
import { kbOf } from "../core/tree.ts";
import { applyFeaturePatch, applySpecPatch, isEmptySpecPatch } from "./patch.ts";

/** What a `Spec` resolver is handed: the document and the feature holding it. */
interface SpecParent {
  feature: FeatureRecord;
  spec: SpecRecord;
}

const COMMIT = { commit: true } as const;

export function activate(host: ServerPluginHost): void {
  const { core, api } = host;
  // Each entry sets it: a host may load this one without the core entry —
  // `nav feature hello` needs no tree — and the format helpers must still have
  // a core to call. Setting it twice with the same instance is a no-op.
  useCore(core);

  /**
   * Blob hashes for a feature's files, worked out once per record.
   *
   * `baseSha` is asked for on the identity card and on every document, and one
   * `git hash-object` per file would make a listing cost a subprocess apiece.
   *
   * Keyed by the record rather than by its slug, which is what makes it
   * correct as well as cheap. A write reads its feature back afterwards, so
   * its payload holds a *new* record; two writes to one feature in a single
   * request would otherwise have the second reported with the first's hashes,
   * and a client that saved with one of those would be refused as out of date.
   */
  const hashes = new WeakMap<FeatureRecord, Map<string, string>>();

  function hashesOf(ctx: GraphQLCtx, feature: FeatureRecord): Map<string, string> {
    const cached = hashes.get(feature);
    if (cached) return cached;
    const paths = [feature.filePath, ...feature.specs.map((spec) => spec.path)];
    const hashed = core.hashObjects(
      ctx.ws.repoRoot,
      paths.map((path) => core.absPath(ctx.ws, path)),
    );
    const keyed = new Map<string, string>();
    for (const path of paths) {
      const found = hashed.get(core.absPath(ctx.ws, path));
      if (found !== undefined) keyed.set(path, found);
    }
    hashes.set(feature, keyed);
    return keyed;
  }

  /**
   * The hash of one file, or an empty string when git could not tell.
   *
   * Empty is the safe answer: an edit compares what it was handed against what
   * the file hashes to now, and a value that can never match is refused. The
   * answer that could lose work is a wrong "unchanged", and there is no way to
   * produce one from here.
   */
  const hashOf = (ctx: GraphQLCtx, feature: FeatureRecord, filePath: string): string =>
    hashesOf(ctx, feature).get(filePath) ?? "";

  const text = (fm: Record<string, unknown>, key: string): string =>
    typeof fm[key] === "string" ? (fm[key] as string) : "";

  /** The feature as a write has just left it, read back inside the transaction. */
  function featureAfter(ctx: GraphQLCtx, slug: string): FeatureRecord {
    ctx.invalidateRepo();
    return findFeature(core, ctx.ws, slug);
  }

  function specAfter(
    ctx: GraphQLCtx,
    slug: string,
    fileName: string,
  ): { feature: FeatureRecord; spec: SpecParent } {
    const feature = featureAfter(ctx, slug);
    return { feature, spec: { feature, spec: resolveSpec(core, feature, fileName) } };
  }

  // The `features` this plugin's SDL adds to `OpenIssueInput`, `EntityFilter`
  // and the two update inputs. The host composes the file and builds the
  // query; these say what its own field means in each.
  host.entityInput({
    openFields: (input): Record<string, string | readonly string[]> => {
      const values = input.features;
      return Array.isArray(values) && values.length > 0 ? { feature: values as string[] } : {};
    },
    patchFields: (input) => {
      // Present-and-null clears the key, as it does for the format's own
      // multi-valued fields; absent leaves it alone.
      const values = input.features;
      return values === undefined ? {} : { feature: values };
    },
    filterTerms: (filter): Record<string, string[]> => {
      const values = filter.features;
      return Array.isArray(values) && values.length > 0 ? { feature: values as string[] } : {};
    },
  });

  // The same value `Issue.features` gives, on the host's own list-row
  // fragment. A plugin's fragment cannot extend one the host wrote, so a
  // feature chip beside an issue in a listing has no other way to be drawn;
  // `entity.ext.kb.features` is what the row badge reads (see `entityExt`).
  host.entityExt((entity) => ({ features: readFeatures(entity.fm) }));

  host.resolvers({
    Query: {
      // `sync.read` rather than `ctx.repo()`, which is what every built-in
      // top-level query uses: a *root* field brings the clone up to date first,
      // and a field beneath one reads the tree its parent already saw. Reading
      // through the memo here would answer from whatever the clone last
      // fetched, which is a feature somebody pushed a moment ago going missing.
      features: (_parent: unknown, _args: unknown, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => kbOf(core.loadRepo(ctx.ws).ext).features)),
      feature: (_parent: unknown, { slug }: { slug: string }, ctx: GraphQLCtx) =>
        api.run(() => ctx.sync.read(() => resolveFeature(core, core.loadRepo(ctx.ws), slug))),
    },

    // Membership is the entity's own assertion, so it is read off its
    // frontmatter rather than looked up anywhere (spec 02 §2.11).
    Entity: { features: (entity: EntityRecord) => readFeatures(entity.fm) },
    Issue: { features: (entity: EntityRecord) => readFeatures(entity.fm) },
    Pr: { features: ({ entity }: { entity: EntityRecord }) => readFeatures(entity.fm) } as never,

    Feature: {
      summary: (feature: FeatureRecord) => feature.body.trim(),
      author: (feature: FeatureRecord) => text(feature.fm, "author"),
      created: (feature: FeatureRecord) => text(feature.fm, "created"),
      path: (feature: FeatureRecord, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${feature.dirPath}`,
      baseSha: (feature: FeatureRecord, _args: unknown, ctx: GraphQLCtx) =>
        hashOf(ctx, feature, feature.filePath),
      specs: (feature: FeatureRecord) => feature.specs.map((spec) => ({ feature, spec })),

      issues: async (feature: FeatureRecord, _args: unknown, ctx: GraphQLCtx) =>
        featureMembers(core, await ctx.repo(), feature.slug).issues,
      prs: async (feature: FeatureRecord, _args: unknown, ctx: GraphQLCtx) =>
        featureMembers(core, await ctx.repo(), feature.slug).prs.map((entity) => ({
          entity,
          refs: [],
        })),

      commits: async (feature: FeatureRecord, args: { limit: number }, ctx: GraphQLCtx) => {
        const members = featureMembers(core, await ctx.repo(), feature.slug);
        // Under the lock but without a pull: a field must see the tree its
        // parent saw, and the parent's own read has already brought the clone
        // up to date.
        return api.run(() =>
          ctx.sync.locked(() =>
            featureCommits(core, ctx.ws, feature, members, { limit: args.limit }),
          ),
        );
      },
    },

    Spec: {
      fileName: ({ spec }: SpecParent) => spec.fileName,
      title: ({ spec }: SpecParent) => spec.title,
      body: ({ spec }: SpecParent) => spec.body.trim(),
      path: ({ spec }: SpecParent, _args: unknown, ctx: GraphQLCtx) =>
        `${ctx.ws.navDir}/${spec.path}`,
      baseSha: ({ feature, spec }: SpecParent, _args: unknown, ctx: GraphQLCtx) =>
        hashOf(ctx, feature, spec.path),
    },

    Commit: { date: (commit: { date: Date }) => core.toIsoSeconds(commit.date) },

    Mutation: {
      createFeature: (
        _parent: unknown,
        { input }: { input: { title: string; slug?: string | null; summary?: string | null } },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          api.requireText(input.title, "title");
          const { result, pushed } = await ctx.sync.write(
            () => {
              const { created } = core.prepareOpen(ctx.ws);
              const content = newFeatureFile({
                title: input.title,
                author: core.currentAuthor(ctx.ws),
                created,
                // A feature may have no summary, so an absent one is absent
                // rather than refused the way an issue with no description is.
                ...(input.summary ? { body: input.summary } : {}),
              });
              api.checkComposed(content, validateFeature, "feature");

              const opened = createFeature(
                core,
                ctx.ws,
                {
                  content,
                  ...(input.slug ? { slug: input.slug } : {}),
                  fallbackTitle: input.title,
                },
                COMMIT,
              );
              return { run: opened.run, feature: featureAfter(ctx, opened.slug) };
            },
            (opened) => opened.run.committed,
          );
          return { feature: result.feature, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      updateFeature: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            slug: string;
            title?: string | null;
            summary?: string | null;
            baseSha?: string | null;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          if (input.title === undefined && input.summary === undefined) {
            throw api.invalidInput("the patch names no field to change");
          }
          const { result, pushed } = await ctx.sync.write(
            () => {
              const feature = findFeature(core, ctx.ws, input.slug);
              const before = readFileSync(core.absPath(ctx.ws, feature.filePath), "utf8");
              const patched = applyFeaturePatch(
                core,
                before,
                input,
                core.repoPath(ctx.ws.navDir, feature.filePath),
              );
              api.checkComposed(patched, validateFeature, "feature");

              // Nothing is written before the operation runs: `editFeature`
              // takes the finished text, so its guards — the stale check among
              // them — all run before any file is touched.
              const edited = editFeature(core, ctx.ws, feature.slug, patched, {
                commit: true,
                ...(input.baseSha ? { baseSha: input.baseSha } : {}),
              });
              return { run: edited.run, feature: featureAfter(ctx, feature.slug) };
            },
            (edited) => edited.run.committed,
          );
          return { feature: result.feature, commit: api.commitInfo(ctx, result.run, pushed) };
        }),

      addSpec: (
        _parent: unknown,
        {
          input,
        }: { input: { feature: string; title: string; body: string; fileName?: string | null } },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          api.requireText(input.title, "title");
          api.requireText(input.body, "body");
          const { result, pushed } = await ctx.sync.write(
            () => {
              const content = newSpecFile({ title: input.title, body: input.body });
              api.checkComposed(content, validateSpec, "specification document");
              const added = addSpec(
                core,
                ctx.ws,
                input.feature,
                { content, fileName: input.fileName ?? specFileName(input.title) },
                COMMIT,
              );
              return { run: added.run, ...specAfter(ctx, added.feature.slug, added.fileName) };
            },
            (added) => added.run.committed,
          );
          return {
            feature: result.feature,
            spec: result.spec,
            commit: api.commitInfo(ctx, result.run, pushed),
          };
        }),

      updateSpec: (
        _parent: unknown,
        {
          input,
        }: {
          input: {
            feature: string;
            fileName: string;
            title?: string | null;
            body?: string | null;
            baseSha: string;
          };
        },
        ctx: GraphQLCtx,
      ) =>
        api.run(async () => {
          if (isEmptySpecPatch(input)) throw api.invalidInput("the patch names no field to change");
          const { result, pushed } = await ctx.sync.write(
            () => {
              const feature = findFeature(core, ctx.ws, input.feature);
              const spec = resolveSpec(core, feature, input.fileName);
              const before = readFileSync(core.absPath(ctx.ws, spec.path), "utf8");
              const patched = applySpecPatch(
                core,
                before,
                input,
                core.repoPath(ctx.ws.navDir, spec.path),
              );
              api.checkComposed(patched, validateSpec, "specification document");
              const edited = editSpec(core, ctx.ws, feature.slug, spec.fileName, patched, {
                commit: true,
                baseSha: input.baseSha,
              });
              return { run: edited.run, ...specAfter(ctx, feature.slug, spec.fileName) };
            },
            (edited) => edited.run.committed,
          );
          return {
            feature: result.feature,
            spec: result.spec,
            commit: api.commitInfo(ctx, result.run, pushed),
          };
        }),
    },
  });
}
