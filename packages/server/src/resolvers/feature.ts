/**
 * The `Feature` and `Spec` projections.
 *
 * One of these fields reaches outside the parsed tree: `commits` walks
 * history. Everything else, `baseSha` included, is the record `parseTree`
 * already built.
 */

import { featureCommits, featureMembers, toIsoSeconds } from "@navbook/core";
import { run } from "../errors.ts";
import type {
  CommitResolvers,
  FeatureResolvers,
  SpecResolvers,
} from "../generated/resolver-types.ts";
import type { PrParent } from "../mappers.ts";

const text = (fm: Record<string, unknown>, key: string): string =>
  typeof fm[key] === "string" ? (fm[key] as string) : "";

export const Feature: FeatureResolvers = {
  summary: (feature) => feature.body.trim(),
  author: (feature) => text(feature.fm, "author"),
  created: (feature) => text(feature.fm, "created"),
  path: (feature, _args, ctx) => `${ctx.ws.navDir}/${feature.dirPath}`,
  baseSha: (feature) => feature.blobSha,
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
  baseSha: ({ spec }) => spec.blobSha,
};

export const Commit: CommitResolvers = {
  date: (commit) => toIsoSeconds(commit.date),
};
