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

/**
 * A resolver map, as the schema builder accepts one.
 *
 * Derived from `createSchema`'s own signature rather than imported from
 * `@graphql-tools/schema`, which is not a direct dependency of this package
 * and should not become one for a type: spec 05 §5.2 keeps the server's
 * GraphQL dependencies to what it actually runs. Derivation also means the
 * type cannot drift from what the builder will really take.
 */
type SchemaDefinition = Parameters<typeof createSchema<GraphQLCtx>>[0];
export type PluginResolvers =
  NonNullable<SchemaDefinition["resolvers"]> extends infer Single | (infer _Many)[]
    ? Single
    : never;

export function readTypeDefs(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

/**
 * The executable schema, with whatever the loaded plugins added.
 *
 * `createSchema` is `makeExecutableSchema`, whose `typeDefs` and `resolvers`
 * both accept arrays — so a plugin's SDL is merged rather than concatenated,
 * and `extend type Pr { … }` means what it says. The merge validates as it
 * goes: a fragment that extends a type nothing defines, or that redefines a
 * field with a different type, fails here, at startup, naming the fault. That
 * is the right moment for it, since the alternative is a server that starts
 * and then answers one query strangely.
 */
export function makeSchema(
  plugins: { typeDefs: string[]; resolvers: PluginResolvers[] } = { typeDefs: [], resolvers: [] },
) {
  return createSchema<GraphQLCtx>({
    typeDefs: [readTypeDefs(), ...plugins.typeDefs],
    resolvers: [resolvers, ...plugins.resolvers],
  });
}
