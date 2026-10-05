/**
 * Client types for this plugin's own documents.
 *
 * Two schemas, because a plugin's SDL is only a schema in combination with the
 * host's: `extend type Issue` needs an `Issue` to extend. The composition is
 * the one `nav-server` performs at startup, so these documents are checked
 * against the types the API will really answer with — and the layer's
 * generated module is its own, since the host's knows nothing of polls.
 *
 * Generated files are committed and CI checks they are current
 * (`codegen:check`), as they are in every other package here.
 */

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: ["../server/schema.graphql", "./schema.graphql"],
  documents: ["web/app/graphql/**/*.ts"],
  generates: {
    "web/src/generated/gql/": {
      preset: "client",
      // Off, as in the host and the other layers: plain result types are
      // clearer here than `useFragment`, and a masked type could not be handed
      // to one of the host's components.
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        // Spelled as the host spells it, so `ext` reads the same on both sides.
        scalars: { JSON: "Record<string, unknown>" },
      },
    },
  },
};

export default config;
