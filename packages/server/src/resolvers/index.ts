/**
 * The resolver map, as `createSchema` wants it.
 *
 * Only the fields that differ from their parent are resolved: everything named
 * the same as the record it comes from is left to the default resolver.
 */

import type { Resolvers } from "../generated/resolver-types.ts";
import { ChangedFile, Comment, Commit, Diagnostic, Entity, Issue, LinkNode, Pr } from "./entity.ts";
import { Mutation } from "./mutation.ts";
import { Query } from "./query.ts";
import { JSONScalar } from "./scalars.ts";

export const resolvers: Resolvers = {
  JSON: JSONScalar,
  Query,
  Mutation,
  Entity,
  Issue,
  Pr,
  Comment,
  LinkNode,
  Diagnostic,
  Commit,
  ChangedFile,
};
