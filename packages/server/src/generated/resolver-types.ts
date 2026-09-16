import type { GraphQLResolveInfo } from 'graphql';
import type { IssueParent, PrParent, EntityParent, CommentParent, LinkNodeParent, DiagnosticParent, FeatureParent, SpecParent, CommitParent } from '../mappers.ts';
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

export type AddSpecInput = {
  body: Scalars['String']['input'];
  /** Slug of the feature to add it to. */
  feature: Scalars['String']['input'];
  /** File to write it to; derived from the title when absent. */
  fileName?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
};

export type AddSpecPayload = {
  __typename?: 'AddSpecPayload';
  commit: CommitInfo;
  feature: Feature;
  spec: Spec;
};

/** Approvals counted against the number the review policy asks for. */
export type Approvals = {
  __typename?: 'Approvals';
  given: Scalars['Int']['output'];
  required: Scalars['Int']['output'];
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
  /** Where it now lives, relative to the Navbook directory. */
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

/** A commit, as a feature's history reports it. */
export type Commit = {
  __typename?: 'Commit';
  /** RFC 5322 address of the commit's author: `Name <email>`. */
  author: Scalars['String']['output'];
  /** Author date, ISO 8601. */
  date: Scalars['String']['output'];
  sha: Scalars['String']['output'];
  subject: Scalars['String']['output'];
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

export type CreateFeatureInput = {
  /** Directory to file it under; derived from the title when absent. */
  slug?: InputMaybe<Scalars['String']['input']>;
  /** Markdown summary; a feature may have none. */
  summary?: InputMaybe<Scalars['String']['input']>;
  title: Scalars['String']['input'];
};

export type CreateFeaturePayload = {
  __typename?: 'CreateFeaturePayload';
  commit: CommitInfo;
  feature: Feature;
};

/** Where an issue stands against its deadline (spec 02 §2.5). */
export type DeadlineState =
  /** Wanted on no particular day. */
  | 'NONE'
  /** Wanted on a day now past. Strict: work wanted today is not yet late. */
  | 'OVERDUE';

/** One finding of the `doctor` check (spec 04 §4.3). */
export type Diagnostic = {
  __typename?: 'Diagnostic';
  /** The check that produced it, D1 through D15. */
  check: Scalars['String']['output'];
  /** Whether `nav doctor --fix` could mend it. The server never applies fixes. */
  fixable: Scalars['Boolean']['output'];
  level: DiagnosticLevel;
  message: Scalars['String']['output'];
  /** Path relative to the Navbook directory, or empty for a repository-wide finding. */
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
  /** True when the entity lives under the Navbook directory's `archive/` (spec 03 §3.6). */
  archived: Scalars['Boolean']['output'];
  /** The `assignee` key, which the format allows to be a scalar or a list. */
  assignees: Array<Scalars['String']['output']>;
  /** RFC 5322 address as stored in frontmatter: `Name <email>`. */
  author: Scalars['String']['output'];
  /** Markdown body, trimmed. */
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  /** Slugs of the features this entity belongs to (spec 02 §2.11). */
  features: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  milestone?: Maybe<Scalars['String']['output']>;
  /**
   * Path from the repository root, e.g. `.navbook/issues/open/ab12cd34-slug`.
   *
   * The first segment is the repository's Navbook directory, which defaults to
   * `.navbook` but is not always named that (spec 02 §2.1).
   */
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
  /** Asked to review it and has not answered the latest revision. */
  awaiting?: InputMaybe<Array<Scalars['String']['input']>>;
  /**
   * Where the issue stands against its deadline; any one of them matches.
   *
   * Judged against the server's own day, in UTC. This describes something only
   * an issue has, so `prs` rejects it rather than matching nothing — the mirror
   * of what `issues` does with the three above.
   */
  deadline?: InputMaybe<Array<DeadlineState>>;
  /** Feature slugs; an entity must name every one of them. */
  features?: InputMaybe<Array<Scalars['String']['input']>>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestones?: InputMaybe<Array<Scalars['String']['input']>>;
  /**
   * Asked to review it; a pull request must name every one of them.
   *
   * This and the two below describe something only a pull request has, so
   * `issues` rejects them rather than matching nothing.
   */
  reviewers?: InputMaybe<Array<Scalars['String']['input']>>;
  /** The pull request's derived decision; any one of them matches. */
  reviews?: InputMaybe<Array<ReviewDecision>>;
  /** Absent or empty means any status; the listing is not narrowed by one. */
  status?: InputMaybe<Array<Status>>;
  /** Free text, matched against title, body and comments. */
  text?: InputMaybe<Array<Scalars['String']['input']>>;
};

/**
 * A feature: a standing concept work attaches to (spec 02 §2.11).
 *
 * It has no ID and no status. Its `slug` is the directory that holds it and is
 * what an entity's `feature` key names; the work attached to it has the status.
 */
export type Feature = {
  __typename?: 'Feature';
  /** RFC 5322 address as stored in frontmatter: `Name <email>`. */
  author: Scalars['String']['output'];
  /**
   * The blob hash of `feature.md` as it now stands.
   *
   * Hand it back as `baseSha` when editing, and an edit made against an older
   * version is refused rather than landed on top of somebody else's.
   */
  baseSha: Scalars['String']['output'];
  /**
   * Commits that touched this feature, newest first.
   *
   * A commit counts when it changed the feature's documents, when it changed the
   * directory of an issue or pull request naming the feature, or when its message
   * references one of those by ID — which is how a commit that only touches code
   * joins the story (spec 04 §4.3). Read from the served checkout's history.
   */
  commits: Array<Commit>;
  created: Scalars['String']['output'];
  /** Issues naming this feature, newest first, whatever their status. */
  issues: Array<Issue>;
  /** Path from the repository root, e.g. `.navbook/specs/auth`. */
  path: Scalars['String']['output'];
  /** Pull requests naming this feature, newest first. */
  prs: Array<Pr>;
  slug: Scalars['String']['output'];
  /** Specification documents, in file-name order. */
  specs: Array<Spec>;
  /** Markdown summary, trimmed. A feature may have none. */
  summary: Scalars['String']['output'];
  title: Scalars['String']['output'];
};


/**
 * A feature: a standing concept work attaches to (spec 02 §2.11).
 *
 * It has no ID and no status. Its `slug` is the directory that holds it and is
 * what an entity's `feature` key names; the work attached to it has the status.
 */
export type FeatureCommitsArgs = {
  limit?: Scalars['Int']['input'];
};

export type Issue = Entity & {
  __typename?: 'Issue';
  archived: Scalars['Boolean']['output'];
  assignees: Array<Scalars['String']['output']>;
  author: Scalars['String']['output'];
  /**
   * The blob hash of `issue.md` as it now stands.
   *
   * Hand it back as `baseSha` when editing a field from a rendered value, and an
   * edit made against an older version of that field is refused rather than
   * landed on top of somebody else's (see `UpdateIssueInput.baseSha`). Comments
   * live in their own files, so the hash does not move when one is added.
   */
  baseSha: Scalars['String']['output'];
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  /** When the work is wanted, `YYYY-MM-DD`. A date, so it carries no zone. */
  deadline?: Maybe<Scalars['String']['output']>;
  /** The issue this one duplicates. */
  duplicateOf?: Maybe<Scalars['ID']['output']>;
  features: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  milestone?: Maybe<Scalars['String']['output']>;
  /** The issue this one is filed under, when its frontmatter names one. */
  parent?: Maybe<LinkNode>;
  path: Scalars['String']['output'];
  /**
   * Where the issue sits in the queue; lower first (spec 02 §2.5).
   *
   * A position rather than a grade, so the values mean nothing beyond their
   * order: any finite number is one, negative and fractional included.
   */
  rank?: Maybe<Scalars['Float']['output']>;
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
  addSpec: AddSpecPayload;
  closeIssue: CloseIssuePayload;
  createFeature: CreateFeaturePayload;
  linkIssue: LinkIssuePayload;
  openIssue: OpenIssuePayload;
  reopenIssue: ReopenIssuePayload;
  unlinkIssue: UnlinkIssuePayload;
  updateFeature: UpdateFeaturePayload;
  updateIssue: UpdateIssuePayload;
  /**
   * Patch a pull request's metadata, `reviewers` included.
   *
   * Refused with `PRECONDITION` when this checkout does not hold the branch the
   * pull request lives on, for the reason `addComment` is: there is no `pr.md`
   * here to patch, and the answer is to serve that branch.
   */
  updatePr: UpdatePrPayload;
  updateSpec: UpdateSpecPayload;
};


export type MutationAddCommentArgs = {
  input: AddCommentInput;
};


export type MutationAddSpecArgs = {
  input: AddSpecInput;
};


export type MutationCloseIssueArgs = {
  input: CloseIssueInput;
};


export type MutationCreateFeatureArgs = {
  input: CreateFeatureInput;
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


export type MutationUpdateFeatureArgs = {
  input: UpdateFeatureInput;
};


export type MutationUpdateIssueArgs = {
  input: UpdateIssueInput;
};


export type MutationUpdatePrArgs = {
  input: UpdatePrInput;
};


export type MutationUpdateSpecArgs = {
  input: UpdateSpecInput;
};

export type OpenIssueInput = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  body: Scalars['String']['input'];
  /** When the work is wanted, `YYYY-MM-DD`. */
  deadline?: InputMaybe<Scalars['String']['input']>;
  /** Slugs of features to attach it to (spec 02 §2.11). */
  features?: InputMaybe<Array<Scalars['String']['input']>>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestone?: InputMaybe<Scalars['String']['input']>;
  /** ID or prefix of the issue to file this one under. */
  parent?: InputMaybe<Scalars['ID']['input']>;
  /** Where it sits in the queue; lower first (spec 02 §2.5). */
  rank?: InputMaybe<Scalars['Float']['input']>;
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
  /** How many approvals stand, against how many the policy asks for. */
  approvals: Approvals;
  archived: Scalars['Boolean']['output'];
  assignees: Array<Scalars['String']['output']>;
  author: Scalars['String']['output'];
  /** The blob hash of `pr.md` as it now stands; see `Issue.baseSha`. */
  baseSha: Scalars['String']['output'];
  body: Scalars['String']['output'];
  comments: Array<Comment>;
  created: Scalars['String']['output'];
  draft: Scalars['Boolean']['output'];
  features: Array<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Kind;
  labels: Array<Scalars['String']['output']>;
  merged?: Maybe<MergedInfo>;
  milestone?: Maybe<Scalars['String']['output']>;
  path: Scalars['String']['output'];
  /** Branches the cross-ref scan found it on; empty for a working-tree read. */
  refs: Array<Scalars['String']['output']>;
  /**
   * What those reviews add up to, counted by `reviewPolicy`. Never a gate: it is
   * a reading of the files, and no operation is refused on it (spec 01 §1.7).
   */
  reviewDecision: ReviewDecision;
  /** Who it asks to review, as `reviewer:` records them (spec 02 §2.7). */
  reviewers: Array<Scalars['String']['output']>;
  /**
   * Everyone asked, plus anyone else who reviewed the latest revision, minus the
   * author. Derived from the reviews and stored nowhere.
   */
  reviews: Array<ReviewerState>;
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
  /** `slug` is exact: a feature is named by a word somebody chose, not a prefix. */
  feature: Feature;
  /** Every feature in the working tree, in slug order (spec 02 §2.11). */
  features: Array<Feature>;
  /** `ref` is a full ID or an unambiguous prefix of at least four characters. */
  issue: Issue;
  issues: Array<Issue>;
  /**
   * Everyone this repository knows of, for the fields that name a person.
   *
   * Merged from three places and stored nowhere: the authors of the served
   * checkout's history, with `.mailmap` honoured (spec 02 §2.4) and the clone's
   * own committer left out, since it commits on everybody's behalf (§6.2);
   * everyone the tree names as author, assignee, reviewer, merger or commenter,
   * which is how somebody who has only ever worked through this API is known at
   * all; and the signed-in viewer.
   *
   * One entry per address, compared case-insensitively, as RFC 5322 addresses
   * sorted by what is shown — the display name, or the address where there is no
   * name. A name comes from the first of those sources that has one, so the most
   * recent commit names a person before a file does, and a file names one the
   * history left bare.
   *
   * History is the served branch's alone: somebody whose only commits are on a
   * branch this checkout does not hold is here through the tree, or not at all.
   *
   * Derived, disposable and never committed — the kind of index §6.6 permits —
   * so it is a suggestion and not a registry: every person field still takes an
   * address that is not in this list.
   */
  people: Array<Scalars['String']['output']>;
  pr: Pr;
  /**
   * Pull requests recorded in the working tree.
   *
   * A pull request's files live on the branch it proposes to merge, so the
   * working tree usually does not hold them: `allRefs` scans every fetched
   * branch instead (spec 03 §3.5). That scan finds open pull requests only, so
   * `allRefs` narrows the statuses on offer no matter what `filter` names.
   */
  prs: Array<Pr>;
  /** How this repository counts reviews (spec 02 §2.10). */
  reviewPolicy: ReviewPolicy;
  viewer: Viewer;
};


export type QueryFeatureArgs = {
  slug: Scalars['String']['input'];
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

export type ReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'PENDING';

/**
 * How this repository counts reviews, as its marker declares it (spec 02 §2.10).
 *
 * Advisory throughout: it changes what the decision counts and what a client may
 * say about it, never what any operation will do.
 */
export type ReviewPolicy = {
  __typename?: 'ReviewPolicy';
  /** False when the marker declares no policy, and these are the defaults. */
  declared: Scalars['Boolean']['output'];
  /** How many approvals a decision of APPROVED takes; at least 1. */
  minApprovals: Scalars['Int']['output'];
  /**
   * What could not be read, one message per fault; empty when there is nothing
   * wrong. A malformed policy defaults rather than failing, so a client showing
   * these is showing why the numbers beside them are the defaults (check D15).
   */
  problems: Array<Scalars['String']['output']>;
  /** Whether a pull request's own author is counted among its reviewers. */
  selfReview: Scalars['Boolean']['output'];
};

export type ReviewState =
  | 'APPROVE'
  /** They read the revision and judged nothing. */
  | 'COMMENTED'
  /** They were asked and have not answered this revision. */
  | 'PENDING'
  | 'REQUEST_CHANGES';

/** What one person has said about a pull request's latest revision. */
export type ReviewerState = {
  __typename?: 'ReviewerState';
  /** The review this was read from, absent while they have not answered. */
  comment?: Maybe<Scalars['ID']['output']>;
  person: Scalars['String']['output'];
  state: ReviewState;
  /** True when nobody asked them; their review counts all the same. */
  volunteer: Scalars['Boolean']['output'];
};

/** One state of a pull request's branch (spec 02 §2.7). */
export type Revision = {
  __typename?: 'Revision';
  base: Scalars['String']['output'];
  date: Scalars['String']['output'];
  head: Scalars['String']['output'];
};

/** One of a feature's specification documents (spec 02 §2.11). */
export type Spec = {
  __typename?: 'Spec';
  /** The blob hash of this file as it now stands; see `Feature.baseSha`. */
  baseSha: Scalars['String']['output'];
  /** Markdown body, trimmed. */
  body: Scalars['String']['output'];
  /** File name inside the feature's directory, e.g. `login-flow.md`. */
  fileName: Scalars['String']['output'];
  /** Path from the repository root. */
  path: Scalars['String']['output'];
  title: Scalars['String']['output'];
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
 * Fields to change on a feature's identity card.
 *
 * An omitted field is left alone; `title` can be replaced but not cleared, and an
 * explicit null clears the summary. Frontmatter keys this schema does not name
 * are always preserved.
 */
export type UpdateFeatureInput = {
  /**
   * The `baseSha` the editor started from.
   *
   * A save whose file has moved on since is refused with `STALE_CONTENT` rather
   * than landed on top of the change that moved it (spec 06 §6.3).
   */
  baseSha: Scalars['String']['input'];
  slug: Scalars['String']['input'];
  summary?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateFeaturePayload = {
  __typename?: 'UpdateFeaturePayload';
  commit: CommitInfo;
  feature: Feature;
};

/**
 * Fields to change on an issue.
 *
 * An omitted field is left alone. An explicit null clears the key, as does an
 * empty list for `labels`, `assignees` and `features`; `title` and `body` can be
 * replaced but not cleared. Frontmatter keys this schema does not name are always
 * preserved.
 */
export type UpdateIssueInput = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  /**
   * The `baseSha` the edit was composed against, when it was composed against one.
   *
   * Optional, unlike `UpdateSpecInput.baseSha`: a listing that toggles a label or
   * a drag that sets a rank has not read the file, and need not. Absent, the
   * patch lands on the file as it is. Present, the patch is refused with
   * `STALE_CONTENT` when a field it names has changed since — and only then, so
   * a label set on an issue somebody has just retitled still lands. The refusal
   * lists the fields that moved in `extensions.moved`, spelled as this input
   * spells them. A hash this server cannot resolve is stale by definition.
   */
  baseSha?: InputMaybe<Scalars['String']['input']>;
  body?: InputMaybe<Scalars['String']['input']>;
  /** When the work is wanted, `YYYY-MM-DD`; an explicit null undates it. */
  deadline?: InputMaybe<Scalars['String']['input']>;
  features?: InputMaybe<Array<Scalars['String']['input']>>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestone?: InputMaybe<Scalars['String']['input']>;
  /** Where it sits in the queue; an explicit null unplaces it (spec 02 §2.5). */
  rank?: InputMaybe<Scalars['Float']['input']>;
  ref: Scalars['ID']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateIssuePayload = {
  __typename?: 'UpdateIssuePayload';
  commit: CommitInfo;
  issue: Issue;
};

/**
 * Fields to change on a pull request.
 *
 * The twin of `UpdateIssueInput`, with the same absent-versus-null rules, plus
 * the people it asks to review. What a pull request *is* — its revisions, its
 * target, whether it merged — is not patchable here: those need a branch and a
 * working tree, and the checkout-centric verbs are not exposed (spec 06 §6.3).
 */
export type UpdatePrInput = {
  assignees?: InputMaybe<Array<Scalars['String']['input']>>;
  /** See `UpdateIssueInput.baseSha`. */
  baseSha?: InputMaybe<Scalars['String']['input']>;
  body?: InputMaybe<Scalars['String']['input']>;
  features?: InputMaybe<Array<Scalars['String']['input']>>;
  labels?: InputMaybe<Array<Scalars['String']['input']>>;
  milestone?: InputMaybe<Scalars['String']['input']>;
  ref: Scalars['ID']['input'];
  reviewers?: InputMaybe<Array<Scalars['String']['input']>>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdatePrPayload = {
  __typename?: 'UpdatePrPayload';
  commit: CommitInfo;
  pr: Pr;
};

/** Fields to change on a document; `title` and `body` are replaced, never cleared. */
export type UpdateSpecInput = {
  /** See `UpdateFeatureInput.baseSha`. */
  baseSha: Scalars['String']['input'];
  body?: InputMaybe<Scalars['String']['input']>;
  feature: Scalars['String']['input'];
  fileName: Scalars['String']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateSpecPayload = {
  __typename?: 'UpdateSpecPayload';
  commit: CommitInfo;
  feature: Feature;
  spec: Spec;
};

/**
 * What a review says about the revision it names (spec 02 §2.6).
 *
 * `COMMENT` is the third: a review that judges nothing and records only that its
 * author read the revision. It satisfies a request for review like the other two
 * and never counts toward `reviewDecision`.
 */
export type Verdict =
  | 'APPROVE'
  | 'COMMENT'
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
  AddSpecInput: AddSpecInput;
  AddSpecPayload: ResolverTypeWrapper<Omit<AddSpecPayload, 'feature' | 'spec'> & { feature: ResolversTypes['Feature'], spec: ResolversTypes['Spec'] }>;
  Approvals: ResolverTypeWrapper<Approvals>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: ResolverTypeWrapper<Omit<CloseIssuePayload, 'issue'> & { issue: ResolversTypes['Issue'] }>;
  Comment: ResolverTypeWrapper<CommentParent>;
  Commit: ResolverTypeWrapper<CommitParent>;
  CommitInfo: ResolverTypeWrapper<CommitInfo>;
  CreateFeatureInput: CreateFeatureInput;
  CreateFeaturePayload: ResolverTypeWrapper<Omit<CreateFeaturePayload, 'feature'> & { feature: ResolversTypes['Feature'] }>;
  DeadlineState: DeadlineState;
  Diagnostic: ResolverTypeWrapper<DiagnosticParent>;
  DiagnosticLevel: DiagnosticLevel;
  DoctorReport: ResolverTypeWrapper<Omit<DoctorReport, 'diagnostics'> & { diagnostics: Array<ResolversTypes['Diagnostic']> }>;
  Entity: ResolverTypeWrapper<EntityParent>;
  EntityFilter: EntityFilter;
  Feature: ResolverTypeWrapper<FeatureParent>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
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
  ReviewDecision: ReviewDecision;
  ReviewPolicy: ResolverTypeWrapper<ReviewPolicy>;
  ReviewState: ReviewState;
  ReviewerState: ResolverTypeWrapper<ReviewerState>;
  Revision: ResolverTypeWrapper<Revision>;
  Spec: ResolverTypeWrapper<SpecParent>;
  Status: Status;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  UnlinkIssuePayload: ResolverTypeWrapper<Omit<UnlinkIssuePayload, 'child'> & { child: ResolversTypes['Issue'] }>;
  UpdateFeatureInput: UpdateFeatureInput;
  UpdateFeaturePayload: ResolverTypeWrapper<Omit<UpdateFeaturePayload, 'feature'> & { feature: ResolversTypes['Feature'] }>;
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: ResolverTypeWrapper<Omit<UpdateIssuePayload, 'issue'> & { issue: ResolversTypes['Issue'] }>;
  UpdatePrInput: UpdatePrInput;
  UpdatePrPayload: ResolverTypeWrapper<Omit<UpdatePrPayload, 'pr'> & { pr: ResolversTypes['Pr'] }>;
  UpdateSpecInput: UpdateSpecInput;
  UpdateSpecPayload: ResolverTypeWrapper<Omit<UpdateSpecPayload, 'feature' | 'spec'> & { feature: ResolversTypes['Feature'], spec: ResolversTypes['Spec'] }>;
  Verdict: Verdict;
  Viewer: ResolverTypeWrapper<Viewer>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AddCommentInput: AddCommentInput;
  AddCommentPayload: Omit<AddCommentPayload, 'comment' | 'entity'> & { comment: ResolversParentTypes['Comment'], entity: ResolversParentTypes['Entity'] };
  AddSpecInput: AddSpecInput;
  AddSpecPayload: Omit<AddSpecPayload, 'feature' | 'spec'> & { feature: ResolversParentTypes['Feature'], spec: ResolversParentTypes['Spec'] };
  Approvals: Approvals;
  Boolean: Scalars['Boolean']['output'];
  CloseIssueInput: CloseIssueInput;
  CloseIssuePayload: Omit<CloseIssuePayload, 'issue'> & { issue: ResolversParentTypes['Issue'] };
  Comment: CommentParent;
  Commit: CommitParent;
  CommitInfo: CommitInfo;
  CreateFeatureInput: CreateFeatureInput;
  CreateFeaturePayload: Omit<CreateFeaturePayload, 'feature'> & { feature: ResolversParentTypes['Feature'] };
  Diagnostic: DiagnosticParent;
  DoctorReport: Omit<DoctorReport, 'diagnostics'> & { diagnostics: Array<ResolversParentTypes['Diagnostic']> };
  Entity: EntityParent;
  EntityFilter: EntityFilter;
  Feature: FeatureParent;
  Float: Scalars['Float']['output'];
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
  ReviewPolicy: ReviewPolicy;
  ReviewerState: ReviewerState;
  Revision: Revision;
  Spec: SpecParent;
  String: Scalars['String']['output'];
  UnlinkIssuePayload: Omit<UnlinkIssuePayload, 'child'> & { child: ResolversParentTypes['Issue'] };
  UpdateFeatureInput: UpdateFeatureInput;
  UpdateFeaturePayload: Omit<UpdateFeaturePayload, 'feature'> & { feature: ResolversParentTypes['Feature'] };
  UpdateIssueInput: UpdateIssueInput;
  UpdateIssuePayload: Omit<UpdateIssuePayload, 'issue'> & { issue: ResolversParentTypes['Issue'] };
  UpdatePrInput: UpdatePrInput;
  UpdatePrPayload: Omit<UpdatePrPayload, 'pr'> & { pr: ResolversParentTypes['Pr'] };
  UpdateSpecInput: UpdateSpecInput;
  UpdateSpecPayload: Omit<UpdateSpecPayload, 'feature' | 'spec'> & { feature: ResolversParentTypes['Feature'], spec: ResolversParentTypes['Spec'] };
  Viewer: Viewer;
};

export type AddCommentPayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['AddCommentPayload'] = ResolversParentTypes['AddCommentPayload']> = {
  comment?: Resolver<ResolversTypes['Comment'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  entity?: Resolver<ResolversTypes['Entity'], ParentType, ContextType>;
};

export type AddSpecPayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['AddSpecPayload'] = ResolversParentTypes['AddSpecPayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  feature?: Resolver<ResolversTypes['Feature'], ParentType, ContextType>;
  spec?: Resolver<ResolversTypes['Spec'], ParentType, ContextType>;
};

export type ApprovalsResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Approvals'] = ResolversParentTypes['Approvals']> = {
  given?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  required?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
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

export type CommitResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Commit'] = ResolversParentTypes['Commit']> = {
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sha?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  subject?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CommitInfoResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['CommitInfo'] = ResolversParentTypes['CommitInfo']> = {
  committed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  pushed?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  subject?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CreateFeaturePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['CreateFeaturePayload'] = ResolversParentTypes['CreateFeaturePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  feature?: Resolver<ResolversTypes['Feature'], ParentType, ContextType>;
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

export type FeatureResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Feature'] = ResolversParentTypes['Feature']> = {
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  baseSha?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  commits?: Resolver<Array<ResolversTypes['Commit']>, ParentType, ContextType, RequireFields<FeatureCommitsArgs, 'limit'>>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  issues?: Resolver<Array<ResolversTypes['Issue']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  prs?: Resolver<Array<ResolversTypes['Pr']>, ParentType, ContextType>;
  slug?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  specs?: Resolver<Array<ResolversTypes['Spec']>, ParentType, ContextType>;
  summary?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type IssueResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Issue'] = ResolversParentTypes['Issue']> = {
  archived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  assignees?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  baseSha?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  comments?: Resolver<Array<ResolversTypes['Comment']>, ParentType, ContextType>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  deadline?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  duplicateOf?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  features?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['Kind'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['LinkNode']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  rank?: Resolver<Maybe<ResolversTypes['Float']>, ParentType, ContextType>;
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
  addSpec?: Resolver<ResolversTypes['AddSpecPayload'], ParentType, ContextType, RequireFields<MutationAddSpecArgs, 'input'>>;
  closeIssue?: Resolver<ResolversTypes['CloseIssuePayload'], ParentType, ContextType, RequireFields<MutationCloseIssueArgs, 'input'>>;
  createFeature?: Resolver<ResolversTypes['CreateFeaturePayload'], ParentType, ContextType, RequireFields<MutationCreateFeatureArgs, 'input'>>;
  linkIssue?: Resolver<ResolversTypes['LinkIssuePayload'], ParentType, ContextType, RequireFields<MutationLinkIssueArgs, 'input'>>;
  openIssue?: Resolver<ResolversTypes['OpenIssuePayload'], ParentType, ContextType, RequireFields<MutationOpenIssueArgs, 'input'>>;
  reopenIssue?: Resolver<ResolversTypes['ReopenIssuePayload'], ParentType, ContextType, RequireFields<MutationReopenIssueArgs, 'ref'>>;
  unlinkIssue?: Resolver<ResolversTypes['UnlinkIssuePayload'], ParentType, ContextType, RequireFields<MutationUnlinkIssueArgs, 'ref'>>;
  updateFeature?: Resolver<ResolversTypes['UpdateFeaturePayload'], ParentType, ContextType, RequireFields<MutationUpdateFeatureArgs, 'input'>>;
  updateIssue?: Resolver<ResolversTypes['UpdateIssuePayload'], ParentType, ContextType, RequireFields<MutationUpdateIssueArgs, 'input'>>;
  updatePr?: Resolver<ResolversTypes['UpdatePrPayload'], ParentType, ContextType, RequireFields<MutationUpdatePrArgs, 'input'>>;
  updateSpec?: Resolver<ResolversTypes['UpdateSpecPayload'], ParentType, ContextType, RequireFields<MutationUpdateSpecArgs, 'input'>>;
};

export type OpenIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['OpenIssuePayload'] = ResolversParentTypes['OpenIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  parent?: Resolver<Maybe<ResolversTypes['Issue']>, ParentType, ContextType>;
};

export type PrResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Pr'] = ResolversParentTypes['Pr']> = {
  approvals?: Resolver<ResolversTypes['Approvals'], ParentType, ContextType>;
  archived?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  assignees?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  author?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  baseSha?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  comments?: Resolver<Array<ResolversTypes['Comment']>, ParentType, ContextType>;
  created?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  draft?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  features?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind?: Resolver<ResolversTypes['Kind'], ParentType, ContextType>;
  labels?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  merged?: Resolver<Maybe<ResolversTypes['MergedInfo']>, ParentType, ContextType>;
  milestone?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  refs?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  reviewDecision?: Resolver<ResolversTypes['ReviewDecision'], ParentType, ContextType>;
  reviewers?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  reviews?: Resolver<Array<ResolversTypes['ReviewerState']>, ParentType, ContextType>;
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
  feature?: Resolver<ResolversTypes['Feature'], ParentType, ContextType, RequireFields<QueryFeatureArgs, 'slug'>>;
  features?: Resolver<Array<ResolversTypes['Feature']>, ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType, RequireFields<QueryIssueArgs, 'ref'>>;
  issues?: Resolver<Array<ResolversTypes['Issue']>, ParentType, ContextType, Partial<QueryIssuesArgs>>;
  people?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  pr?: Resolver<ResolversTypes['Pr'], ParentType, ContextType, RequireFields<QueryPrArgs, 'ref'>>;
  prs?: Resolver<Array<ResolversTypes['Pr']>, ParentType, ContextType, RequireFields<QueryPrsArgs, 'allRefs'>>;
  reviewPolicy?: Resolver<ResolversTypes['ReviewPolicy'], ParentType, ContextType>;
  viewer?: Resolver<ResolversTypes['Viewer'], ParentType, ContextType>;
};

export type ReopenIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['ReopenIssuePayload'] = ResolversParentTypes['ReopenIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  destination?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
};

export type ReviewPolicyResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['ReviewPolicy'] = ResolversParentTypes['ReviewPolicy']> = {
  declared?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  minApprovals?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  problems?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  selfReview?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type ReviewerStateResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['ReviewerState'] = ResolversParentTypes['ReviewerState']> = {
  comment?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  person?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['ReviewState'], ParentType, ContextType>;
  volunteer?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type RevisionResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Revision'] = ResolversParentTypes['Revision']> = {
  base?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  head?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type SpecResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Spec'] = ResolversParentTypes['Spec']> = {
  baseSha?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  body?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fileName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type UnlinkIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UnlinkIssuePayload'] = ResolversParentTypes['UnlinkIssuePayload']> = {
  child?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  previousParentId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type UpdateFeaturePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UpdateFeaturePayload'] = ResolversParentTypes['UpdateFeaturePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  feature?: Resolver<ResolversTypes['Feature'], ParentType, ContextType>;
};

export type UpdateIssuePayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UpdateIssuePayload'] = ResolversParentTypes['UpdateIssuePayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  issue?: Resolver<ResolversTypes['Issue'], ParentType, ContextType>;
};

export type UpdatePrPayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UpdatePrPayload'] = ResolversParentTypes['UpdatePrPayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  pr?: Resolver<ResolversTypes['Pr'], ParentType, ContextType>;
};

export type UpdateSpecPayloadResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['UpdateSpecPayload'] = ResolversParentTypes['UpdateSpecPayload']> = {
  commit?: Resolver<ResolversTypes['CommitInfo'], ParentType, ContextType>;
  feature?: Resolver<ResolversTypes['Feature'], ParentType, ContextType>;
  spec?: Resolver<ResolversTypes['Spec'], ParentType, ContextType>;
};

export type ViewerResolvers<ContextType = GraphQLCtx, ParentType extends ResolversParentTypes['Viewer'] = ResolversParentTypes['Viewer']> = {
  email?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLCtx> = {
  AddCommentPayload?: AddCommentPayloadResolvers<ContextType>;
  AddSpecPayload?: AddSpecPayloadResolvers<ContextType>;
  Approvals?: ApprovalsResolvers<ContextType>;
  CloseIssuePayload?: CloseIssuePayloadResolvers<ContextType>;
  Comment?: CommentResolvers<ContextType>;
  Commit?: CommitResolvers<ContextType>;
  CommitInfo?: CommitInfoResolvers<ContextType>;
  CreateFeaturePayload?: CreateFeaturePayloadResolvers<ContextType>;
  Diagnostic?: DiagnosticResolvers<ContextType>;
  DoctorReport?: DoctorReportResolvers<ContextType>;
  Entity?: EntityResolvers<ContextType>;
  Feature?: FeatureResolvers<ContextType>;
  Issue?: IssueResolvers<ContextType>;
  LinkIssuePayload?: LinkIssuePayloadResolvers<ContextType>;
  LinkNode?: LinkNodeResolvers<ContextType>;
  MergedInfo?: MergedInfoResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  OpenIssuePayload?: OpenIssuePayloadResolvers<ContextType>;
  Pr?: PrResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ReopenIssuePayload?: ReopenIssuePayloadResolvers<ContextType>;
  ReviewPolicy?: ReviewPolicyResolvers<ContextType>;
  ReviewerState?: ReviewerStateResolvers<ContextType>;
  Revision?: RevisionResolvers<ContextType>;
  Spec?: SpecResolvers<ContextType>;
  UnlinkIssuePayload?: UnlinkIssuePayloadResolvers<ContextType>;
  UpdateFeaturePayload?: UpdateFeaturePayloadResolvers<ContextType>;
  UpdateIssuePayload?: UpdateIssuePayloadResolvers<ContextType>;
  UpdatePrPayload?: UpdatePrPayloadResolvers<ContextType>;
  UpdateSpecPayload?: UpdateSpecPayloadResolvers<ContextType>;
  Viewer?: ViewerResolvers<ContextType>;
};

