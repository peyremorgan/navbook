/**
 * A feature's history, as one list.
 *
 * The API hands back three lists — issues, pull requests and commits — rather
 * than one, because they are three different things and the server has no
 * business deciding how a reader wants them mixed. Mixing them is this file.
 *
 * What orders them is worth naming. An entity is placed by its `created`
 * frontmatter and a commit by its author date, and spec 02 §2.4 is explicit
 * that frontmatter timestamps are display data while git history governs. So
 * the two are not equally trustworthy, and a tie between them is broken in the
 * commit's favour: the commit that filed an issue is the record of the filing,
 * and it reads better after the issue it created than before it.
 */

interface Placed {
  /** When it happened, as the source of it records that. */
  at: string;
  /** What identifies it: unique across a timeline, and stable between renders. */
  key: string;
}

export interface TimelineEntity extends Placed {
  kind: "issue" | "pr";
  /** The entity as its row component wants it. */
  entity: { id: string; created: string };
}

export interface TimelineCommit extends Placed {
  kind: "commit";
  commit: { sha: string; subject: string; author: string; date: string };
}

export type TimelineEvent = TimelineEntity | TimelineCommit;

export interface TimelineInput {
  issues?: readonly { id: string; created: string }[];
  prs?: readonly { id: string; created: string }[];
  commits?: readonly { sha: string; subject: string; author: string; date: string }[];
}

/** Rank within one instant: a commit before the entity it is dated with. */
const RANK = { commit: 0, issue: 1, pr: 2 } as const;

/** One newest-first list of everything that has happened to a feature. */
export function mergeTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...(input.issues ?? []).map(
      (entity): TimelineEvent => ({ kind: "issue", entity, at: entity.created, key: entity.id }),
    ),
    ...(input.prs ?? []).map(
      (entity): TimelineEvent => ({ kind: "pr", entity, at: entity.created, key: entity.id }),
    ),
    ...(input.commits ?? []).map(
      (commit): TimelineEvent => ({ kind: "commit", commit, at: commit.date, key: commit.sha }),
    ),
  ];

  return events.sort((a, b) => {
    // Instants, not strings: the timestamps come from two sources and need not
    // agree on offset or precision, and `2026-09-01T10:00:00+02:00` sorts
    // nowhere near where it belongs when compared as text.
    const difference = instant(b.at) - instant(a.at);
    if (difference !== 0) return difference;
    if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind];
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** A timestamp as a number; one that cannot be read sorts oldest. */
function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
