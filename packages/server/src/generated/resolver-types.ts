import type { GraphQLResolveInfo } from 'graphql';
import type { IssueParent, PrParent, EntityParent, CommentParent, LinkNodeParent, DiagnosticParent } from '../mappers.ts';
import type { GraphQLCtx } from '../context.ts';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/**
 * A comment, or a review when a verdict is given.
 *
 * Review fields are meaningful only on pull requests (§2.6), and `revision` binds
 * the review to one recorded state of the branch — the latest, unless named.
 *
 * A comment is written beside the entity it belongs to, so a pull request the
 * server's checkout does not hold cannot be commented on from here even though
 * `prs(allRefs: true)` can see it: serve a checkout of its branch to review it.
 */
export type AddCommentInput = {
  body: Scalars['String']['input'];
  file?: InputMaybe<Scalars['String']['input']>;
  kind: Kind;
  /** A line number or a `start-end` range. */
  line?: InputMaybe<Scalars['String']['input']>;
  ref: Scalars['ID']['input'];
  /** ID or prefix of the comment being replied to. */
  replyTo?: InputMaybe<Scalars['ID']['input']>;
  /** Prefix of a recorded revision head; defaults to the latest. */
  revision?: InputMaybe<Scalars['String']['input']>;
  verdict?: InputMaybe<Verdict>;
};

export type AddCommentPayload = {
  __typename?: 'AddCommentPayload';
  comment: Comment;
  commit: CommitInfo;
  entity: Entity;
};

export type CloseIssueInput = {
  /** ID or prefix of the issue this one duplicates. */
  duplicateOf?: InputMaybe<Scalars['ID']['input']>;
  ref: Scalars['ID']['input'];
  /** Why it ended, e.g. `fixed` or `wontfix`. */
  resolution?: InputMaybe<Scalars['String']['input']>;
};

export type CloseIssuePayload = {
  __typename?: 'CloseIssuePayload';
  commit: CommitInfo;
  /** Where it now lives, relative to `.navbook/`. */
  destination: Scalars['String']['output'];
  issue: Issue;
};

/** A comment or a review (spec 02 §2.6). */
export type Comment = {
  __typename?: 'Comment';
  author: Scalars['String']['output'];
  body: Scalars['String']['output'];
  created: Scalars['String']['output'];
  file?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** A line number or a `start-end` range, as the format allows. */
  line?: Maybe<Scalars['String']['output']>;
  path: Scalars['String']['output'];
  replyTo?: Maybe<Scalars['ID']['output']>;
  /** The revision the review binds to, as a 40-hex SHA. */
  revision?: Maybe<Scalars['String']['output']>;
  /** Set on reviews; a plain comment has none of the four fields below. */
  verdict?: Maybe<Verdict>;
};

/** What a mutation committed, and whether it reached the remote. */
export type CommitInfo = {
  __typename?: 'CommitInfo';
  /** False when the operation turned out to change nothing. */
  committed: Scalars['Boolean']['output'];
  /** False when the server runs without a remote, or committed nothing. */
  pushed: Scalars['Boolean']['output'];
  subject: Scalars['String']['output'];
};

/** One finding of the `doctor` check (spec 04 §4.3). */
export type Diagnostic = {
  __typename?: 'Diagnostic';
  /** The check that produced it, D1 through D12. */
  check: Scalars['String']['output'];
  /** Whether `nav doctor --fix` could mend it. The server never applies fixes. */
  fixable: Scalars['Boolean']['output'];
  level: DiagnosticLevel;
  message: Scalars['String']['output'];
  /** Path relative to `.navbook/`, or empty for a repository-wide finding. */
  path: Scalars['String']['output'];
};

export type DiagnosticLevel =
  | 'ERROR'
  | 'WARNING';

export type DoctorReport = {
  __typename?: 'DoctorReport';
  diagnostics: Array<Diagnostic>;
};

