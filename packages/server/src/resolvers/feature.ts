/**
 * The `Feature` and `Spec` projections.
 *
 * Two of these fields do reach outside the parsed tree, and both are named for
 * it: `commits` walks history, and `baseSha` asks git what a file's contents
 * hash to. Everything else is the record `parseTree` already built.
 */

import { absPath, featureCommits, featureMembers, hashObjects, toIsoSeconds } from "@navbook/core";
import type { GraphQLCtx } from "../context.ts";
import { run } from "../errors.ts";
import type {
  CommitResolvers,
  FeatureResolvers,
  SpecResolvers,
} from "../generated/resolver-types.ts";
import type { FeatureParent, PrParent } from "../mappers.ts";

/**
 * Blob hashes for a feature's files, worked out once per record.
 *
 * `baseSha` is asked for on the identity card and on every document, and one
 * `git hash-object` per file would make a listing cost a subprocess a piece.
 *
 * Keyed by the record rather than by its slug, which is what makes it correct
 * as well as cheap. A write reads its feature back afterwards, so its payload
 * holds a *new* record; two writes to one feature in a single request would
 * otherwise have the second reported with the first's hashes, and a client
 * that saved with one of those would be refused as out of date. A fresh record
 * gets a fresh answer, and a record that never changes is only hashed once.
 */
const HASHES = new WeakMap<FeatureParent, Map<string, string>>();

/** Every file of one feature, hashed in a single call, keyed by tree path. */
function hashesOf(ctx: GraphQLCtx, feature: FeatureParent): Map<string, string> {
  const cached = HASHES.get(feature);
  if (cached) return cached;

  const paths = [feature.filePath, ...feature.specs.map((spec) => spec.path)];
  const hashed = hashObjects(
    ctx.ws.repoRoot,
    paths.map((path) => absPath(ctx.ws, path)),
  );
  const keyed = new Map<string, string>();
  for (const path of paths) {
    const found = hashed.get(absPath(ctx.ws, path));
    if (found !== undefined) keyed.set(path, found);
  }
  HASHES.set(feature, keyed);
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
function hashOf(ctx: GraphQLCtx, feature: FeatureParent, filePath: string): string {
  return hashesOf(ctx, feature).get(filePath) ?? "";
}

const text = (fm: Record<string, unknown>, key: string): string =>
  typeof fm[key] === "string" ? (fm[key] as string) : "";

export const Feature: FeatureResolvers = {
  summary: (feature) => feature.body.trim(),
  author: (feature) => text(feature.fm, "author"),
  created: (feature) => text(feature.fm, "created"),
  path: (feature, _args, ctx) => `${ctx.ws.navDir}/${feature.dirPath}`,
  baseSha: (feature, _args, ctx) => hashOf(ctx, feature, feature.filePath),
  specs: (feature) => feature.specs.map((spec) => ({ feature, spec })),

  issues: async (feature, _args, ctx) => featureMembers(await ctx.repo(), feature.slug).issues,
  prs: async (feature, _args, ctx): Promise<PrParent[]> =>
    featureMembers(await ctx.repo(), feature.slug).prs.map((entity) => ({ entity, refs: [] })),

  commits: async (feature, args, ctx) => {
    const members = featureMembers(await ctx.repo(), feature.slug);
    // Under the lock but without a pull: a field must see the tree its parent
    // saw, and the parent's own read has already brought the clone up to date.
    return run(() =>
      ctx.sync.locked(() => featureCommits(ctx.ws, feature, members, { limit: args.limit })),
    );
  },
};

export const Spec: SpecResolvers = {
  fileName: ({ spec }) => spec.fileName,
  title: ({ spec }) => spec.title,
  body: ({ spec }) => spec.body.trim(),
  path: ({ spec }, _args, ctx) => `${ctx.ws.navDir}/${spec.path}`,
  baseSha: ({ feature, spec }, _args, ctx) => hashOf(ctx, feature, spec.path),
};

export const Commit: CommitResolvers = {
  date: (commit) => toIsoSeconds(commit.date),
};
