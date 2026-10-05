/**
 * What the votes say — `doc/spec.md` §6.
 *
 * Pure functions over a poll's questions and its vote files: which ballot is
 * each voter's, which of those count, what they add up to, and what the poll
 * comes to. Nothing here is ever stored: every front end derives the same
 * reading from the same files.
 */

import {
  type Answer,
  type Answers,
  answerFaults,
  type PollQuestion,
  runningCore,
} from "./files.ts";

/** What became of a vote (§6.1). */
export type BallotState = "counted" | "withdrawn" | "revoked" | "superseded" | "late";

/** Where a person stands on a poll: their ballot's state, or `none`. */
export type VoterState = "none" | "counted" | "withdrawn" | "revoked";

/** The parts of a vote the derivation reads. */
export interface CastVote {
  id: string;
  fileName: string;
  /** When it was cast, from its file name. */
  date: Date;
  author: string;
  fingerprint: string;
  answers: Answers;
  /** The voter's note, in Markdown; "" for none. */
  note: string;
}

export interface BallotReading<V extends CastVote = CastVote> {
  vote: V;
  state: BallotState;
}

/** One option's count. */
export interface OptionTally {
  option: string;
  count: number;
  /** Who picked it, as their votes name them. */
  voters: string[];
}

/** One question's tally over the ballots that count (§6.3). */
export interface QuestionTally {
  question: string;
  /** How many counting ballots answer it. */
  answered: number;
  options: OptionTally[];
  /** Every write-in, in its writer's words. */
  others: { text: string; voter: string }[];
  /** The options with the most picks, when that is at least one. */
  leaders: string[];
  /** A single-choice question with more than one leader. */
  tied: boolean;
}

/** The identity a vote is counted under: the address, lowercased (02 §2.4). */
export function voterKey(person: string): string {
  return (runningCore().parsePerson(person)?.email ?? person).trim().toLowerCase();
}

/**
 * Every valid vote's state (§6.1), in file-name order.
 *
 * `votes` are the poll's valid votes in any order; `closed` is the instant the
 * poll was closed at, or null — a poll its issue closed has none, so no vote
 * on it is late.
 */
export function readBallots<V extends CastVote>(
  votes: readonly V[],
  current: string,
  closed: Date | null,
): BallotReading<V>[] {
  const ordered = [...votes].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );
  const readings = ordered.map(
    (vote): BallotReading<V> => ({
      vote,
      state: closed !== null && vote.date.getTime() > closed.getTime() ? "late" : "counted",
    }),
  );
  // The last vote each voter cast in time is their ballot; walk backwards so
  // the first one seen is it.
  const seen = new Set<string>();
  for (let index = readings.length - 1; index >= 0; index--) {
    const reading = readings[index] as BallotReading<V>;
    if (reading.state === "late") continue;
    const key = voterKey(reading.vote.author);
    if (seen.has(key)) {
      reading.state = "superseded";
      continue;
    }
    seen.add(key);
    if (reading.vote.answers.size === 0) reading.state = "withdrawn";
    else if (reading.vote.fingerprint !== current) reading.state = "revoked";
  }
  return readings;
}

/** The ballots that count, in file-name order. */
export function counted<V extends CastVote>(readings: readonly BallotReading<V>[]): V[] {
  return readings.filter((reading) => reading.state === "counted").map((reading) => reading.vote);
}

/** Each question's tally over the ballots that count (§6.3). */
export function tally(
  questions: readonly PollQuestion[],
  ballots: readonly CastVote[],
): QuestionTally[] {
  return questions.map((question) => {
    const options = question.options.map(
      (option): OptionTally => ({ option: option.id, count: 0, voters: [] }),
    );
    const others: { text: string; voter: string }[] = [];
    let answered = 0;
    for (const ballot of ballots) {
      const answer = ballot.answers.get(question.id);
      if (answer === undefined) continue;
      answered++;
      for (const pick of answer.picks) {
        const entry = options.find((option) => option.option === pick);
        if (entry === undefined) continue;
        entry.count++;
        entry.voters.push(ballot.author);
      }
      if (answer.other !== null) others.push({ text: answer.other, voter: ballot.author });
    }
    const top = Math.max(0, ...options.map((option) => option.count));
    const leaders = top === 0 ? [] : options.filter((o) => o.count === top).map((o) => o.option);
    return {
      question: question.id,
      answered,
      options,
      others,
      leaders,
      tied: !question.multi && leaders.length > 1,
    };
  });
}

/**
 * The decision a poll comes to by its tallies (§6.3): a single-choice
 * question's one leader, a multiple-choice question's every leader, and
 * nothing for a tie or a question nobody answered.
 */
export function proposedDecision(
  questions: readonly PollQuestion[],
  tallies: readonly QuestionTally[],
): Answers {
  const decision: Answers = new Map();
  for (const question of questions) {
    const entry = tallies.find((candidate) => candidate.question === question.id);
    if (entry === undefined || entry.leaders.length === 0 || entry.tied) continue;
    decision.set(question.id, { picks: [...entry.leaders], other: null });
  }
  return decision;
}

/** Where `person` stands on a poll whose ballots these are. */
export function voterState(readings: readonly BallotReading[], person: string): VoterState {
  return ballotOf(readings, person)?.state ?? "none";
}

/**
 * `person`'s ballot — their latest word on the poll, counting or not — or
 * undefined when they have none. Late votes and superseded ones are not it.
 */
export function ballotOf<V extends CastVote>(
  readings: readonly BallotReading<V>[],
  person: string,
): (BallotReading<V> & { state: VoterState }) | undefined {
  const key = voterKey(person);
  return readings.find(
    (reading): reading is BallotReading<V> & { state: VoterState } =>
      reading.state !== "superseded" &&
      reading.state !== "late" &&
      voterKey(reading.vote.author) === key,
  );
}

/**
 * The answers a new ballot starts from: `person`'s last one, less whatever no
 * longer fits the questions — a removed option, a question that became
 * single-choice. A withdrawal starts from nothing.
 */
export function prefill(
  questions: readonly PollQuestion[],
  readings: readonly BallotReading[],
  person: string,
): { answers: Answers; note: string | null } {
  const ballot = ballotOf(readings, person);
  const answers: Answers = new Map();
  if (ballot === undefined || ballot.state === "withdrawn") return { answers, note: null };
  for (const question of questions) {
    const was = ballot.vote.answers.get(question.id);
    if (was === undefined) continue;
    const answer: Answer = {
      picks: was.picks.filter((pick) => question.options.some((option) => option.id === pick)),
      other: question.other ? was.other : null,
    };
    if (answerFaults(question, answer).length === 0) answers.set(question.id, answer);
  }
  return { answers, note: ballot.vote.note.trim() === "" ? null : ballot.vote.note };
}

/** Whether two answers say the same thing. */
export function sameAnswer(a: Answer | undefined, b: Answer | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.other === b.other &&
    a.picks.length === b.picks.length &&
    a.picks.every((pick) => b.picks.includes(pick))
  );
}