/** What issues and pull requests have in common (spec 02 §2.5, §2.7). */
export type Entity = {
  /** True when the entity lives under `.navbook/archive/` (spec 03 §3.6). */
  archived: Scalars['Boolean']['output'];
  /** The `assignee` key, which the format allows to be a scalar or a list. */
  assignees: Array<Scalars['String']['output']>;
  /** RFC 5322 address as stored in frontmatter: `Name <email>`. */
  author: Scalars['String']['output'];
  /** Markdown body, trimmed. */
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  milestone?: Maybe<Scalars['String']['output']>;
  /** Path from the repository root, e.g. `.navbook/issues/open/ab12cd34-slug`. */
  path: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  status: Status;
  title: Scalars['String']['output'];
};

/**
 * Which entities to list.
 *
 * Terms are ANDed across keys. Within a key the semantics follow the field:
 * single-valued fields OR their terms, multi-valued fields AND theirs (spec 04).
 */
export type EntityFilter = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  authors?: InputMaybe<Array<Scalars['String']['input']>>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestones?: InputMaybe<Array<Scalars['String']['input']>>;
  /** Defaults to [OPEN], as every listing does. */
  status?: InputMaybe<Array<Status>>;
  /** Free text, matched against title, body and comments. */
  text?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type Issue = Entity & {
  __typename?: 'Issue';
  archived: Scalars['Boolean']['output'];
  assignees: Array<Scalars['String']['output']>;
  author: Scalars['String']['output'];
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  /** The issue this one duplicates. */
  duplicateOf?: Maybe<Scalars['ID']['output']>;
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  milestone?: Maybe<Scalars['String']['output']>;
  /** The issue this one is filed under, when its frontmatter names one. */
  parent?: Maybe<LinkNode>;
  path: Scalars['String']['output'];
  /** Why the issue was closed, when it is closed and recorded one. */
  resolution?: Maybe<Scalars['String']['output']>;
  slug: Scalars['String']['output'];
  status: Status;
  /** The subtask forest, `depth` levels deep (spec 02 §2.5). */
  subtasks: Array<LinkNode>;
  title: Scalars['String']['output'];
};


export type IssueSubtasksArgs = {
  depth?: Scalars['Int']['input'];
};

export type Kind =
  | 'ISSUE'
  | 'PR';

export type LinkIssueInput = {
  /**
   * Consent to move a subtask that already has a parent.
   *
   * Without it such a link fails with REPARENT_REQUIRED, naming the parent the
   * issue has now — moving one changes a structure somebody else may be reading.
   */
  allowReparent?: Scalars['Boolean']['input'];
  /** ID or prefix of the issue to file under another. */
  child: Scalars['ID']['input'];
  /** ID or prefix of the issue it goes under. */
  parent: Scalars['ID']['input'];
};

export type LinkIssuePayload = {
  __typename?: 'LinkIssuePayload';
  child: Issue;
  commit: CommitInfo;
  parent: Issue;
  /** The parent it was moved away from, when it had one. */
  previousParentId?: Maybe<Scalars['ID']['output']>;
};

/**
 * One end of a decomposition link.
 *
 * A link can name something this tree cannot show — an issue on an unfetched
 * branch, a pull request, a loop — and each of those is a different thing to be
 * told, so the node is always returned and says which case it is.
 */
export type LinkNode = {
  __typename?: 'LinkNode';
  children: Array<LinkNode>;
  /** The id is an ancestor of itself: the chain loops here. */
  cycle: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  /** Absent when the id matches no issue in this tree. */
  issue?: Maybe<Issue>;
  /** The id names a pull request, which decomposition never relates (§2.5). */
  notAnIssue: Scalars['Boolean']['output'];
  /** Already expanded elsewhere in this response; not expanded again. */
  repeated: Scalars['Boolean']['output'];
};

