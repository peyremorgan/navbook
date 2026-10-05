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
    "\n  fragment PollRow on Poll {\n    id\n    title\n    status\n    closedByIssue\n    voters\n    deadline\n    myState\n  }\n": typeof types.PollRowFragmentDoc,
    "\n  fragment PollCard on Poll {\n    id\n    path\n    baseSha\n    title\n    author\n    created\n    preamble\n    results\n    deadline\n    fingerprint\n    status\n    closedByIssue\n    closed\n    closedBy\n    decisionNote\n    voters\n    problems\n    myState\n    questions {\n      id\n      text\n      multi\n      other\n      options {\n        id\n        label\n        description\n      }\n    }\n    outcome {\n      question\n      picks\n      other\n    }\n    proposed {\n      question\n      picks\n      other\n    }\n    tallies {\n      question\n      answered\n      tied\n      leaders\n      options {\n        option\n        count\n        voters\n      }\n      others {\n        text\n        voter\n      }\n    }\n    myBallot {\n      id\n      state\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    myDraft {\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    issue {\n      id\n      status\n    }\n  }\n": typeof types.PollCardFragmentDoc,
    "\n  mutation OpenPoll($input: OpenPollInput!) {\n    openPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": typeof types.OpenPollDocument,
    "\n  mutation EditPoll($input: EditPollInput!) {\n    editPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": typeof types.EditPollDocument,
    "\n  mutation VotePoll($input: VotePollInput!) {\n    votePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": typeof types.VotePollDocument,
    "\n  mutation ClosePoll($input: ClosePollInput!) {\n    closePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": typeof types.ClosePollDocument,
    "\n  mutation ReopenPoll($input: ReopenPollInput!) {\n    reopenPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": typeof types.ReopenPollDocument,
    "\n  fragment PollPayloadFields on PollPayload {\n    poll {\n      ...PollCard\n    }\n    issue {\n      id\n      ext\n      polls {\n        ...PollRow\n      }\n    }\n    revoked\n    late\n    commit {\n      committed\n      subject\n      pushed\n    }\n  }\n": typeof types.PollPayloadFieldsFragmentDoc,
    "\n  query Poll($id: ID!) {\n    poll(id: $id) {\n      ...PollCard\n    }\n  }\n": typeof types.PollDocument,
    "\n  query IssuePolls($ref: ID!) {\n    issue(ref: $ref) {\n      id\n      status\n      polls {\n        ...PollRow\n      }\n    }\n  }\n": typeof types.IssuePollsDocument,
};
const documents: Documents = {
    "\n  fragment PollRow on Poll {\n    id\n    title\n    status\n    closedByIssue\n    voters\n    deadline\n    myState\n  }\n": types.PollRowFragmentDoc,
    "\n  fragment PollCard on Poll {\n    id\n    path\n    baseSha\n    title\n    author\n    created\n    preamble\n    results\n    deadline\n    fingerprint\n    status\n    closedByIssue\n    closed\n    closedBy\n    decisionNote\n    voters\n    problems\n    myState\n    questions {\n      id\n      text\n      multi\n      other\n      options {\n        id\n        label\n        description\n      }\n    }\n    outcome {\n      question\n      picks\n      other\n    }\n    proposed {\n      question\n      picks\n      other\n    }\n    tallies {\n      question\n      answered\n      tied\n      leaders\n      options {\n        option\n        count\n        voters\n      }\n      others {\n        text\n        voter\n      }\n    }\n    myBallot {\n      id\n      state\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    myDraft {\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    issue {\n      id\n      status\n    }\n  }\n": types.PollCardFragmentDoc,
    "\n  mutation OpenPoll($input: OpenPollInput!) {\n    openPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": types.OpenPollDocument,
    "\n  mutation EditPoll($input: EditPollInput!) {\n    editPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": types.EditPollDocument,
    "\n  mutation VotePoll($input: VotePollInput!) {\n    votePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": types.VotePollDocument,
    "\n  mutation ClosePoll($input: ClosePollInput!) {\n    closePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": types.ClosePollDocument,
    "\n  mutation ReopenPoll($input: ReopenPollInput!) {\n    reopenPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n": types.ReopenPollDocument,
    "\n  fragment PollPayloadFields on PollPayload {\n    poll {\n      ...PollCard\n    }\n    issue {\n      id\n      ext\n      polls {\n        ...PollRow\n      }\n    }\n    revoked\n    late\n    commit {\n      committed\n      subject\n      pushed\n    }\n  }\n": types.PollPayloadFieldsFragmentDoc,
    "\n  query Poll($id: ID!) {\n    poll(id: $id) {\n      ...PollCard\n    }\n  }\n": types.PollDocument,
    "\n  query IssuePolls($ref: ID!) {\n    issue(ref: $ref) {\n      id\n      status\n      polls {\n        ...PollRow\n      }\n    }\n  }\n": types.IssuePollsDocument,
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
export function graphql(source: "\n  fragment PollRow on Poll {\n    id\n    title\n    status\n    closedByIssue\n    voters\n    deadline\n    myState\n  }\n"): (typeof documents)["\n  fragment PollRow on Poll {\n    id\n    title\n    status\n    closedByIssue\n    voters\n    deadline\n    myState\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PollCard on Poll {\n    id\n    path\n    baseSha\n    title\n    author\n    created\n    preamble\n    results\n    deadline\n    fingerprint\n    status\n    closedByIssue\n    closed\n    closedBy\n    decisionNote\n    voters\n    problems\n    myState\n    questions {\n      id\n      text\n      multi\n      other\n      options {\n        id\n        label\n        description\n      }\n    }\n    outcome {\n      question\n      picks\n      other\n    }\n    proposed {\n      question\n      picks\n      other\n    }\n    tallies {\n      question\n      answered\n      tied\n      leaders\n      options {\n        option\n        count\n        voters\n      }\n      others {\n        text\n        voter\n      }\n    }\n    myBallot {\n      id\n      state\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    myDraft {\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    issue {\n      id\n      status\n    }\n  }\n"): (typeof documents)["\n  fragment PollCard on Poll {\n    id\n    path\n    baseSha\n    title\n    author\n    created\n    preamble\n    results\n    deadline\n    fingerprint\n    status\n    closedByIssue\n    closed\n    closedBy\n    decisionNote\n    voters\n    problems\n    myState\n    questions {\n      id\n      text\n      multi\n      other\n      options {\n        id\n        label\n        description\n      }\n    }\n    outcome {\n      question\n      picks\n      other\n    }\n    proposed {\n      question\n      picks\n      other\n    }\n    tallies {\n      question\n      answered\n      tied\n      leaders\n      options {\n        option\n        count\n        voters\n      }\n      others {\n        text\n        voter\n      }\n    }\n    myBallot {\n      id\n      state\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    myDraft {\n      note\n      answers {\n        question\n        picks\n        other\n      }\n    }\n    issue {\n      id\n      status\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation OpenPoll($input: OpenPollInput!) {\n    openPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"): (typeof documents)["\n  mutation OpenPoll($input: OpenPollInput!) {\n    openPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation EditPoll($input: EditPollInput!) {\n    editPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"): (typeof documents)["\n  mutation EditPoll($input: EditPollInput!) {\n    editPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation VotePoll($input: VotePollInput!) {\n    votePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"): (typeof documents)["\n  mutation VotePoll($input: VotePollInput!) {\n    votePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ClosePoll($input: ClosePollInput!) {\n    closePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"): (typeof documents)["\n  mutation ClosePoll($input: ClosePollInput!) {\n    closePoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReopenPoll($input: ReopenPollInput!) {\n    reopenPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"): (typeof documents)["\n  mutation ReopenPoll($input: ReopenPollInput!) {\n    reopenPoll(input: $input) {\n      ...PollPayloadFields\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment PollPayloadFields on PollPayload {\n    poll {\n      ...PollCard\n    }\n    issue {\n      id\n      ext\n      polls {\n        ...PollRow\n      }\n    }\n    revoked\n    late\n    commit {\n      committed\n      subject\n      pushed\n    }\n  }\n"): (typeof documents)["\n  fragment PollPayloadFields on PollPayload {\n    poll {\n      ...PollCard\n    }\n    issue {\n      id\n      ext\n      polls {\n        ...PollRow\n      }\n    }\n    revoked\n    late\n    commit {\n      committed\n      subject\n      pushed\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Poll($id: ID!) {\n    poll(id: $id) {\n      ...PollCard\n    }\n  }\n"): (typeof documents)["\n  query Poll($id: ID!) {\n    poll(id: $id) {\n      ...PollCard\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query IssuePolls($ref: ID!) {\n    issue(ref: $ref) {\n      id\n      status\n      polls {\n        ...PollRow\n      }\n    }\n  }\n"): (typeof documents)["\n  query IssuePolls($ref: ID!) {\n    issue(ref: $ref) {\n      id\n      status\n      polls {\n        ...PollRow\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;