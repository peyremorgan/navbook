/**
 * Comment files — spec 02 §2.6. One file per comment, named with a colon-free
 * UTC timestamp plus the comment's own ID, so listings sort chronologically and
 * concurrent comments can never collide.
 */

import { isId } from "./id.ts";
import { fromCompactStamp, toCompactStamp } from "./time.ts";

export const COMMENT_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{6}Z)-([a-z][a-z0-9]{7})\.md$/;

export interface CommentName {
  stamp: string;
  date: Date;
  id: string;
}

/** Build the filename for a comment created at `date` with identifier `id`. */
export function commentFileName(date: Date, id: string): string {
  return `${toCompactStamp(date)}-${id}.md`;
}

/** Parse a comment filename, or return null when it violates the grammar. */
export function parseCommentFileName(name: string): CommentName | null {
  const match = COMMENT_NAME_PATTERN.exec(name);
  if (!match) return null;
  const stamp = match[1] as string;
  const id = match[2] as string;
  if (!isId(id)) return null;
  const date = fromCompactStamp(stamp);
  if (!date) return null;
  return { stamp, date, id };
}

export interface ThreadItem<T> {
  comment: T;
  depth: number;
}

/**
 * Order comments for display: chronologically by filename, with replies placed
 * directly under the comment they answer and indented by one level.
 *
 * Replies to unknown comments, and reply cycles, degrade to top level rather
 * than disappearing.
 */
export function threadOrder<T extends { id: string; replyTo?: string; fileName: string }>(
  comments: readonly T[],
): ThreadItem<T>[] {
  const sorted = [...comments].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const comment of sorted) {
    const parent = comment.replyTo ? byId.get(comment.replyTo) : undefined;
    if (!parent || parent.id === comment.id || createsCycle(comment, byId)) {
      roots.push(comment);
      continue;
    }
    const bucket = children.get(parent.id);
    if (bucket) bucket.push(comment);
    else children.set(parent.id, [comment]);
  }

  const out: ThreadItem<T>[] = [];
  // Guard on identity, not id: duplicate ids are a doctor error (D3), and
  // until they are fixed the thread must still show each file exactly once.
  const emitted = new Set<T>();
  const walk = (comment: T, depth: number): void => {
    if (emitted.has(comment)) return;
    emitted.add(comment);
    out.push({ comment, depth });
    for (const child of children.get(comment.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const comment of sorted) walk(comment, 0);
  return out;
}

function createsCycle<T extends { id: string; replyTo?: string }>(
  start: T,
  byId: ReadonlyMap<string, T>,
): boolean {
  const seen = new Set<string>([start.id]);
  let current = start.replyTo ? byId.get(start.replyTo) : undefined;
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.replyTo ? byId.get(current.replyTo) : undefined;
  }
  return false;
}
