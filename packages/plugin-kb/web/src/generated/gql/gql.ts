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
    "\n  fragment KbEntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n    ext\n  }\n": typeof types.KbEntityCoreFragmentDoc,
    "\n  fragment KbIssueRow on Issue {\n    ...KbEntityCore\n    resolution\n    rank\n    deadline\n  }\n": typeof types.KbIssueRowFragmentDoc,
    "\n  fragment KbPrRow on Pr {\n    ...KbEntityCore\n    target\n    source\n    draft\n    refs\n    reviewers\n    reviewDecision\n    approvals {\n      given\n      required\n    }\n    merged {\n      date\n      by\n      commit\n    }\n  }\n": typeof types.KbPrRowFragmentDoc,
    "\n  fragment FeatureListItem on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    specs {\n      path\n      fileName\n      title\n    }\n    issues {\n      id\n      status\n    }\n    prs {\n      id\n      status\n    }\n  }\n": typeof types.FeatureListItemFragmentDoc,
    "\n  fragment SpecDetail on Spec {\n    fileName\n    title\n    path\n    body\n    baseSha\n  }\n": typeof types.SpecDetailFragmentDoc,
    "\n  fragment FeatureDetail on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    path\n    baseSha\n    specs {\n      ...SpecDetail\n    }\n    issues {\n      ...KbIssueRow\n    }\n    prs {\n      ...KbPrRow\n    }\n    commits {\n      sha\n      subject\n      author\n      date\n    }\n  }\n": typeof types.FeatureDetailFragmentDoc,
    "\n  mutation CreateFeature($input: CreateFeatureInput!) {\n    createFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.CreateFeatureDocument,
    "\n  mutation UpdateFeature($input: UpdateFeatureInput!) {\n    updateFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UpdateFeatureDocument,
    "\n  mutation AddSpec($input: AddSpecInput!) {\n    addSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.AddSpecDocument,
    "\n  mutation UpdateSpec($input: UpdateSpecInput!) {\n    updateSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UpdateSpecDocument,
    "\n  query Features {\n    features {\n      ...FeatureListItem\n    }\n  }\n": typeof types.FeaturesDocument,
    "\n  query Feature($slug: String!) {\n    feature(slug: $slug) {\n      ...FeatureDetail\n    }\n  }\n": typeof types.FeatureDocument,
};
const documents: Documents = {
    "\n  fragment KbEntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n    ext\n  }\n": types.KbEntityCoreFragmentDoc,
    "\n  fragment KbIssueRow on Issue {\n    ...KbEntityCore\n    resolution\n    rank\n    deadline\n  }\n": types.KbIssueRowFragmentDoc,
    "\n  fragment KbPrRow on Pr {\n    ...KbEntityCore\n    target\n    source\n    draft\n    refs\n    reviewers\n    reviewDecision\n    approvals {\n      given\n      required\n    }\n    merged {\n      date\n      by\n      commit\n    }\n  }\n": types.KbPrRowFragmentDoc,
    "\n  fragment FeatureListItem on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    specs {\n      path\n      fileName\n      title\n    }\n    issues {\n      id\n      status\n    }\n    prs {\n      id\n      status\n    }\n  }\n": types.FeatureListItemFragmentDoc,
    "\n  fragment SpecDetail on Spec {\n    fileName\n    title\n    path\n    body\n    baseSha\n  }\n": types.SpecDetailFragmentDoc,
    "\n  fragment FeatureDetail on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    path\n    baseSha\n    specs {\n      ...SpecDetail\n    }\n    issues {\n      ...KbIssueRow\n    }\n    prs {\n      ...KbPrRow\n    }\n    commits {\n      sha\n      subject\n      author\n      date\n    }\n  }\n": types.FeatureDetailFragmentDoc,
    "\n  mutation CreateFeature($input: CreateFeatureInput!) {\n    createFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.CreateFeatureDocument,
    "\n  mutation UpdateFeature($input: UpdateFeatureInput!) {\n    updateFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UpdateFeatureDocument,
    "\n  mutation AddSpec($input: AddSpecInput!) {\n    addSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.AddSpecDocument,
    "\n  mutation UpdateSpec($input: UpdateSpecInput!) {\n    updateSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UpdateSpecDocument,
    "\n  query Features {\n    features {\n      ...FeatureListItem\n    }\n  }\n": types.FeaturesDocument,
    "\n  query Feature($slug: String!) {\n    feature(slug: $slug) {\n      ...FeatureDetail\n    }\n  }\n": types.FeatureDocument,
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
export function graphql(source: "\n  fragment KbEntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n    ext\n  }\n"): (typeof documents)["\n  fragment KbEntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n    ext\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment KbIssueRow on Issue {\n    ...KbEntityCore\n    resolution\n    rank\n    deadline\n  }\n"): (typeof documents)["\n  fragment KbIssueRow on Issue {\n    ...KbEntityCore\n    resolution\n    rank\n    deadline\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment KbPrRow on Pr {\n    ...KbEntityCore\n    target\n    source\n    draft\n    refs\n    reviewers\n    reviewDecision\n    approvals {\n      given\n      required\n    }\n    merged {\n      date\n      by\n      commit\n    }\n  }\n"): (typeof documents)["\n  fragment KbPrRow on Pr {\n    ...KbEntityCore\n    target\n    source\n    draft\n    refs\n    reviewers\n    reviewDecision\n    approvals {\n      given\n      required\n    }\n    merged {\n      date\n      by\n      commit\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FeatureListItem on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    specs {\n      path\n      fileName\n      title\n    }\n    issues {\n      id\n      status\n    }\n    prs {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  fragment FeatureListItem on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    specs {\n      path\n      fileName\n      title\n    }\n    issues {\n      id\n      status\n    }\n    prs {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SpecDetail on Spec {\n    fileName\n    title\n    path\n    body\n    baseSha\n  }\n"): (typeof documents)["\n  fragment SpecDetail on Spec {\n    fileName\n    title\n    path\n    body\n    baseSha\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment FeatureDetail on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    path\n    baseSha\n    specs {\n      ...SpecDetail\n    }\n    issues {\n      ...KbIssueRow\n    }\n    prs {\n      ...KbPrRow\n    }\n    commits {\n      sha\n      subject\n      author\n      date\n    }\n  }\n"): (typeof documents)["\n  fragment FeatureDetail on Feature {\n    slug\n    title\n    author\n    created\n    summary\n    path\n    baseSha\n    specs {\n      ...SpecDetail\n    }\n    issues {\n      ...KbIssueRow\n    }\n    prs {\n      ...KbPrRow\n    }\n    commits {\n      sha\n      subject\n      author\n      date\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateFeature($input: CreateFeatureInput!) {\n    createFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CreateFeature($input: CreateFeatureInput!) {\n    createFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateFeature($input: UpdateFeatureInput!) {\n    updateFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateFeature($input: UpdateFeatureInput!) {\n    updateFeature(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddSpec($input: AddSpecInput!) {\n    addSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AddSpec($input: AddSpecInput!) {\n    addSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateSpec($input: UpdateSpecInput!) {\n    updateSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateSpec($input: UpdateSpecInput!) {\n    updateSpec(input: $input) {\n      feature {\n        ...FeatureDetail\n      }\n      spec {\n        ...SpecDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Features {\n    features {\n      ...FeatureListItem\n    }\n  }\n"): (typeof documents)["\n  query Features {\n    features {\n      ...FeatureListItem\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Feature($slug: String!) {\n    feature(slug: $slug) {\n      ...FeatureDetail\n    }\n  }\n"): (typeof documents)["\n  query Feature($slug: String!) {\n    feature(slug: $slug) {\n      ...FeatureDetail\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;