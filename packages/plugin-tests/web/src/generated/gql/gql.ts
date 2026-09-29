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
    "\n  fragment TestRunRow on TestRun {\n    id\n    planSlug\n    author\n    started\n    finished\n    commit\n    version\n    outcome\n    pr {\n      id\n    }\n  }\n": typeof types.TestRunRowFragmentDoc,
    "\n  fragment TestPlanRow on TestPlan {\n    slug\n    title\n    author\n    created\n    steps {\n      number\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n": typeof types.TestPlanRowFragmentDoc,
    "\n  fragment TestPlanDetail on TestPlan {\n    slug\n    title\n    author\n    created\n    description\n    path\n    baseSha\n    steps {\n      number\n      title\n      actions\n      expected\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n": typeof types.TestPlanDetailFragmentDoc,
    "\n  fragment TestRunDetail on TestRun {\n    id\n    path\n    planSlug\n    planSha\n    author\n    started\n    finished\n    commit\n    version\n    environment\n    notes\n    outcome\n    stepsFrom\n    baseSha\n    plan {\n      slug\n      title\n    }\n    pr {\n      id\n      title\n      refs\n    }\n    results {\n      number\n      title\n      actions\n      expected\n      status\n      actual\n    }\n    attachments {\n      name\n      path\n    }\n  }\n": typeof types.TestRunDetailFragmentDoc,
    "\n  mutation CreateTestPlan($input: CreateTestPlanInput!) {\n    createTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.CreateTestPlanDocument,
    "\n  mutation UpdateTestPlan($input: UpdateTestPlanInput!) {\n    updateTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.UpdateTestPlanDocument,
    "\n  mutation StartTestRun($input: StartTestRunInput!) {\n    startTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.StartTestRunDocument,
    "\n  mutation SaveTestRun($input: SaveTestRunInput!) {\n    saveTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.SaveTestRunDocument,
    "\n  mutation AttachToTestRun($input: AttachToTestRunInput!) {\n    attachToTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      names\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": typeof types.AttachToTestRunDocument,
    "\n  query TestPlans {\n    testPlans {\n      ...TestPlanRow\n    }\n  }\n": typeof types.TestPlansDocument,
    "\n  query TestPlan($slug: String!) {\n    testPlan(slug: $slug) {\n      ...TestPlanDetail\n    }\n  }\n": typeof types.TestPlanDocument,
    "\n  query TestRun($id: ID!) {\n    testRun(id: $id) {\n      ...TestRunDetail\n    }\n  }\n": typeof types.TestRunDocument,
    "\n  query PrTestRuns($ref: ID!) {\n    pr(ref: $ref) {\n      id\n      refs\n      tested\n      revisions {\n        head\n      }\n      testRuns {\n        ...TestRunRow\n      }\n    }\n  }\n": typeof types.PrTestRunsDocument,
    "\n  query TestAttachment($run: ID!, $name: String!) {\n    testAttachment(run: $run, name: $name) {\n      name\n      contentType\n      size\n      base64\n    }\n  }\n": typeof types.TestAttachmentDocument,
};
const documents: Documents = {
    "\n  fragment TestRunRow on TestRun {\n    id\n    planSlug\n    author\n    started\n    finished\n    commit\n    version\n    outcome\n    pr {\n      id\n    }\n  }\n": types.TestRunRowFragmentDoc,
    "\n  fragment TestPlanRow on TestPlan {\n    slug\n    title\n    author\n    created\n    steps {\n      number\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n": types.TestPlanRowFragmentDoc,
    "\n  fragment TestPlanDetail on TestPlan {\n    slug\n    title\n    author\n    created\n    description\n    path\n    baseSha\n    steps {\n      number\n      title\n      actions\n      expected\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n": types.TestPlanDetailFragmentDoc,
    "\n  fragment TestRunDetail on TestRun {\n    id\n    path\n    planSlug\n    planSha\n    author\n    started\n    finished\n    commit\n    version\n    environment\n    notes\n    outcome\n    stepsFrom\n    baseSha\n    plan {\n      slug\n      title\n    }\n    pr {\n      id\n      title\n      refs\n    }\n    results {\n      number\n      title\n      actions\n      expected\n      status\n      actual\n    }\n    attachments {\n      name\n      path\n    }\n  }\n": types.TestRunDetailFragmentDoc,
    "\n  mutation CreateTestPlan($input: CreateTestPlanInput!) {\n    createTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.CreateTestPlanDocument,
    "\n  mutation UpdateTestPlan($input: UpdateTestPlanInput!) {\n    updateTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.UpdateTestPlanDocument,
    "\n  mutation StartTestRun($input: StartTestRunInput!) {\n    startTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.StartTestRunDocument,
    "\n  mutation SaveTestRun($input: SaveTestRunInput!) {\n    saveTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.SaveTestRunDocument,
    "\n  mutation AttachToTestRun($input: AttachToTestRunInput!) {\n    attachToTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      names\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n": types.AttachToTestRunDocument,
    "\n  query TestPlans {\n    testPlans {\n      ...TestPlanRow\n    }\n  }\n": types.TestPlansDocument,
    "\n  query TestPlan($slug: String!) {\n    testPlan(slug: $slug) {\n      ...TestPlanDetail\n    }\n  }\n": types.TestPlanDocument,
    "\n  query TestRun($id: ID!) {\n    testRun(id: $id) {\n      ...TestRunDetail\n    }\n  }\n": types.TestRunDocument,
    "\n  query PrTestRuns($ref: ID!) {\n    pr(ref: $ref) {\n      id\n      refs\n      tested\n      revisions {\n        head\n      }\n      testRuns {\n        ...TestRunRow\n      }\n    }\n  }\n": types.PrTestRunsDocument,
    "\n  query TestAttachment($run: ID!, $name: String!) {\n    testAttachment(run: $run, name: $name) {\n      name\n      contentType\n      size\n      base64\n    }\n  }\n": types.TestAttachmentDocument,
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
export function graphql(source: "\n  fragment TestRunRow on TestRun {\n    id\n    planSlug\n    author\n    started\n    finished\n    commit\n    version\n    outcome\n    pr {\n      id\n    }\n  }\n"): (typeof documents)["\n  fragment TestRunRow on TestRun {\n    id\n    planSlug\n    author\n    started\n    finished\n    commit\n    version\n    outcome\n    pr {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TestPlanRow on TestPlan {\n    slug\n    title\n    author\n    created\n    steps {\n      number\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n"): (typeof documents)["\n  fragment TestPlanRow on TestPlan {\n    slug\n    title\n    author\n    created\n    steps {\n      number\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TestPlanDetail on TestPlan {\n    slug\n    title\n    author\n    created\n    description\n    path\n    baseSha\n    steps {\n      number\n      title\n      actions\n      expected\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n"): (typeof documents)["\n  fragment TestPlanDetail on TestPlan {\n    slug\n    title\n    author\n    created\n    description\n    path\n    baseSha\n    steps {\n      number\n      title\n      actions\n      expected\n    }\n    stats {\n      runs\n      passed\n      failed\n      blocked\n      skipped\n      incomplete\n      inProgress\n    }\n    runs {\n      ...TestRunRow\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment TestRunDetail on TestRun {\n    id\n    path\n    planSlug\n    planSha\n    author\n    started\n    finished\n    commit\n    version\n    environment\n    notes\n    outcome\n    stepsFrom\n    baseSha\n    plan {\n      slug\n      title\n    }\n    pr {\n      id\n      title\n      refs\n    }\n    results {\n      number\n      title\n      actions\n      expected\n      status\n      actual\n    }\n    attachments {\n      name\n      path\n    }\n  }\n"): (typeof documents)["\n  fragment TestRunDetail on TestRun {\n    id\n    path\n    planSlug\n    planSha\n    author\n    started\n    finished\n    commit\n    version\n    environment\n    notes\n    outcome\n    stepsFrom\n    baseSha\n    plan {\n      slug\n      title\n    }\n    pr {\n      id\n      title\n      refs\n    }\n    results {\n      number\n      title\n      actions\n      expected\n      status\n      actual\n    }\n    attachments {\n      name\n      path\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTestPlan($input: CreateTestPlanInput!) {\n    createTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation CreateTestPlan($input: CreateTestPlanInput!) {\n    createTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateTestPlan($input: UpdateTestPlanInput!) {\n    updateTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateTestPlan($input: UpdateTestPlanInput!) {\n    updateTestPlan(input: $input) {\n      plan {\n        ...TestPlanDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartTestRun($input: StartTestRunInput!) {\n    startTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation StartTestRun($input: StartTestRunInput!) {\n    startTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveTestRun($input: SaveTestRunInput!) {\n    saveTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation SaveTestRun($input: SaveTestRunInput!) {\n    saveTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AttachToTestRun($input: AttachToTestRunInput!) {\n    attachToTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      names\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation AttachToTestRun($input: AttachToTestRunInput!) {\n    attachToTestRun(input: $input) {\n      run {\n        ...TestRunDetail\n      }\n      names\n      commit {\n        committed\n        subject\n        pushed\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TestPlans {\n    testPlans {\n      ...TestPlanRow\n    }\n  }\n"): (typeof documents)["\n  query TestPlans {\n    testPlans {\n      ...TestPlanRow\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TestPlan($slug: String!) {\n    testPlan(slug: $slug) {\n      ...TestPlanDetail\n    }\n  }\n"): (typeof documents)["\n  query TestPlan($slug: String!) {\n    testPlan(slug: $slug) {\n      ...TestPlanDetail\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TestRun($id: ID!) {\n    testRun(id: $id) {\n      ...TestRunDetail\n    }\n  }\n"): (typeof documents)["\n  query TestRun($id: ID!) {\n    testRun(id: $id) {\n      ...TestRunDetail\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PrTestRuns($ref: ID!) {\n    pr(ref: $ref) {\n      id\n      refs\n      tested\n      revisions {\n        head\n      }\n      testRuns {\n        ...TestRunRow\n      }\n    }\n  }\n"): (typeof documents)["\n  query PrTestRuns($ref: ID!) {\n    pr(ref: $ref) {\n      id\n      refs\n      tested\n      revisions {\n        head\n      }\n      testRuns {\n        ...TestRunRow\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TestAttachment($run: ID!, $name: String!) {\n    testAttachment(run: $run, name: $name) {\n      name\n      contentType\n      size\n      base64\n    }\n  }\n"): (typeof documents)["\n  query TestAttachment($run: ID!, $name: String!) {\n    testAttachment(run: $run, name: $name) {\n      name\n      contentType\n      size\n      base64\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;