/** How a pull request was merged (spec 02 §2.7). */
export type MergedInfo = {
  __typename?: 'MergedInfo';
  by?: Maybe<Scalars['String']['output']>;
  commit?: Maybe<Scalars['String']['output']>;
  date?: Maybe<Scalars['String']['output']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  addComment: AddCommentPayload;
  closeIssue: CloseIssuePayload;
  linkIssue: LinkIssuePayload;
  openIssue: OpenIssuePayload;
  reopenIssue: ReopenIssuePayload;
  unlinkIssue: UnlinkIssuePayload;
  updateIssue: UpdateIssuePayload;
};


export type MutationAddCommentArgs = {
  input: AddCommentInput;
};


export type MutationCloseIssueArgs = {
  input: CloseIssueInput;
};


export type MutationLinkIssueArgs = {
  input: LinkIssueInput;
};


export type MutationOpenIssueArgs = {
  input: OpenIssueInput;
};


export type MutationReopenIssueArgs = {
  ref: Scalars['ID']['input'];
};


export type MutationUnlinkIssueArgs = {
  ref: Scalars['ID']['input'];
};


export type MutationUpdateIssueArgs = {
  input: UpdateIssueInput;
};

export type OpenIssueInput = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  body: Scalars['String']['input'];
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestone?: InputMaybe<Scalars['String']['input']>;
  /** ID or prefix of the issue to file this one under. */
  parent?: InputMaybe<Scalars['ID']['input']>;
  title: Scalars['String']['input'];
};

export type OpenIssuePayload = {
  __typename?: 'OpenIssuePayload';
  commit: CommitInfo;
  issue: Issue;
  /** The issue it was filed under, when one was named. */
  parent?: Maybe<Issue>;
};

export type Pr = Entity & {
  __typename?: 'Pr';
  archived: Scalars['Boolean']['output'];
  assignees: Array<Scalars['String']['output']>;
  author: Scalars['String']['output'];
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  draft: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  merged?: Maybe<MergedInfo>;
  milestone?: Maybe<Scalars['String']['output']>;
  path: Scalars['String']['output'];
  /** Branches the cross-ref scan found it on; empty for a working-tree read. */
  refs: Array<Scalars['String']['output']>;
  revisions: Array<Revision>;
  slug: Scalars['String']['output'];
  /** Branch carrying its commits, when the file records one. */
  source?: Maybe<Scalars['String']['output']>;
  status: Status;
  /** Branch the pull request proposes to merge into. */
  target: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  doctor: DoctorReport;
  /** `ref` is a full ID or an unambiguous prefix of at least four characters. */
  issue: Issue;
  issues: Array<Issue>;
  pr: Pr;
  /**
   * Open pull requests.
   *
   * A pull request's files live on the branch it proposes to merge, so the
   * working tree usually does not hold them: `allRefs` scans every fetched
   * branch instead (spec 03 §3.5).
   */
  prs: Array<Pr>;
  viewer: Viewer;
};


export type QueryIssueArgs = {
  ref: Scalars['ID']['input'];
};


export type QueryIssuesArgs = {
  filter?: InputMaybe<EntityFilter>;
};


export type QueryPrArgs = {
  ref: Scalars['ID']['input'];
};


export type QueryPrsArgs = {
  allRefs?: Scalars['Boolean']['input'];
  filter?: InputMaybe<EntityFilter>;
};

export type ReopenIssuePayload = {
  __typename?: 'ReopenIssuePayload';
  commit: CommitInfo;
  destination: Scalars['String']['output'];
  issue: Issue;
};

/** One state of a pull request's branch (spec 02 §2.7). */
export type Revision = {
  __typename?: 'Revision';
  base: Scalars['String']['output'];
  date: Scalars['String']['output'];
  head: Scalars['String']['output'];
};

/** Issues are open or closed; pull requests may also be merged (spec 02 §2.1). */
export type Status =
  | 'CLOSED'
  | 'MERGED'
  | 'OPEN';

export type UnlinkIssuePayload = {
  __typename?: 'UnlinkIssuePayload';
  child: Issue;
  commit: CommitInfo;
  previousParentId?: Maybe<Scalars['ID']['output']>;
};

