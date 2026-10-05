/**
 * The canonical JSON projection of a poll — spec 04 §4.2.
 *
 * Identity first, then the frontmatter as the file spells it, then what is
 * derived: the order every other `--json` projection uses. The tallies are
 * always here, whatever `results` says: that key is about what a front end
 * shows a person (§6.4), and a reader of JSON is a program.
 */

import { type BallotReading, ballotOf, type QuestionTally, voterState } from "./ballot.ts";
import type { Answers, PollQuestion } from "./files.ts";
import type { PollRecord, VoteRecord } from "./tree.ts";

/** The keys of `poll.md` this projection writes itself. */
const KNOWN_KEYS = [
  "title",
  "author",
  "created",
  "results",
  "deadline",
  "questions",
  "closed",
  "closed-by",
  "decision",
  "decision-note",
];

/** Answers as JSON: an object by question ID. */
export function answersJson(answers: Answers | null): Record<string, unknown> | null {
  if (answers === null) return null;
  return Object.fromEntries(
    [...answers].map(([qid, answer]) => [qid, { picks: [...answer.picks], other: answer.other }]),
  );
}

function questionJson(question: PollQuestion): Record<string, unknown> {
  return {
    id: question.id,
    text: question.text,
    multi: question.multi,
    other: question.other,
    options: question.options.map((option) => ({ ...option })),
  };
}

function tallyJson(entry: QuestionTally): Record<string, unknown> {
  return {
    question: entry.question,
    answered: entry.answered,
    tied: entry.tied,
    leaders: [...entry.leaders],
    options: entry.options.map((option) => ({
      id: option.option,
      count: option.count,
      voters: [...option.voters],
    })),
    others: entry.others.map((other) => ({ ...other })),
  };
}

/** One vote: what it says and what became of it — `invalid` for one with faults. */
export function voteJson(
  navDir: string,
  vote: VoteRecord,
  reading: BallotReading<VoteRecord> | undefined,
): Record<string, unknown> {
  return {
    id: vote.id,
    path: `${navDir}/${vote.path}`,
    author: vote.author,
    cast: vote.cast,
    fingerprint: vote.fingerprint,
    state: reading?.state ?? "invalid",
    answers: answersJson(vote.answers),
    note: vote.note,
    ...(vote.problems.length === 0
      ? {}
      : { problems: vote.problems.map((problem) => problem.message) }),
  };
}

/** A poll in brief, as a listing or an issue's `show` has it. */
export function pollSummaryJson(
  navDir: string,
  poll: PollRecord,
  me: string | null,
): Record<string, unknown> {
  return {
    id: poll.id,
    issue: poll.issue.id,
    path: `${navDir}/${poll.dirPath}`,
    title: poll.title,
    status: poll.status,
    "closed-by-issue": poll.closedByIssue,
    deadline: poll.deadline,
    voters: poll.voters,
    ...(me === null ? {} : { me: voterState(poll.ballots, me) }),
  };
}

/**
 * A whole poll. `me` is the address of the person asking, when known: their
 * ballot and where they stand come with it.
 */
export function pollJson(
  navDir: string,
  poll: PollRecord,
  me: string | null,
): Record<string, unknown> {
  const unknown = Object.fromEntries(
    Object.entries(poll.parsed.fm).filter(
      ([key]) => !KNOWN_KEYS.includes(key) && !["id", "issue", "path", "file"].includes(key),
    ),
  );
  const mine = me === null ? undefined : ballotOf(poll.ballots, me);
  const readingOf = (vote: VoteRecord) => poll.ballots.find((reading) => reading.vote === vote);
  return {
    id: poll.id,
    issue: poll.issue.id,
    path: `${navDir}/${poll.dirPath}`,
    file: `${navDir}/${poll.filePath}`,
    title: poll.title,
    author: poll.author,
    created: poll.created,
    results: poll.results,
    deadline: poll.deadline,
    questions: poll.questions.map(questionJson),
    closed: poll.closed,
    "closed-by": poll.closedBy,
    decision: answersJson(poll.decision),
    "decision-note": poll.decisionNote,
    ...unknown,
    preamble: poll.preamble,
    status: poll.status,
    "closed-by-issue": poll.closedByIssue,
    fingerprint: poll.fingerprint,
    voters: poll.voters,
    tallies: poll.tallies.map(tallyJson),
    outcome: answersJson(poll.outcome),
    proposed: answersJson(poll.proposed),
    ballots: poll.votes.map((vote) => voteJson(navDir, vote, readingOf(vote))),
    ...(me === null
      ? {}
      : {
          me: {
            voter: me,
            state: voterState(poll.ballots, me),
            ballot: mine === undefined ? null : voteJson(navDir, mine.vote, mine),
          },
        }),
  };
}
