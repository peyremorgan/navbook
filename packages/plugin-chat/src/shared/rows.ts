/**
 * What the model is shown of a record: the same shape from every front end.
 *
 * The CLI reads records out of the tree and the server out of its own schema,
 * but the model should not be able to tell which it is talking to — a listing
 * that read `assignees` in one place and `assignee` in the other would be a
 * difference it could only get wrong. So both executors map into these.
 */

import { BODY_LIMIT, COMMENT_LIMIT, COMMENTS_SHOWN, truncate } from "./tools.ts";

export interface IssueRow {
  id: string;
  title: string;
  status: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  deadline: string | null;
  rank: number | null;
  parent: string | null;
  author: string;
  created: string;
}

export interface PrRow {
  id: string;
  title: string;
  status: string;
  source: string | null;
  target: string;
  draft: boolean;
  reviewers: string[];
  /** `approved`, `changes-requested` or `pending`. */
  review: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  author: string;
  created: string;
}

export interface CommentView {
  id: string;
  author: string;
  created: string;
  verdict?: string;
  reply_to?: string;
  body: string;
}

/** A listing cut to `limit`, saying how many there were in all. */
export interface Page<T> {
  count: number;
  shown: number;
  rows: T[];
  more?: string;
}

export function page<T>(rows: readonly T[], limit: number): Page<T> {
  const shown = rows.slice(0, limit);
  return {
    count: rows.length,
    shown: shown.length,
    rows: shown,
    ...(rows.length > shown.length
      ? { more: `${rows.length - shown.length} more matched; narrow the query or raise the limit` }
      : {}),
  };
}

/**
 * Pull requests from the working tree and from the branch scan, as one list.
 *
 * The working tree holds every status, but only the pull requests this branch
 * carries; the scan finds open ones on every branch. Together they answer
 * "which pull requests…" the way a person means it. The working tree's copy
 * wins where both have one, and the newest come first.
 */
export function mergePrRows(here: readonly PrRow[], scanned: readonly PrRow[]): PrRow[] {
  const byId = new Map<string, PrRow>();
  for (const row of scanned) byId.set(row.id, row);
  for (const row of here) byId.set(row.id, row);
  return [...byId.values()].sort(
    (a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id),
  );
}

/** A record's body and its latest comments, cut to what the model needs. */
export function detail<T extends object>(
  row: T,
  body: string,
  comments: readonly CommentView[],
): T & { body: string; comments: CommentView[]; comment_count: number } {
  const latest = comments.slice(-COMMENTS_SHOWN).map((comment) => ({
    ...comment,
    body: truncate(comment.body.trim(), COMMENT_LIMIT),
  }));
  return {
    ...row,
    body: truncate(body.trim(), BODY_LIMIT),
    comments: latest,
    comment_count: comments.length,
  };
}

/** "1 issue", "3 pull requests". */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