/**
 * Fields to change on an issue.
 *
 * An omitted field is left alone. An explicit null clears the key, as does an
 * empty list for `labels` and `assignees`; `title` and `body` can be replaced but
 * not cleared. Frontmatter keys this schema does not name are always preserved.
 */
export type UpdateIssueInput = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  body?: InputMaybe<Scalars['String']['input']>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestone?: InputMaybe<Scalars['String']['input']>;
  ref: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateIssuePayload = {
  __typename?: 'UpdateIssuePayload';
  commit: CommitInfo;
  issue: Issue;
};

export type Verdict =
  | 'APPROVE'
  | 'REQUEST_CHANGES';

/** Who the presented token says is acting; what mutations record as `author`. */
export type Viewer = {
  __typename?: 'Viewer';
  email: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AddCommentInput: AddCommentInput;
  AddCommentPayload: ResolverTypeWrapper<Omit<AddCommentPayload, 'comment' | 'entity'> & { comment: ResolversTypes['Comment'], entity: ResolversTypes['Entity'] }>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: ResolverTypeWrapper<Omit<CloseIssuePayload, 'issue'> & { issue: ResolversTypes['Issue'] }>;
  Comment: ResolverTypeWrapper<CommentParent>;
  CommitInfo: ResolverTypeWrapper<CommitInfo>;
  Diagnostic: ResolverTypeWrapper<DiagnosticParent>;
  DiagnosticLevel: DiagnosticLevel;
  DoctorReport: ResolverTypeWrapper<Omit<DoctorReport, 'diagnostics'> & { diagnostics: Array<ResolversTypes['Diagnostic']> }>;
  Entity: ResolverTypeWrapper<EntityParent>;
  EntityFilter: EntityFilter;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Issue: ResolverTypeWrapper<IssueParent>;
  Kind: Kind;
  LinkIssueInput: LinkIssueInput;
  LinkIssuePayload: ResolverTypeWrapper<Omit<LinkIssuePayload, 'child' | 'parent'> & { child: ResolversTypes['Issue'], parent: ResolversTypes['Issue'] }>;
  LinkNode: ResolverTypeWrapper<LinkNodeParent>;
  MergedInfo: ResolverTypeWrapper<MergedInfo>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  OpenIssueInput: OpenIssueInput;
  OpenIssuePayload: ResolverTypeWrapper<Omit<OpenIssuePayload, 'issue' | 'parent'> & { issue: ResolversTypes['Issue'], parent?: Maybe<ResolversTypes['Issue']> }>;
  Pr: ResolverTypeWrapper<PrParent>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  ReopenIssuePayload: ResolverTypeWrapper<Omit<ReopenIssuePayload, 'issue'> & { issue: ResolversTypes['Issue'] }>;
  Revision: ResolverTypeWrapper<Revision>;
  Status: Status;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  UnlinkIssuePayload: ResolverTypeWrapper<Omit<UnlinkIssuePayload, 'child'> & { child: ResolversTypes['Issue'] }>;
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: ResolverTypeWrapper<Omit<UpdateIssuePayload, 'issue'> & { issue: ResolversTypes['Issue'] }>;
  Verdict: Verdict;
  Viewer: ResolverTypeWrapper<Viewer>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AddCommentInput: AddCommentInput;
  AddCommentPayload: Omit<AddCommentPayload, 'comment' | 'entity'> & { comment: ResolversParentTypes['Comment'], entity: ResolversParentTypes['Entity'] };
  Boolean: Scalars['Boolean']['output'];
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: Omit<CloseIssuePayload, 'issue'> & { issue: ResolversParentTypes['Issue'] };
  Comment: CommentParent;
  CommitInfo: CommitInfo;
  Diagnostic: DiagnosticParent;
  DoctorReport: Omit<DoctorReport, 'diagnostics'> & { diagnostics: Array<ResolversParentTypes['Diagnostic']> };
  Entity: EntityParent;
  EntityFilter: EntityFilter;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Issue: IssueParent;
  LinkIssueInput: LinkIssueInput;
  LinkIssuePayload: Omit<LinkIssuePayload, 'child' | 'parent'> & { child: ResolversParentTypes['Issue'], parent: ResolversParentTypes['Issue'] };
  LinkNode: LinkNodeParent;
  MergedInfo: MergedInfo;
  Mutation: Record<PropertyKey, never>;
  OpenIssueInput: OpenIssueInput;
  OpenIssuePayload: Omit<OpenIssuePayload, 'issue' | 'parent'> & { issue: ResolversParentTypes['Issue'], parent?: Maybe<ResolversParentTypes['Issue']> };
  Pr: PrParent;
  Query: Record<PropertyKey, never>;
  ReopenIssuePayload: Omit<ReopenIssuePayload, 'issue'> & { issue: ResolversParentTypes['Issue'] };
  Revision: Revision;
  String: Scalars['String']['output'];
  UnlinkIssuePayload: Omit<UnlinkIssuePayload, 'child'> & { child: ResolversParentTypes['Issue'] };
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: Omit<UpdateIssuePayload, 'issue'> & { issue: ResolversParentTypes['Issue'] };
  Viewer: Viewer;
};

