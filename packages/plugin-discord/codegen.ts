/**
 * Client types for this plugin's own documents, generated against the schema
 * the server really serves: the host's SDL and this plugin's, composed.
 *
 * Its own generated module, as plugin-kb's is, so `@navbook/web` builds with no
 * plugins at all. Generated files are committed and checked (`codegen:check`).
 */

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: ["../server/schema.graphql", "./schema.graphql"],
  documents: ["web/app/graphql/**/*.ts"],
  generates: {
    "web/src/generated/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        // `Entity.ext` is a map every plugin fills under its own name; this
        // layer reads its own key out of it, defensively.
        scalars: { JSON: "unknown" },
      },
    },
  },
};

export default config;
