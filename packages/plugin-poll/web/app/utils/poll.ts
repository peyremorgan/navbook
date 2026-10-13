/**
 * The pure parts of the layer: what a row's `ext` says, when the results are
 * shown, how a ballot being filled in relates to what the API takes, what
 * closing proposes, and whether an edit would revoke the ballots cast.
 *
 * Free of Vue and Nuxt, so `node --test` checks them, as the other layers'
 * utilities are checked.
 */

import type {
  PollAnswerInput,
  PollCardFragment,
  PollQuestionInput,
} from "../../src/generated/gql/graphql.ts";

type Question = PollCardFragment["questions"][number];
type AnswerLike = { question: string; picks: readonly string[]; other?: string | null };

/* ------------------------------------------------------------------ ext */

/** One poll as an issue's `ext.poll` lists it: the same for every viewer. */
export interface PollExt {
  id: string;
  title: string;
  created: string;
  status: "open" | "closed";
  voters: number;
}

/** This plugin's slice of an entity's `ext`; an empty list when it has none. */
export function readPollExt(ext: Record<string, unknown> | null | undefined): PollExt[] {
  const mine = (ext as { poll?: { polls?: unknown } } | null | undefined)?.poll?.polls;
  if (!Array.isArray(mine)) return [];
  return mine.filter(
    (poll): poll is PollExt =>
      typeof poll === "object" &&
      poll !== null &&
      typeof (poll as PollExt).id === "string" &&
      typeof (poll as PollExt).created === "string",
  );
}

/* -------------------------------------------------------------- results */

/**
 * Whether the tallies are shown (`doc/spec.md` §6.4): always for a poll that
 * says so, or a closed one; else once the person looking has a ballot that
 * counts, or has asked to see them.
 */
export function resultsShown(
  poll: Pick<PollCardFragment, "results" | "status" | "myState">,
  asked: boolean,
): boolean {
  return (
    asked || poll.results === "VISIBLE" || poll.status === "CLOSED" || poll.myState === "COUNTED"
  );
}

/** A count as a share of the ballots that answered, for a bar; 0 when nobody did. */
export function share(count: number, answered: number): number {
  return answered === 0 ? 0 : Math.round((count / answered) * 100);
}

/* --------------------------------------------------------------- ballot */

/** One question's answer as a form holds it: the picks, and the write-in as typed. */
export interface AnswerDraft {
  picks: string[];
  other: string;
}

/** A ballot being filled in, by question ID. */
export type BallotDraft = Record<string, AnswerDraft>;

/** A form for these questions, filled in from `answers` where they still fit. */
export function draftFrom(
  questions: readonly Question[],
  answers: readonly AnswerLike[] = [],
): BallotDraft {
  const draft: BallotDraft = {};
  for (const question of questions) {
    const given = answers.find((answer) => answer.question === question.id);
    const picks = (given?.picks ?? []).filter((pick) =>
      question.options.some((option) => option.id === pick),
    );
    draft[question.id] = {
      picks: question.multi ? picks : picks.slice(0, 1),
      other: question.other ? (given?.other ?? "") : "",
    };
  }
  return draft;
}

/**
 * A form carried onto questions that changed under it: whatever was in it,
 * kept where it still fits — an option that is gone drops out, a write-in
 * stays only where one is still accepted.
 */
export function carryOver(questions: readonly Question[], draft: BallotDraft): BallotDraft {
  return draftFrom(
    questions,
    Object.entries(draft).map(([question, answer]) => ({ question, ...answer })),
  );
}

/**
 * The answers to send: one per question with something in it, write-ins
 * trimmed. A question left empty is skipped; none at all withdraws.
 */
export function draftToInput(
  questions: readonly Question[],
  draft: BallotDraft,
): PollAnswerInput[] {
  const out: PollAnswerInput[] = [];
  for (const question of questions) {
    const answer = draft[question.id];
    if (answer === undefined) continue;
    const other = question.other ? answer.other.trim() : "";
    if (answer.picks.length === 0 && other === "") continue;
    out.push({
      question: question.id,
      picks: [...answer.picks],
      other: other === "" ? null : other,
    });
  }
  return out;
}

/**
 * What the API would refuse in a ballot, by question ID — said beside the
 * question rather than after a round trip. Mirrors `doc/spec.md` §4.1.
 */
export function ballotFaults(
  questions: readonly Question[],
  draft: BallotDraft,
): Record<string, string> {
  const faults: Record<string, string> = {};
  for (const question of questions) {
    const answer = draft[question.id];
    if (answer === undefined) continue;
    const other = answer.other.trim();
    if (/[\r\n]/.test(answer.other)) faults[question.id] = "Write your answer on one line.";
    else if (!question.multi && answer.picks.length + (other === "" ? 0 : 1) > 1)
      faults[question.id] = "One answer: an option, or one in your own words.";
  }
  return faults;
}

/**
 * Markdown as the server keeps a note or a preamble (`bodyText` in the core):
 * without the blank lines before it or trailing whitespace, and with the
 * first line's indentation kept. What a form compares with what it was given.
 */
