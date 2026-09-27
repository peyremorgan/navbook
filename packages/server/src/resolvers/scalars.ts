/**
 * The one scalar this schema defines itself.
 *
 * `JSON` carries `Entity.ext` — what the loaded plugins contribute to an
 * entity, keyed by plugin short name (see the scalar's description in
 * `schema.graphql`). It is output-only: nothing in this API takes one as an
 * argument, and the two input coercers therefore refuse rather than accept a
 * value no field would read.
 *
 * Written out rather than pulled from `graphql-scalars`, because it is fifteen
 * lines and the package would be a runtime dependency for them (spec 05 §5.2).
 */

import { GraphQLScalarType } from "graphql";

export const JSONScalar: GraphQLScalarType<unknown, unknown> = new GraphQLScalarType({
  name: "JSON",
  description: "An arbitrary JSON value, as the plugin that produced it shaped it.",
  // Whatever a plugin returned, handed on as it is: the point of the scalar is
  // that this server does not know the shape and must not impose one.
  serialize: (value) => value,
  parseValue: () => {
    throw new Error("JSON is an output-only scalar in this schema");
  },
  parseLiteral: () => {
    throw new Error("JSON is an output-only scalar in this schema");
  },
});
