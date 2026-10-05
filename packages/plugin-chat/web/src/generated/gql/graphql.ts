/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ChatApproval = {
  approved: boolean;
  callId: string;
};

export type ChatDoneReason =
  /** Writes wait for approval; send the decisions to continue. */
  | 'APPROVAL'
  /** The reply reached the model's length limit. */
  | 'LENGTH'
  /** The assistant made as many tool calls as a turn allows, and was stopped. */
  | 'LIMIT'
  /** The assistant answered. */
  | 'STOP';

export type ChatEventType =
  /** A write waits for the person: `callId`, `tool`, `arguments`, `summary`. */
  | 'APPROVAL_REQUEST'
  /** The turn is over: `reason`, and the `transcript` to send back next. */
  | 'DONE'
  /** The turn failed: `message`, `code`, and the `transcript` as far as it got. */
  | 'ERROR'
  /** More of the reply: `delta`. */
  | 'TEXT'
  /** The model called a tool: `callId`, `tool`, `arguments`. */
  | 'TOOL_CALL'
  /**
   * A tool ran, or was declined: `callId`, `tool`, `ok`, `summary`, and `commit`,
   * `record` and `transcript` for a write that ran.
   */
  | 'TOOL_RESULT';

export type ChatInput = {
  /** A decision for each write the transcript leaves waiting. */
  approvals?: Array<ChatApproval> | null | undefined;
  /** Run writes without waiting for approval: the client's “Allow all”. */
  autoApprove?: boolean | null | undefined;
  /** What the person just said. Omitted when this turn only answers approvals. */
  message?: string | null | undefined;
  /**
   * The last `transcript` the previous turn carried, as it came; `"[]"` to start.
   * A string of JSON the client never needs to read: the host's `JSON` scalar is
   * output-only.
   */
  transcript: string;
};

export type Kind =
  | 'ISSUE'
  | 'PR';

export type ChatStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ChatStatusQuery = { chat: { model: string, endpoint: string } | null };

export type ChatSubscriptionVariables = Exact<{
  input: ChatInput;
}>;


export type ChatSubscription = { chat: { type: ChatEventType, delta: string | null, callId: string | null, tool: string | null, arguments: unknown, summary: string | null, ok: boolean | null, reason: ChatDoneReason | null, transcript: string | null, message: string | null, code: string | null, commit: { committed: boolean, subject: string, pushed: boolean } | null, record: { kind: Kind, id: string } | null } };


export const ChatStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ChatStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"endpoint"}}]}}]}}]} as unknown as DocumentNode<ChatStatusQuery, ChatStatusQueryVariables>;
export const ChatDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"Chat"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ChatInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"chat"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"delta"}},{"kind":"Field","name":{"kind":"Name","value":"callId"}},{"kind":"Field","name":{"kind":"Name","value":"tool"}},{"kind":"Field","name":{"kind":"Name","value":"arguments"}},{"kind":"Field","name":{"kind":"Name","value":"summary"}},{"kind":"Field","name":{"kind":"Name","value":"ok"}},{"kind":"Field","name":{"kind":"Name","value":"commit"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"committed"}},{"kind":"Field","name":{"kind":"Name","value":"subject"}},{"kind":"Field","name":{"kind":"Name","value":"pushed"}}]}},{"kind":"Field","name":{"kind":"Name","value":"record"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"transcript"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"code"}}]}}]}}]} as unknown as DocumentNode<ChatSubscription, ChatSubscriptionVariables>;