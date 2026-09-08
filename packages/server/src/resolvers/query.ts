/**
 * The read half of the API.
 *
 * Each field is one call into `ops/`, wrapped in the sync engine's read
 * transaction so the clone is up to date with the remote before anything is
 * parsed (spec 06 §6.3). Nothing here interprets the tree itself.
 */

import {
  calendarDateOf,
  findEntity,
  findFeature,
  formatPerson,
  listEntities,
  listFeatures,
  listPrsAcrossRefs,
  loadRepo,
  locatePr,
  mergePeople,
  readReviewPolicy,
  resolveSha,
  runDoctor,
  treePeople,
  WorkspaceError,
} from "@navbook/core";
import type { GraphQLCtx } from "../context.ts";
import { invalidInput, run } from "../errors.ts";
import type { QueryResolvers } from "../generated/resolver-types.ts";
import type { PrParent } from "../mappers.ts";
import { toQuery } from "./map.ts";

/**
 * The day a `deadline` filter is judged against: the server's own, in UTC.
 *
 * Its clock rather than the caller's, so that two people asking the same
 * question get the same answer. A browser drawing "2 days overdue" beside a
 * row reads its own calendar and may disagree for the few hours their days do
 * not line up; what a filter returns is one repository's answer.
 */
function today(ctx: GraphQLCtx): string {
  return calendarDateOf(ctx.ws.now());
}

export const Query: QueryResolvers = {
  issues: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => listEntities(ctx.ws, "issue", toQuery(args.filter, today(ctx))))),

  issue: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => findEntity(ctx.ws, "issue", args.ref))),

  prs: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read((): PrParent[] => {
        // The mirror of what `parseQuery` refuses on an issue: a term that
        // describes something this noun does not have is an error rather than
        // a filter that matches nothing (spec 04 §4.3).
        if (args.filter?.deadline?.length) {
          throw invalidInput("'deadline' describes an issue; pull requests have no deadline");
        }
        const query = toQuery(args.filter, today(ctx));
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

  features: (_parent, _args, ctx) => run(() => ctx.sync.read(() => listFeatures(ctx.ws))),

  feature: (_parent, args, ctx) => run(() => ctx.sync.read(() => findFeature(ctx.ws, args.slug))),

  doctor: (_parent, _args, ctx) =>
    run(() => ctx.sync.read(() => ({ diagnostics: runDoctor(ctx.ws).diagnostics }))),

  viewer: (_parent, _args, ctx) => ({ name: ctx.viewer.name ?? null, email: ctx.viewer.email }),

  // Read rather than validated: a malformed policy is reported through
  // `problems` and defaults on every field beside them, so a client can say
  // why the numbers are what they are (spec 02 §2.10, check D15).
  //
  // Read from the tree rather than through `ctx.reviewPolicy()`, which is the
  // memo the field resolvers share: that one takes the lock itself, and the
  // mutex is a queue rather than a reentrant lock, so asking for it from
  // inside `read` would wait on a transaction that cannot finish until it
  // returns. A top-level query pulls first, as every other one here does.
  reviewPolicy: (_parent, _args, ctx) =>
    run(() =>
      ctx.sync.read(() => {
        const { policy, declared, problems } = readReviewPolicy(ctx.ws);
        return { ...policy, declared, problems: [...problems] };
      }),
    ),

  /*
   * Three sources in precedence order, and only one of them is expensive.
   *
   * HEAD is resolved inside the transaction, after the pull, so the walk the
   * cache keeps is keyed on the history this very request is reading. The tree
   * is read here rather than through `ctx.repo()` for the reason `reviewPolicy`
   * gives above: the lock is a queue, and asking for the memo from inside a
   * read would wait on the transaction that has to finish first.
   *
   * The viewer is last and costs nothing, but it is what makes the list usable
   * on the first day: somebody who has never committed and whom no file names
   * can still assign the work to themselves.
   */
  people: (_parent, _args, ctx) =>
    run(() =>
      ctx.sync.read(() => {
        const authored = ctx.authors.at(resolveSha(ctx.ws.repoRoot, "HEAD"));
        const named = treePeople(loadRepo(ctx.ws));
        return mergePeople(authored, named, [ctx.viewer]).map(formatPerson);
      }),
    ),
};
