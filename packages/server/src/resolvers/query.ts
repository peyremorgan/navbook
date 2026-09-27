/**
 * The read half of the API.
 *
 * Each field is one call into `ops/`, wrapped in the sync engine's read
 * transaction so the clone is up to date with the remote before anything is
 * parsed (spec 06 §6.3). Nothing here interprets the tree itself.
 */

import {
  calendarDateOf,
  commentScopeFor,
  type EntityKind,
  type EntityRecord,
  formatPerson,
  type Query as ListQuery,
  listEntities,
  listPrsAcrossRefs,
  mergePeople,
  readPr,
  readReviewPolicy,
  resolveEntity,
  resolveFeature,
  resolveSha,
  runDoctor,
  treePeople,
  withComments,
} from "@navbook/core";
import type { GraphQLCtx } from "../context.ts";
import { run } from "../errors.ts";
import type { QueryResolvers } from "../generated/resolver-types.ts";
import type { PrParent } from "../mappers.ts";
import { toIssueQuery, toPrQuery } from "./map.ts";

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

/**
 * A listing of the working tree, filtered from the request's parse of it.
 *
 * `listEntities` would parse the tree itself; handing it the records instead
 * lets the listing share a parse with the rest of the request, and with every
 * other request since the tree last changed.
 */
function listed(ctx: GraphQLCtx, kind: EntityKind, query: ListQuery): EntityRecord[] {
  const repo = ctx.loadRepo(commentScopeFor(query, kind));
  return listEntities(ctx.ws, kind, query, { entities: kind === "issue" ? repo.issues : repo.prs });
}

export const Query: QueryResolvers = {
  issues: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => listed(ctx, "issue", toIssueQuery(args.filter, today(ctx))))),

  issue: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read(() =>
        // Every other entity's comments are most of a parse and none of the
        // answer; this one's are read inside the same transaction.
        withComments(ctx.ws, resolveEntity(ctx.loadRepo("none"), args.ref, "issue")),
      ),
    ),

  prs: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read((): PrParent[] => {
        // No guard against an issue's terms here: `PrFilter` has no key for
        // one, so validation refuses it before this runs (spec 04 §4.3).
        const query = toPrQuery(args.filter, today(ctx));
        // A pull request's files live on the branch it proposes to merge, so
        // the working tree usually does not hold them (spec 03 §3.5).
        if (args.allRefs) {
          return listPrsAcrossRefs(ctx.ws, query).map((found) => ({
            entity: found.entity,
            refs: found.refs.map((ref) => ref.short),
          }));
        }
        return listed(ctx, "pr", query).map((entity) => ({ entity, refs: [] }));
      }),
    ),

  pr: (_parent, args, ctx) =>
    run(() =>
      ctx.sync.read((): PrParent => {
        // The working tree first, then the branch that carries it — the same
        // lookup as `nav pr show`.
        const { entity, ref } = readPr(ctx.ws, args.ref);
        return { entity, refs: ref === null ? [] : [ref] };
      }),
    ),

  // Through `ctx.loadRepo` rather than `listFeatures`, so that a feature's
  // `issues` and `prs` fields read the same parse.
  features: (_parent, _args, ctx) => run(() => ctx.sync.read(() => ctx.loadRepo("none").features)),

  feature: (_parent, args, ctx) =>
    run(() => ctx.sync.read(() => resolveFeature(ctx.loadRepo("none"), args.slug))),

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
        const named = treePeople(ctx.loadRepo("all"));
        return mergePeople(authored, named, [ctx.viewer]).map(formatPerson);
      }),
    ),
};
