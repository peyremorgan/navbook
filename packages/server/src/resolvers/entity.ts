/**
 * Projecting core's records onto the schema's types.
 *
 * With one exception, nothing here reads a file or runs git: these fields are
 * already in the record a query resolver returned. What they do is name
 * frontmatter explicitly — `fm` is an open map, and a schema that dumped it
 * would promise a shape the format does not guarantee. The exception is
 * `baseSha`, which asks git what the entity's file hashes to, as
 * `Feature.baseSha` does.
 */

import {
  absPath,
  type CommentRecord,
  type EntityRecord,
  hashObject,
  parentNode,
  type ReviewSummary,
  readAssignees,
  readDeadline,
  readFeatures,
  readLabels,
  readMerged,
  readRank,
  readReviewers,
  readRevisions,
  reviewSummary,
  subtaskTree,
} from "@navbook/core";
import type { GraphQLCtx } from "../context.ts";
import { invalidInput, run } from "../errors.ts";
import type {
  CommentResolvers,
  DiagnosticResolvers,
  EntityResolvers,
  IssueResolvers,
  LinkNodeResolvers,
  PrResolvers,
} from "../generated/resolver-types.ts";
import { type EntityParent, type IssueParent, type PrParent, recordOf } from "../mappers.ts";
import {
  toGqlDecision,
  toGqlKind,
  toGqlLevel,
  toGqlReviewState,
  toGqlStatus,
  toGqlVerdict,
} from "./map.ts";

/**
 * The blob hash of an entity's file, worked out once per record.
 *
 * Keyed by the record for the reason `Feature.baseSha` is: a write reads its
 * entity back, so a payload holds a new record and gets a fresh answer, while a
 * record that is asked twice in one request is hashed once. One `git
 * hash-object` per entity that asks, which is the detail page and not the
 * listing — a row has nothing to edit from, so its fragment never asks.
 *
 * Taken under the repository lock rather than beside it, as `Feature.commits`
 * is: a field resolver runs after its parent's transaction has let go, and a
 * file hashed while a close is moving its directory would hash to nothing.
 *
 * Empty is the answer when git cannot tell — a pull request read off another
 * branch has no file here to hash. It is also the safe answer: an edit sent
 * with a hash that can never match is refused, and nothing can be lost that
 * way.
 */
const HASHES = new WeakMap<EntityRecord, Promise<string>>();

function hashOf(ctx: GraphQLCtx, record: EntityRecord): Promise<string> {
  let hash = HASHES.get(record);
  if (hash === undefined) {
    hash = run(() =>
      ctx.sync.locked(() => hashObject(ctx.ws.repoRoot, absPath(ctx.ws, record.filePath)) ?? ""),
    );
    HASHES.set(record, hash);
  }
  return hash;
}

