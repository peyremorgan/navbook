/**
 * The executable schema: the SDL document, plus the resolvers over it.
 *
 * `schema.graphql` is read at runtime rather than inlined, so the file that
 * ships in the package is the same one CI generates the resolver types from —
 * there is no second copy to drift. It sits at the package root, which is why
 * this resolves it the same way whether it is being run from `src/` or `dist/`.
 */

import { readFileSync } from "node:fs";
import { createSchema } from "graphql-yoga";
import type { GraphQLCtx } from "./context.ts";
import { resolvers } from "./resolvers/index.ts";

export const SCHEMA_PATH = new URL("../schema.graphql", import.meta.url);

export function readTypeDefs(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

export function makeSchema() {
  return createSchema<GraphQLCtx>({ typeDefs: readTypeDefs(), resolvers });
}
