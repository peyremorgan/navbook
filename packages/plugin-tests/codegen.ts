/**
 * Client types for this plugin's own documents.
 *
 * Two schemas, because a plugin's SDL is only a schema in combination with the
 * host's (spec 02 §2.12): `extend type Issue` needs an `Issue` to extend. The
 * composition here is the same one `nav-server` performs at startup, so the
 * types these documents are checked against are the types the API will really
 * answer with.
 *
 * Its own generated module rather than the host's, and that is the whole point
 * of the layer: `@navbook/web` generates from `@navbook/server`'s schema alone
 * and knows nothing about test plans, so a deployment that leaves this plugin
 * out builds a client with no test pages in it rather than a client whose test
 * pages have nothing to talk to.
 *
 * What that costs is recorded where it bites: `fragments.ts` cannot spread the
 * host's fragments, because a fragment registry does not cross a package.
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
      // Off for the reason it is off in `@navbook/web`: these components are
      // small enough that plain result types are clearer than threading
      // `useFragment` through them — and here it matters twice over, since a
      // masked type could not be handed to one of the host's row components.
      presetConfig: { fragmentMasking: false },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        // `ext` is whatever the loaded plugins put on an entity, so the client
        // gets a map it must look into rather than a shape it can trust — and
        // both packages spell it the same way, or a row this layer built could
        // not be handed to one of the host's components.
        scalars: { JSON: "Record<string, unknown>" },
      },
    },
  },
};

export default config;
