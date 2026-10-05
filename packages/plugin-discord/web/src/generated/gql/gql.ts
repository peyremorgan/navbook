/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  mutation LinkDiscord($code: String!) {\n    linkDiscord(code: $code) {\n      link {\n        userId\n        username\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.LinkDiscordDocument,
    "\n  mutation UnlinkDiscord {\n    unlinkDiscord {\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UnlinkDiscordDocument,
    "\n  query DiscordLink {\n    discord {\n      guild\n    }\n    viewer {\n      email\n      discord {\n        userId\n        username\n      }\n    }\n  }\n": typeof types.DiscordLinkDocument,
    "\n  query DiscordThread($ref: ID!) {\n    discord {\n      thread(ref: $ref) {\n        id\n        url\n      }\n    }\n  }\n": typeof types.DiscordThreadDocument,
};
const documents: Documents = {
    "\n  mutation LinkDiscord($code: String!) {\n    linkDiscord(code: $code) {\n      link {\n        userId\n        username\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.LinkDiscordDocument,
    "\n  mutation UnlinkDiscord {\n    unlinkDiscord {\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UnlinkDiscordDocument,
    "\n  query DiscordLink {\n    discord {\n      guild\n    }\n    viewer {\n      email\n      discord {\n        userId\n        username\n      }\n    }\n  }\n": types.DiscordLinkDocument,
    "\n  query DiscordThread($ref: ID!) {\n    discord {\n      thread(ref: $ref) {\n        id\n        url\n      }\n    }\n  }\n": types.DiscordThreadDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LinkDiscord($code: String!) {\n    linkDiscord(code: $code) {\n      link {\n        userId\n        username\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation LinkDiscord($code: String!) {\n    linkDiscord(code: $code) {\n      link {\n        userId\n        username\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnlinkDiscord {\n    unlinkDiscord {\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UnlinkDiscord {\n    unlinkDiscord {\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DiscordLink {\n    discord {\n      guild\n    }\n    viewer {\n      email\n      discord {\n        userId\n        username\n      }\n    }\n  }\n"): (typeof documents)["\n  query DiscordLink {\n    discord {\n      guild\n    }\n    viewer {\n      email\n      discord {\n        userId\n        username\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DiscordThread($ref: ID!) {\n    discord {\n      thread(ref: $ref) {\n        id\n        url\n      }\n    }\n  }\n"): (typeof documents)["\n  query DiscordThread($ref: ID!) {\n    discord {\n      thread(ref: $ref) {\n        id\n        url\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;