export function bodyText(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/** Whether a draft answers the same as the ballot the person already cast. */
export function sameBallot(
  questions: readonly Question[],
  draft: BallotDraft,
  ballot: readonly AnswerLike[] | null | undefined,
): boolean {
  const sent = draftToInput(questions, draft);
  const cast = ballot ?? [];
  if (sent.length !== cast.length) return false;
  return sent.every((answer) => {
    const was = cast.find((entry) => entry.question === answer.question);
    const picks = answer.picks ?? [];
    return (
      was !== undefined &&
      (was.other ?? null) === (answer.other ?? null) &&
      was.picks.length === picks.length &&
      was.picks.every((pick) => picks.includes(pick))
    );
  });
}

/** An answer in words: the options' labels, and the write-in quoted. */
export function describeAnswer(question: Question | undefined, answer: AnswerLike): string {
  const labels = answer.picks.map(
    (pick) => question?.options.find((option) => option.id === pick)?.label ?? pick,
  );
  if (answer.other) labels.push(`“${answer.other}”`);
  return labels.join(", ");
}

/* ---------------------------------------------------------------- close */

/** What the closer decides for one question: an answer, or undecided. */
export type Decision = AnswerDraft | null;

/**
 * Where the close dialog starts: what the votes came to, question by question,
 * and nothing for a tie — which only the closer can break, so it must be
 * chosen before closing.
 */
export function closeDefaults(poll: Pick<PollCardFragment, "questions" | "proposed" | "tallies">): {
  decisions: Record<string, Decision>;
  mustChoose: string[];
} {
  const decisions: Record<string, Decision> = {};
  const mustChoose: string[] = [];
  for (const question of poll.questions) {
    const proposed = poll.proposed.find((answer) => answer.question === question.id);
    decisions[question.id] = proposed
      ? { picks: [...proposed.picks], other: proposed.other ?? "" }
      : null;
    if (poll.tallies.find((tally) => tally.question === question.id)?.tied)
      mustChoose.push(question.id);
  }
  return { decisions, mustChoose };
}

/** The decisions to send: every question, an undecided one as no picks and no write-in. */
export function decisionsToInput(
  questions: readonly Question[],
  decisions: Record<string, Decision>,
): PollAnswerInput[] {
  return questions.map((question) => {
    const decision = decisions[question.id] ?? null;
    const other = decision?.other.trim() ?? "";
    return {
      question: question.id,
      picks: decision === null ? [] : [...decision.picks],
      other: other === "" ? null : other,
    };
  });
}

/* --------------------------------------------------------------- editor */

/** A question as the editor holds it; IDs empty until somebody or the server names them. */
export interface QuestionDraft {
  key: number;
  id: string;
  text: string;
  multi: boolean;
  other: boolean;
  options: { key: number; id: string; label: string; description: string }[];
}

let nextKey = 0;
/** A key for a row of the editor, stable across reorders. */
export function editorKey(): number {
  return nextKey++;
}

/** The editor's rows for a poll's questions, or one empty question for a new poll. */
export function questionsToDraft(questions: readonly Question[]): QuestionDraft[] {
  if (questions.length === 0) return [emptyQuestion()];
  return questions.map((question) => ({
    key: editorKey(),
    id: question.id,
    text: question.text,
    multi: question.multi,
    other: question.other,
    options: question.options.map((option) => ({
      key: editorKey(),
      id: option.id,
      label: option.label,
      description: option.description ?? "",
    })),
  }));
}

/** A question with two empty options: the least a question can offer. */
export function emptyQuestion(): QuestionDraft {
  return {
    key: editorKey(),
    id: "",
    text: "",
    multi: false,
    other: false,
    options: [emptyOption(), emptyOption()],
  };
}

export function emptyOption(): QuestionDraft["options"][number] {
  return { key: editorKey(), id: "", label: "", description: "" };
}

/** The questions as the API takes them: trimmed, IDs left out where none was given. */
export function draftToQuestions(draft: readonly QuestionDraft[]): PollQuestionInput[] {
  return draft.map((question) => ({
    id: question.id.trim() || null,
    text: question.text.trim(),
    multi: question.multi,
    other: question.other,
    options: question.options.map((option) => ({
      id: option.id.trim() || null,
      label: option.label.trim(),
      description: option.description.trim() === "" ? null : option.description,
    })),
  }));
}

/**
 * What a poll's editor would refuse before sending: the API's own rules for a
 * question, said beside it. Null when there is nothing to say.
 */
export function questionsFault(draft: readonly QuestionDraft[]): string | null {
  if (draft.length === 0) return "A poll asks at least one question.";
  for (const [q, question] of draft.entries()) {
    const at = `Question ${q + 1}`;
    if (question.text.trim() === "") return `${at} needs its text.`;
    if (question.options.some((option) => option.label.trim() === ""))
      return `${at} has an option with no label.`;
    if (question.options.length === 0) return `${at} needs at least one option.`;
    if (question.options.length + (question.other ? 1 : 0) < 2)
      return `${at} needs a second option, or to accept answers in other words.`;
  }
  return null;
}

/**
 * Whether saving these questions would revoke the ballots cast (`doc/spec.md`
 * §5): any change to them at all — wording included. A question or option
 * still without an ID is new, which is a change.
 */
export function wouldRevoke(
  questions: readonly Question[],
  draft: readonly QuestionDraft[],
): boolean {
  const normal = (list: readonly PollQuestionInput[]) =>
    JSON.stringify(
      list.map((question) => [
        question.id ?? null,
        question.text,
        question.multi === true,
        question.other === true,
        question.options.map((option) => [
          option.id ?? null,
          option.label,
          (option.description ?? "").replace(/\s+$/, "") || null,
        ]),
      ]),
    );
  // Trimmed as the editor's own are, so a text a hand-written file surrounds
  // with spaces is not a change nobody made — sending the questions then
  // would trim them, and revoke every ballot over a title edit.
  const before = questions.map((question) => ({
    id: question.id,
    text: question.text.trim(),
    multi: question.multi,
    other: question.other,
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label.trim(),
      description: option.description ?? null,
    })),
  }));
  return normal(before) !== normal(draftToQuestions(draft));
}