/** A frontmatter value when it is a non-empty string, and null otherwise. */
function text(fm: Record<string, unknown>, key: string): string | null {
  const value = fm[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The fields issues and pull requests share, written once.
 *
 * Both kinds are the same record; they differ only in how a resolver reaches
 * it, since a pull request arrives wrapped with the refs it was found on.
 */
function sharedFields<P>(record: (parent: P) => EntityRecord) {
  return {
    id: (parent: P) => record(parent).id,
    slug: (parent: P) => record(parent).slug,
    kind: (parent: P) => toGqlKind(record(parent).kind),
    status: (parent: P) => toGqlStatus(record(parent).status),
    path: (parent: P, _args: unknown, ctx: GraphQLCtx) =>
      `${ctx.ws.navDir}/${record(parent).dirPath}`,
    archived: (parent: P) => record(parent).archived,
    title: (parent: P) => record(parent).title,
    author: (parent: P) => text(record(parent).fm, "author") ?? "",
    created: (parent: P) => text(record(parent).fm, "created") ?? "",
    labels: (parent: P) => readLabels(record(parent).fm),
    assignees: (parent: P) => readAssignees(record(parent).fm),
    milestone: (parent: P) => text(record(parent).fm, "milestone"),
    features: (parent: P) => readFeatures(record(parent).fm),
    body: (parent: P) => record(parent).body.trim(),
    comments: (parent: P) => record(parent).comments,
    baseSha: (parent: P, _args: unknown, ctx: GraphQLCtx) => hashOf(ctx, record(parent)),
  };
}

export const Issue: IssueResolvers = {
  ...sharedFields<IssueParent>((issue) => issue),
  // Read rather than projected straight off `fm`: a value the file spells in a
  // way the schema cannot promise reads as absent, which is the same courtesy
  // `labels` and `assignees` get.
  rank: (issue) => readRank(issue.fm),
  deadline: (issue) => readDeadline(issue.fm),
  resolution: (issue) => text(issue.fm, "resolution"),
  duplicateOf: (issue) => text(issue.fm, "duplicate-of"),
  parent: async (issue, _args, ctx) => parentNode(await ctx.repo(), issue) ?? null,
  subtasks: async (issue, args, ctx) => {
    if (!Number.isInteger(args.depth) || args.depth < 0) {
      throw invalidInput("depth takes a whole number of levels");
    }
    return subtaskTree(await ctx.repo(), issue, args.depth);
  },
};

export const Pr: PrResolvers = {
  ...sharedFields<PrParent>((pr) => pr.entity),
  target: (pr) => text(pr.entity.fm, "target") ?? "",
  source: (pr) => text(pr.entity.fm, "source"),
  draft: (pr) => pr.entity.fm.draft === true,
  revisions: (pr) => readRevisions(pr.entity.fm),
  merged: (pr) => {
    const merged = readMerged(pr.entity.fm);
    if (merged === null) return null;
    return { date: text(merged, "date"), by: text(merged, "by"), commit: text(merged, "commit") };
  },
  refs: (pr) => [...pr.refs],
  reviewers: (pr) => readReviewers(pr.entity.fm),
  // Derived on demand (spec 02 §2.7), counted by the policy the marker
  // declares (§2.10). Each of the three fields reads the summary for itself
  // rather than sharing one: they are cheap beside the tree read they follow,
  // and a client that asks for one of them should not pay for the others.
  reviews: async (pr, _args, ctx) =>
    (await summaryOf(pr, ctx)).reviewers.map((entry) => ({
      person: entry.person,
      state: toGqlReviewState(entry.state),
      volunteer: entry.volunteer,
      comment: entry.commentId ?? null,
    })),
  reviewDecision: async (pr, _args, ctx) => toGqlDecision((await summaryOf(pr, ctx)).decision),
  approvals: async (pr, _args, ctx) => (await summaryOf(pr, ctx)).approvals,
};

/** A pull request's review state, counted by the request's policy. */
async function summaryOf(pr: PrParent, ctx: GraphQLCtx): Promise<ReviewSummary> {
  return reviewSummary(pr.entity, (await ctx.reviewPolicy()).policy);
}

export const Entity: EntityResolvers = {
  __resolveType: (parent: EntityParent) => (recordOf(parent).kind === "issue" ? "Issue" : "Pr"),
};

export const Comment: CommentResolvers = {
  id: (comment: CommentRecord) => comment.id,
  path: (comment, _args, ctx) => `${ctx.ws.navDir}/${comment.path}`,
  created: (comment) => comment.stamp,
  author: (comment) => comment.author,
  replyTo: (comment) => comment.replyTo ?? null,
  verdict: (comment) => toGqlVerdict(comment.parsed.fm.verdict),
  revision: (comment) => text(comment.parsed.fm, "revision"),
  file: (comment) => text(comment.parsed.fm, "file"),
  // The format allows an integer or a "start-end" range, so the wire type is a
  // string and a plain line number is rendered as one.
  line: (comment) => {
    const line = comment.parsed.fm.line;
    if (typeof line === "number") return String(line);
    return typeof line === "string" && line !== "" ? line : null;
  },
  body: (comment) => comment.body.trim(),
};

export const LinkNode: LinkNodeResolvers = {
  id: (node) => node.id,
  issue: (node) => node.entity ?? null,
  notAnIssue: (node) => node.notAnIssue === true,
  cycle: (node) => node.cycle === true,
  repeated: (node) => node.repeated === true,
  children: (node) => node.children,
};

export const Diagnostic: DiagnosticResolvers = {
  check: (diagnostic) => diagnostic.check,
  level: (diagnostic) => toGqlLevel(diagnostic.level),
  path: (diagnostic) => diagnostic.path,
  message: (diagnostic) => diagnostic.message,
  fixable: (diagnostic) => diagnostic.fix !== undefined,
};
