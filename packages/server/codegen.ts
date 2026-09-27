/**
 * Resolver types generated from `schema.graphql`.
 *
 * The generated file is committed and CI checks it is current (`codegen:check`),
 * so the package keeps the repository's no-build-step development flow: codegen
 * runs when the SDL changes, never at install or at runtime.
 *
 * Enums are generated as string-literal unions rather than TypeScript enums,
 * which `erasableSyntaxOnly` forbids. Their values are the GraphQL spelling
 * (`OPEN`, `REQUEST_CHANGES`); `resolvers/map.ts` is the one place that
 * translates to and from the lowercase strings the format uses on disk.
 */

import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "schema.graphql",
  generates: {
    "src/generated/resolver-types.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        contextType: "../context.ts#GraphQLCtx",
        // `Entity.ext` is whatever the loaded plugins put in it, so the
        // generated type says exactly that and no more: the server never reads
        // a key of it, and a shape here would be a promise nothing keeps.
        scalars: { JSON: "Record<string, unknown>" },
        mappers: {
          Issue: "../mappers.ts#IssueParent",
          Pr: "../mappers.ts#PrParent",
          Entity: "../mappers.ts#EntityParent",
          Comment: "../mappers.ts#CommentParent",
          LinkNode: "../mappers.ts#LinkNodeParent",
          Diagnostic: "../mappers.ts#DiagnosticParent",
          Commit: "../mappers.ts#CommitParent",
          CommitRange: "../mappers.ts#CommitRangeParent",
          Changes: "../mappers.ts#ChangesParent",
          ChangedFile: "../mappers.ts#ChangedFileParent",
        },
      },
    },
  },
};

export default config;
