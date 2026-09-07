/**
 * The review state of a pull request — spec 02 §2.7, "Review requests".
 *
 * Nothing here is stored. `reviewer:` on `pr.md` records who was *asked*, and
 * the reviews themselves record who answered; everything below is the second
 * read against the first, computed on demand by whichever front end needs it.
 * That is the whole point of the design: a reviewer's commit adds a file and
 * never edits the one the author is working in (spec 03 §3.3).
 *
 * Everything is read against the pull request's **latest** revision, so
 * appending one returns every reviewer to `pending` — the rule that a verdict
 * binds to one revision, seen from the request's side.
 */

import { isOpinionated, readReviewers, readRevisions } from "./files.ts";
import { parsePerson, personMatches } from "./person.ts";
import type { CommentRecord, EntityRecord } from "./tree.ts";

/** What one person has said about the revision in question. */
export type ReviewState = "approve" | "request-changes" | "commented" | "pending";

/** What the reviews add up to for the pull request as a whole. */
export type ReviewDecision = "approved" | "changes-requested" | "pending";

export const REVIEW_DECISIONS = ["pending", "approved", "changes-requested"] as const;

export interface ReviewerState {
  /** The person as a file spells them: the `reviewer:` entry, or a review's author. */
  person: string;
  state: ReviewState;
  /** True when nobody asked: they reviewed anyway, and it counts all the same. */
  volunteer: boolean;
  /** The review the state was read from, when there is one. */
  commentId?: string;
}

export interface ReviewSummary {
  /** The revision every state is read against; absent when none is recorded. */
  revision?: string;
  /** Everyone asked, plus everyone who reviewed. Never the pull request's author. */
  reviewers: ReviewerState[];
  decision: ReviewDecision;
}

/** The identity two spellings of one address share, for grouping and comparison. */
function identity(person: string): string {
  return (parsePerson(person)?.email ?? person).trim().toLowerCase();
}

/** The `head` of the latest recorded revision — the last, since the list is append-only (§2.7). */
export function latestRevision(fm: Record<string, unknown>): string | undefined {
  const revisions = readRevisions(fm);
  return revisions[revisions.length - 1]?.head;
}

/** The verdict a comment binds to `revision`, or undefined when it binds to nothing. */
function verdictOn(comment: CommentRecord, revision: string): string | undefined {
  const { verdict, revision: bound } = comment.parsed.fm;
  if (typeof verdict !== "string" || typeof bound !== "string") return undefined;
  return bound.toLowerCase() === revision.toLowerCase() ? verdict : undefined;
}

/**
 * Read the review state of a pull request.
 *
 * The people counted are those `reviewer:` names and anyone else who bound a
 * verdict to the latest revision — a review nobody asked for is still a review
 * — minus the pull request's own author, whose verdicts are recorded like any
 * other comment and count for nothing.
 */
export function reviewSummary(entity: EntityRecord): ReviewSummary {
  const revision = latestRevision(entity.fm);
  const author = typeof entity.fm.author === "string" ? identity(entity.fm.author) : "";
  const theirOwn = (person: string): boolean => author !== "" && identity(person) === author;

  // Insertion order is the order they are reported in: everyone asked, as the
  // file asks them, then whoever else turned up, as they reviewed.
  const states = new Map<string, ReviewerState>();
  for (const person of readReviewers(entity.fm)) {
    const key = identity(person);
    if (theirOwn(person) || states.has(key)) continue;
    states.set(key, { person, state: "pending", volunteer: false });
  }

  if (revision !== undefined && entity.kind === "pr") {
    // Comments come in filename order, which is chronological (§2.6), so the
    // last verdict a person bound to this revision is the last one seen.
    for (const comment of entity.comments) {
      const verdict = verdictOn(comment, revision);
      if (verdict === undefined || theirOwn(comment.author)) continue;
      const key = identity(comment.author);
      const existing = states.get(key);
      const state = nextState(existing?.state, verdict);
      if (state === undefined) continue;
      states.set(key, {
        person: existing?.person ?? comment.author,
        state,
        volunteer: existing === undefined || existing.volunteer,
        commentId: comment.id,
      });
    }
  }

  const reviewers = [...states.values()];
  return {
    ...(revision === undefined ? {} : { revision }),
    reviewers,
    decision: decide(reviewers),
  };
}

/**
 * The state a verdict moves a person to, or undefined to leave them as they are.
 *
 * A review that judges nothing never overwrites one that did. Saying "I read
 * it" after approving is not a retraction — it is the same person saying less
 * than they already said, and the louder statement stands (§2.6).
 */
function nextState(current: ReviewState | undefined, verdict: string): ReviewState | undefined {
  if (isOpinionated(verdict)) return verdict;
  if (verdict !== "comment") return undefined;
  return current === "approve" || current === "request-changes" ? undefined : "commented";
}

/**
 * What the states add up to.
 *
 * A block outranks an approval, and an approval outranks silence. Nobody's
 * silence withholds a decision: Navbook records reviews and gates nothing
 * (spec 01 §1.7), so "one person has not looked yet" shows in their own row
 * rather than folding into a verdict on the whole pull request.
 */
export function decide(reviewers: readonly ReviewerState[]): ReviewDecision {
  if (reviewers.some((entry) => entry.state === "request-changes")) return "changes-requested";
  if (reviewers.some((entry) => entry.state === "approve")) return "approved";
  return "pending";
}

/**
 * True when somebody matching `queryValue` is asked to review and has not yet.
 *
 * The address is matched as `assignee:` and `reviewer:` match theirs (spec 04),
 * so a bare domain fragment finds a whole team's outstanding reviews.
 */
export function isAwaiting(summary: ReviewSummary, queryValue: string): boolean {
  return summary.reviewers.some(
    (entry) =>
      !entry.volunteer && entry.state === "pending" && personMatches(queryValue, entry.person),
  );
}
