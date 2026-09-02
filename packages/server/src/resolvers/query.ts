/**
 * The read half of the API.
 *
 * Each field is one call into `ops/`, wrapped in the sync engine's read
 * transaction so the clone is up to date with the remote before anything is
 * parsed (spec 06 §6.3). Nothing here interprets the tree itself.
 */

import {
  findEntity,
  listEntities,
  listPrsAcrossRefs,
  locatePr,
  runDoctor,
  WorkspaceError,
} from "@navbook/core";
import { run } from "../errors.ts";
import type { QueryResolvers } from "../generated/resolver-types.ts";
import type { PrParent } from "../mappers.ts";
import { toQuery } from "./map.ts";

export const Query: QueryResolvers = {
  issues: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => listEntities(ctx.ws, "issue", toQuery(args.filter)))),

  issue: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => findEntity(ctx.ws, "issue", args.ref))),

  prs: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read((): PrParent[] => {
        const query = toQuery(args.filter);
        // A pull request's files live on the branch it proposes to merge, so
        // the working tree usually does not hold them (spec 03 §3.5).
        if (args.allRefs) {
          return listPrsAcrossRefs(ctx.ws, query).map((found) => ({
            entity: found.entity,
            refs: found.refs.map((ref) => ref.short),
          }));
        }
        return listEntities(ctx.ws, "pr", query).map((entity) => ({ entity, refs: [] }));
      }),
    ),

  pr: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read((): PrParent => {
        // The working tree first: that copy has its comments read from disk.
        // Only when it is not here is the scan across branches worth its cost.
        try {
          return { entity: findEntity(ctx.ws, "pr", args.ref), refs: [] };
        } catch (error) {
          if (!(error instanceof WorkspaceError) || error.code !== "not-found") throw error;
          const located = locatePr(ctx.ws, args.ref);
          return { entity: located.entity, refs: [located.sourceRef] };
        }
      }),
    ),

  doctor: (_parent, _args, ctx) =>
    run(() => ctx.sync.read(() => ({ diagnostics: runDoctor(ctx.ws).diagnostics }))),

  viewer: (_parent, _args, ctx) => ({ name: ctx.viewer.name ?? null, email: ctx.viewer.email }),
};
