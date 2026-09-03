/**
 * Client types generated from the server's `schema.graphql`.
 *
 * The schema is read from `packages/server` rather than copied, so there is one
 * contract and no drift: an incompatible change to the API breaks this
 * package's type check rather than its users.
 *
 * As on the server, the generated files are committed and CI checks they are
 * current (`codegen:check`). Enums come out as string-literal unions because
 * `erasableSyntaxOnly` forbids TypeScript enums, and fragment masking is off:
 * the components here are small enough that plain result types are clearer
 * than threading `useFragment` through every one of them.
 */

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "../server/schema.graphql",
  // Every operation lives in `app/graphql/`, never inline in a component, so
  // that this glob is the whole story and a fragment is reusable by name.
  documents: ["app/graphql/**/*.ts"],
  generates: {
    "src/generated/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: { useTypeImports: true, enumsAsTypes: true },
    },
  },
};

export default config;