export type AddCommentPayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['AddCommentPayload'] = ResolversParentTypes['AddCommentPayload']> = {
  comment?: Resolver<ResolversTypes['Comment'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  entity?: Resolver<ResolversTypes['Entity'], ParentType, ContextType>;
};

export type CloseIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['CloseIssuePayload'] = ResolversParentTypes['CloseIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  destination?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
};

export type CommentResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Comment'] = ResolversParentTypes['Comment']> = {
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  file?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  line?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  replyTo?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  revision?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  verdict?: Resolver<Maybe<ResolversTypes['Verdict']>, ParentType, ContextType>;
};

export type CommitInfoResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['CommitInfo'] = ResolversParentTypes['CommitInfo']> = {
  committed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  pushed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  subject?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type DiagnosticResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Diagnostic'] = ResolversParentTypes['Diagnostic']> = {
  check?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fixable?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  level?: Resolver<ResolversTypes['DiagnosticLevel'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type DoctorReportResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['DoctorReport'] = ResolversParentTypes['DoctorReport']> = {
  diagnostics?: Resolver<Array<ResolversTypes['Diagnostic']>, ParentType, ContextType>;
};

export type EntityResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Entity'] = ResolversParentTypes['Entity']> = {
  __resolveType: TypeResolveFn<'Issue' | 'Pr', ParentType, ContextType>;
};

export type IssueResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Issue'] = ResolversParentTypes['Issue']> = {
  archived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  assignees?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  comments?: Resolver<Array<ResolversTypes['Comment']>, ParentType, ContextType>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  duplicateOf?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['Kind'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['LinkNode']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  resolution?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['Status'], ParentType, ContextType>;
  subtasks?: Resolver<Array<ResolversTypes['LinkNode']>, ParentType, ContextType, RequireFields<IssueSubtasksArgs, 'depth'>>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type LinkIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['LinkIssuePayload'] = ResolversParentTypes['LinkIssuePayload']> = {
  child?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  parent?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  previousParentId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type LinkNodeResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['LinkNode'] = ResolversParentTypes['LinkNode']> = {
  children?: Resolver<Array<ResolversTypes['LinkNode']>, ParentType, ContextType>;
  cycle?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  issue?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
  notAnIssue?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  repeated?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type MergedInfoResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['MergedInfo'] = ResolversParentTypes['MergedInfo']> = {
  by?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  commit?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  date?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  addComment?: Resolver<ResolversTypes['AddCommentPayload'], ParentType, ContextType, RequireFields<MutationAddCommentArgs, 'input'>>;
  closeIssue?: Resolver<ResolversTypes['CloseIssuePayload'], ParentType, ContextType, RequireFields<MutationCloseIssueArgs, 'input'>>;
  linkIssue?: Resolver<ResolversTypes['LinkIssuePayload'], ParentType, ContextType, RequireFields<MutationLinkIssueArgs, 'input'>>;
  openIssue?: Resolver<ResolversTypes['OpenIssuePayload'], ParentType, ContextType, RequireFields<MutationOpenIssueArgs, 'input'>>;
  reopenIssue?: Resolver<ResolversTypes['ReopenIssuePayload'], ParentType, ContextType, RequireFields<MutationReopenIssueArgs, 'ref'>>;
  unlinkIssue?: Resolver<ResolversTypes['UnlinkIssuePayload'], ParentType, ContextType, RequireFields<MutationUnlinkIssueArgs, 'ref'>>;
  updateIssue?: Resolver<ResolversTypes['UpdateIssuePayload'], ParentType, ContextType, RequireFields<MutationUpdateIssueArgs, 'input'>>;
};

export type OpenIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['OpenIssuePayload'] = ResolversParentTypes['OpenIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type PrResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Pr'] = ResolversParentTypes['Pr']> = {
  archived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  assignees?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  comments?: Resolver<Array<ResolversTypes['Comment']>, ParentType, ContextType>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  draft?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['Kind'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  merged?: Resolver<Maybe<ResolversTypes['MergedInfo']>, ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  refs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  revisions?: Resolver<Array<ResolversTypes['Revision']>, ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  source?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  status?: Resolver<ResolversTypes['Status'], ParentType, ContextType>;
  target?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type QueryResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  doctor?: Resolver<ResolversTypes['DoctorReport'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType, RequireFields<QueryIssueArgs, 'ref'>>;
  issues?: Resolver<Array<ResolversTypes['Issue']>, ParentType, ContextType, Partial<QueryIssuesArgs>>;
  pr?: Resolver<ResolversTypes['Pr'], ParentType, ContextType, RequireFields<QueryPrArgs, 'ref'>>;
  prs?: Resolver<Array<ResolversTypes['Pr']>, ParentType, ContextType, RequireFields<QueryPrsArgs, 'allRefs'>>;
  viewer?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType>;
};

export type ReopenIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['ReopenIssuePayload'] = ResolversParentTypes['ReopenIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  destination?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
};

export type RevisionResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Revision'] = ResolversParentTypes['Revision']> = {
  base?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  head?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type UnlinkIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UnlinkIssuePayload'] = ResolversParentTypes['UnlinkIssuePayload']> = {
  child?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  previousParentId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type UpdateIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UpdateIssuePayload'] = ResolversParentTypes['UpdateIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
};

export type ViewerResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = {
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLCtx> = {
  AddCommentPayload?: AddCommentPayloadResolvers<ContextType>;
  CloseIssuePayload?: CloseIssuePayloadResolvers<ContextType>;
  Comment?: CommentResolvers<ContextType>;
  CommitInfo?: CommitInfoResolvers<ContextType>;
  Diagnostic?: DiagnosticResolvers<ContextType>;
  DoctorReport?: DoctorReportResolvers<ContextType>;
  Entity?: EntityResolvers<ContextType>;
  Issue?: IssueResolvers<ContextType>;
  LinkIssuePayload?: LinkIssuePayloadResolvers<ContextType>;
  LinkNode?: LinkNodeResolvers<ContextType>;
  MergedInfo?: MergedInfoResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  OpenIssuePayload?: OpenIssuePayloadResolvers<ContextType>;
  Pr?: PrResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ReopenIssuePayload?: ReopenIssuePayloadResolvers<ContextType>;
  Revision?: RevisionResolvers<ContextType>;
  UnlinkIssuePayload?: UnlinkIssuePayloadResolvers<ContextType>;
  UpdateIssuePayload?: UpdateIssuePayloadResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
};

