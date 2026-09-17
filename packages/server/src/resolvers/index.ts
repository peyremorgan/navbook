/**
 * The resolver map, as `createSchema` wants it.
 *
 * Only the fields that differ from their parent are resolved: everything named
 * the same as the record it comes from is left to the default resolver.
 */

import type { Resolvers } from "../generated/resolver-types.ts";
import { ChangedFile, Comment, Diagnostic, Entity, Issue, LinkNode, Pr } from "./entity.ts";
import { Commit, Feature, Spec } from "./feature.ts";
import { Mutation } from "./mutation.ts";
import { Query } from "./query.ts";

export const resolvers: Resolvers = {
  Query,
  Mutation,
  Entity,
  Issue,
  Pr,
  Comment,
  LinkNode,
  Diagnostic,
  Feature,
  Spec,
  Commit,
  ChangedFile,
};
