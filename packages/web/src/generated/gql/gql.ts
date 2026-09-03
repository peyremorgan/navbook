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
    "\n  fragment EntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n  }\n": typeof types.EntityCoreFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    path\n    created\n    author\n    replyTo\n    verdict\n    revision\n    file\n    line\n    body\n  }\n": typeof types.CommentFieldsFragmentDoc,
    "\n  fragment IssueListItem on Issue {\n    ...EntityCore\n    resolution\n  }\n": typeof types.IssueListItemFragmentDoc,
    "\n  fragment PrListItem on Pr {\n    ...EntityCore\n    target\n    source\n    draft\n    refs\n    merged {\n      date\n      by\n      commit\n    }\n  }\n": typeof types.PrListItemFragmentDoc,
    "\n  fragment LinkNodeCore on LinkNode {\n    id\n    notAnIssue\n    cycle\n    repeated\n    issue {\n      id\n      title\n      status\n    }\n  }\n": typeof types.LinkNodeCoreFragmentDoc,
    "\n  fragment LinkNodeTree on LinkNode {\n    ...LinkNodeCore\n    children {\n      ...LinkNodeCore\n      children {\n        ...LinkNodeCore\n      }\n    }\n  }\n": typeof types.LinkNodeTreeFragmentDoc,
    "\n  fragment IssueDetail on Issue {\n    ...EntityCore\n    body\n    resolution\n    duplicateOf\n    parent {\n      ...LinkNodeCore\n    }\n    subtasks(depth: 3) {\n      ...LinkNodeTree\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n": typeof types.IssueDetailFragmentDoc,
    "\n  fragment PrDetail on Pr {\n    ...PrListItem\n    body\n    revisions {\n      head\n      base\n      date\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n": typeof types.PrDetailFragmentDoc,
    "\n  mutation OpenIssue($input: OpenIssueInput!) {\n    openIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.OpenIssueDocument,
    "\n  mutation UpdateIssue($input: UpdateIssueInput!) {\n    updateIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UpdateIssueDocument,
    "\n  mutation CloseIssue($input: CloseIssueInput!) {\n    closeIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.CloseIssueDocument,
    "\n  mutation ReopenIssue($ref: ID!) {\n    reopenIssue(ref: $ref) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.ReopenIssueDocument,
    "\n  mutation AddComment($input: AddCommentInput!) {\n    addComment(input: $input) {\n      comment {\n        ...CommentFields\n      }\n      entity {\n        id\n        comments {\n          ...CommentFields\n        }\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.AddCommentDocument,
    "\n  mutation LinkIssue($input: LinkIssueInput!) {\n    linkIssue(input: $input) {\n      child {\n        ...IssueDetail\n      }\n      parent {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.LinkIssueDocument,
    "\n  mutation UnlinkIssue($ref: ID!) {\n    unlinkIssue(ref: $ref) {\n      child {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UnlinkIssueDocument,
    "\n  query Viewer {\n    viewer {\n      name\n      email\n    }\n  }\n": typeof types.ViewerDocument,
    "\n  query Issues($filter: EntityFilter) {\n    issues(filter: $filter) {\n      ...IssueListItem\n    }\n  }\n": typeof types.IssuesDocument,
    "\n  query Issue($ref: ID!) {\n    issue(ref: $ref) {\n      ...IssueDetail\n    }\n  }\n": typeof types.IssueDocument,
    "\n  query Prs($filter: EntityFilter, $allRefs: Boolean!) {\n    prs(filter: $filter, allRefs: $allRefs) {\n      ...PrListItem\n    }\n  }\n": typeof types.PrsDocument,
    "\n  query Pr($ref: ID!) {\n    pr(ref: $ref) {\n      ...PrDetail\n    }\n  }\n": typeof types.PrDocument,
};
const documents: Documents = {
    "\n  fragment EntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n  }\n": types.EntityCoreFragmentDoc,
    "\n  fragment CommentFields on Comment {\n    id\n    path\n    created\n    author\n    replyTo\n    verdict\n    revision\n    file\n    line\n    body\n  }\n": types.CommentFieldsFragmentDoc,
    "\n  fragment IssueListItem on Issue {\n    ...EntityCore\n    resolution\n  }\n": types.IssueListItemFragmentDoc,
    "\n  fragment PrListItem on Pr {\n    ...EntityCore\n    target\n    source\n    draft\n    refs\n    merged {\n      date\n      by\n      commit\n    }\n  }\n": types.PrListItemFragmentDoc,
    "\n  fragment LinkNodeCore on LinkNode {\n    id\n    notAnIssue\n    cycle\n    repeated\n    issue {\n      id\n      title\n      status\n    }\n  }\n": types.LinkNodeCoreFragmentDoc,
    "\n  fragment LinkNodeTree on LinkNode {\n    ...LinkNodeCore\n    children {\n      ...LinkNodeCore\n      children {\n        ...LinkNodeCore\n      }\n    }\n  }\n": types.LinkNodeTreeFragmentDoc,
    "\n  fragment IssueDetail on Issue {\n    ...EntityCore\n    body\n    resolution\n    duplicateOf\n    parent {\n      ...LinkNodeCore\n    }\n    subtasks(depth: 3) {\n      ...LinkNodeTree\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n": types.IssueDetailFragmentDoc,
    "\n  fragment PrDetail on Pr {\n    ...PrListItem\n    body\n    revisions {\n      head\n      base\n      date\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n": types.PrDetailFragmentDoc,
    "\n  mutation OpenIssue($input: OpenIssueInput!) {\n    openIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.OpenIssueDocument,
    "\n  mutation UpdateIssue($input: UpdateIssueInput!) {\n    updateIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UpdateIssueDocument,
    "\n  mutation CloseIssue($input: CloseIssueInput!) {\n    closeIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.CloseIssueDocument,
    "\n  mutation ReopenIssue($ref: ID!) {\n    reopenIssue(ref: $ref) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.ReopenIssueDocument,
    "\n  mutation AddComment($input: AddCommentInput!) {\n    addComment(input: $input) {\n      comment {\n        ...CommentFields\n      }\n      entity {\n        id\n        comments {\n          ...CommentFields\n        }\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.AddCommentDocument,
    "\n  mutation LinkIssue($input: LinkIssueInput!) {\n    linkIssue(input: $input) {\n      child {\n        ...IssueDetail\n      }\n      parent {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.LinkIssueDocument,
    "\n  mutation UnlinkIssue($ref: ID!) {\n    unlinkIssue(ref: $ref) {\n      child {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UnlinkIssueDocument,
    "\n  query Viewer {\n    viewer {\n      name\n      email\n    }\n  }\n": types.ViewerDocument,
    "\n  query Issues($filter: EntityFilter) {\n    issues(filter: $filter) {\n      ...IssueListItem\n    }\n  }\n": types.IssuesDocument,
    "\n  query Issue($ref: ID!) {\n    issue(ref: $ref) {\n      ...IssueDetail\n    }\n  }\n": types.IssueDocument,
    "\n  query Prs($filter: EntityFilter, $allRefs: Boolean!) {\n    prs(filter: $filter, allRefs: $allRefs) {\n      ...PrListItem\n    }\n  }\n": types.PrsDocument,
    "\n  query Pr($ref: ID!) {\n    pr(ref: $ref) {\n      ...PrDetail\n    }\n  }\n": types.PrDocument,
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
export function graphql(source: "\n  fragment EntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n  }\n"): (typeof documents)["\n  fragment EntityCore on Entity {\n    id\n    slug\n    kind\n    status\n    path\n    archived\n    title\n    author\n    created\n    labels\n    assignees\n    milestone\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CommentFields on Comment {\n    id\n    path\n    created\n    author\n    replyTo\n    verdict\n    revision\n    file\n    line\n    body\n  }\n"): (typeof documents)["\n  fragment CommentFields on Comment {\n    id\n    path\n    created\n    author\n    replyTo\n    verdict\n    revision\n    file\n    line\n    body\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueListItem on Issue {\n    ...EntityCore\n    resolution\n  }\n"): (typeof documents)["\n  fragment IssueListItem on Issue {\n    ...EntityCore\n    resolution\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PrListItem on Pr {\n    ...EntityCore\n    target\n    source\n    draft\n    refs\n    merged {\n      date\n      by\n      commit\n    }\n  }\n"): (typeof documents)["\n  fragment PrListItem on Pr {\n    ...EntityCore\n    target\n    source\n    draft\n    refs\n    merged {\n      date\n      by\n      commit\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LinkNodeCore on LinkNode {\n    id\n    notAnIssue\n    cycle\n    repeated\n    issue {\n      id\n      title\n      status\n    }\n  }\n"): (typeof documents)["\n  fragment LinkNodeCore on LinkNode {\n    id\n    notAnIssue\n    cycle\n    repeated\n    issue {\n      id\n      title\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LinkNodeTree on LinkNode {\n    ...LinkNodeCore\n    children {\n      ...LinkNodeCore\n      children {\n        ...LinkNodeCore\n      }\n    }\n  }\n"): (typeof documents)["\n  fragment LinkNodeTree on LinkNode {\n    ...LinkNodeCore\n    children {\n      ...LinkNodeCore\n      children {\n        ...LinkNodeCore\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment IssueDetail on Issue {\n    ...EntityCore\n    body\n    resolution\n    duplicateOf\n    parent {\n      ...LinkNodeCore\n    }\n    subtasks(depth: 3) {\n      ...LinkNodeTree\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n"): (typeof documents)["\n  fragment IssueDetail on Issue {\n    ...EntityCore\n    body\n    resolution\n    duplicateOf\n    parent {\n      ...LinkNodeCore\n    }\n    subtasks(depth: 3) {\n      ...LinkNodeTree\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PrDetail on Pr {\n    ...PrListItem\n    body\n    revisions {\n      head\n      base\n      date\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n"): (typeof documents)["\n  fragment PrDetail on Pr {\n    ...PrListItem\n    body\n    revisions {\n      head\n      base\n      date\n    }\n    comments {\n      ...CommentFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation OpenIssue($input: OpenIssueInput!) {\n    openIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation OpenIssue($input: OpenIssueInput!) {\n    openIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateIssue($input: UpdateIssueInput!) {\n    updateIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateIssue($input: UpdateIssueInput!) {\n    updateIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CloseIssue($input: CloseIssueInput!) {\n    closeIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CloseIssue($input: CloseIssueInput!) {\n    closeIssue(input: $input) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReopenIssue($ref: ID!) {\n    reopenIssue(ref: $ref) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation ReopenIssue($ref: ID!) {\n    reopenIssue(ref: $ref) {\n      issue {\n        ...IssueDetail\n      }\n      destination\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddComment($input: AddCommentInput!) {\n    addComment(input: $input) {\n      comment {\n        ...CommentFields\n      }\n      entity {\n        id\n        comments {\n          ...CommentFields\n        }\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AddComment($input: AddCommentInput!) {\n    addComment(input: $input) {\n      comment {\n        ...CommentFields\n      }\n      entity {\n        id\n        comments {\n          ...CommentFields\n        }\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LinkIssue($input: LinkIssueInput!) {\n    linkIssue(input: $input) {\n      child {\n        ...IssueDetail\n      }\n      parent {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation LinkIssue($input: LinkIssueInput!) {\n    linkIssue(input: $input) {\n      child {\n        ...IssueDetail\n      }\n      parent {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnlinkIssue($ref: ID!) {\n    unlinkIssue(ref: $ref) {\n      child {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UnlinkIssue($ref: ID!) {\n    unlinkIssue(ref: $ref) {\n      child {\n        ...IssueDetail\n      }\n      previousParentId\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Viewer {\n    viewer {\n      name\n      email\n    }\n  }\n"): (typeof documents)["\n  query Viewer {\n    viewer {\n      name\n      email\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Issues($filter: EntityFilter) {\n    issues(filter: $filter) {\n      ...IssueListItem\n    }\n  }\n"): (typeof documents)["\n  query Issues($filter: EntityFilter) {\n    issues(filter: $filter) {\n      ...IssueListItem\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Issue($ref: ID!) {\n    issue(ref: $ref) {\n      ...IssueDetail\n    }\n  }\n"): (typeof documents)["\n  query Issue($ref: ID!) {\n    issue(ref: $ref) {\n      ...IssueDetail\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Prs($filter: EntityFilter, $allRefs: Boolean!) {\n    prs(filter: $filter, allRefs: $allRefs) {\n      ...PrListItem\n    }\n  }\n"): (typeof documents)["\n  query Prs($filter: EntityFilter, $allRefs: Boolean!) {\n    prs(filter: $filter, allRefs: $allRefs) {\n      ...PrListItem\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Pr($ref: ID!) {\n    pr(ref: $ref) {\n      ...PrDetail\n    }\n  }\n"): (typeof documents)["\n  query Pr($ref: ID!) {\n    pr(ref: $ref) {\n      ...PrDetail\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;