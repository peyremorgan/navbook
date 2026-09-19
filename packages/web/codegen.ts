/**
 * Client types generated from the schema this client is built against.
 *
 * Two documents, not one: the server's own, and every plugin whose web half
 * this build includes. A plugin's SDL is only a schema in combination with the
 * host's (spec 02 §2.12), so the types a client needs are the types of the
 * *composed* schema — which is also exactly what the deployment will serve,
 * since the same plugin list decides both.
 *
 * They are read from the packages rather than copied, so there is one contract
 * and no drift: an incompatible change to the API breaks this package's type
 * check rather than its users.
 *
 * As on the server, the generated files are committed and CI checks they are
 * current (`codegen:check`). Enums come out as string-literal unions because
 * `erasableSyntaxOnly` forbids TypeScript enums, and fragment masking is off:
 * the components here are small enough that plain result types are clearer
 * than threading `useFragment` through every one of them.
 */

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  // `@navbook/plugin-kb` is listed because this client renders features. A
  // deployment that leaves it out of NAVBOOK_WEB_PLUGINS gets a client whose
  // feature pages have nothing to talk to, which is why the two lists are one
  // value in `.env`.
  schema: ["../server/schema.graphql", "../plugin-kb/schema.graphql"],
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
