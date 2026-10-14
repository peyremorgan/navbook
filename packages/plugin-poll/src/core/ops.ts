/**
 * What can be done to polls — `doc/spec.md` §3, §4 and §9.
 *
 * Every change here is a `Plan` handed to the host's `runPlan`, which is how a
 * plugin's writes get `--commit`, the staged-changes guard and the commit
 * message conventions without implementing any of them. The CLI and the API
 * call the same functions: what differs between them is how the input was
 * gathered, never what is written.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import type * as NavbookCore from "@navbook/core";
import type { EntityRecord, ParsedFile, Plan, Repo, RunPlanResult, WsCtx } from "@navbook/core";
import {
  ballotOf,
  counted,
  proposedDecision,
  type QuestionTally,
  readBallots,
  sameAnswer,
  tally,
  voterKey,
} from "./ballot.ts";
import {
  type Answer,
  type Answers,
  answerFaults,
  answersFaults,
  bodyText,
  CLOCK_SKEW_MS,
  CLOSING_KEYS,
  closedPoll,
  type DraftQuestion,
  draftCountFaults,
  draftFromParsed,
  fingerprint,
  LIMITS,
  lengthFault,
  newPollFile,
  newVoteFile,
  POLL_DIR,
  POLL_FILE,
  type PollChanges,
  type PollDraft,
  type PollQuestion,
  questionsById,
  readPoll,
  reopenedPoll,
  rewritePoll,
  SCOPE,
  validatePoll,
} from "./files.ts";
import { allPolls, type PollRecord } from "./tree.ts";

/** The core this plugin runs against: the host's copy, handed to `activate`. */
export type Core = typeof NavbookCore;

export interface CommitOptions {
  commit?: boolean;
}

export interface EditOptions extends CommitOptions {
  /**
   * The `blobSha` of the text the editor started from. Given, a write over a
   * file that has changed since is refused (spec 06 §6.3: conflicts surface,
   * they are not resolved); absent, the write is unconditional, which is what
   * an editor session on a checkout is.
   */
  baseSha?: string;
}

/* --------------------------------------------------------------------- read */

/** Load the working tree; comments only when asked, since only "involved" reads them. */
export function loadTree(core: Core, ws: WsCtx, opts: { comments?: boolean } = {}): Repo {
  return core.loadRepo(ws, { comments: opts.comments ? "all" : "none" });
}

/**
 * Resolve a poll by ID or unambiguous prefix, among `polls` — every poll in
 * the tree unless the caller has a narrower set in mind.
 *
 * Takes what the tools print for a poll as well as its ID: its directory name,
 * or a path to it or to its `poll.md`.
 */
export function resolvePoll(core: Core, polls: readonly PollRecord[], ref: string): PollRecord {
  const parts = ref.replace(/\/+$/, "").split("/");
  if (parts[parts.length - 1] === POLL_FILE) parts.pop();
  const name = (parts.pop() ?? ref).replace(/^#/, "");
  const wanted = (core.parseDirName(name)?.id ?? name).toLowerCase();
  const resolution = core.resolvePrefix(
    wanted,
    polls.map((poll) => poll.id),
  );
  if (resolution.ok) return polls.find((poll) => poll.id === resolution.id) as PollRecord;
  switch (resolution.reason) {
    case "too-short":
      core.wsFail(
        "prefix-too-short",
        `'${ref}' is too short; ID prefixes must be at least ${core.MIN_PREFIX_LENGTH} characters`,
      );
      break;
    case "not-found":
      core.wsFail("not-found", `no poll matches '${ref}'`);
      break;
    default:
      core.wsFail("ambiguous", `'${ref}' matches more than one poll`, resolution.matches);
  }
}

/** A poll by reference, read afresh from the working tree. */
export function findPoll(core: Core, ws: WsCtx, ref: string): PollRecord {
  return resolvePoll(core, allPolls(loadTree(core, ws)), ref);
}

/** The issue a poll belongs to, as the tree has it. */
export function issueOf(repo: Repo, poll: PollRecord): EntityRecord | undefined {
  return repo.issues.find((issue) => issue.id === poll.issue.id);
}

/* ------------------------------------------------------------------- commits */

/** The commit subject for a change (§9): the poll, the vote when there is one, and the issue. */
export function subjectFor(
  core: Core,
  action: string,
  poll: { id: string },
  issue: { id: string },
  vote?: string,
): string {
  return core.docsScopedSubject(
    SCOPE,
    action,
    `${poll.id}${vote === undefined ? "" : ` ${vote}`} on #${issue.id}`,
  );
}

function change(
  core: Core,
  ws: WsCtx,
  action: string,
  poll: { id: string },
  issue: { id: string },
  ops: Plan["ops"],
  opts: CommitOptions,
  vote?: string,
): RunPlanResult {
  return core.runPlan(
    ws,
    {
      ops,
      message: subjectFor(core, action, poll, issue, vote),
      trailers: [{ key: "Refs", id: issue.id }],
    },
    { commit: opts.commit },
  );
}

/** How many faults a refusal lists; the rest it counts. */
export const LISTED_FAULTS = 20;

/**
 * Refuse with `faults`, the first as the message and the next few as details:
 * a ballot naming twenty thousand questions this poll does not have is
 * answered in a few lines, not in a megabyte.
 */
function refuse(
  core: Core,
  code: Parameters<Core["wsFail"]>[0],
  lead: string,
  faults: readonly string[],
): never {
  const listed = faults.slice(0, LISTED_FAULTS);
  const more = faults.length - listed.length;
  core.wsFail(code, lead, [...listed, ...(more > 0 ? [`and ${more} more`] : [])]);
}

/* --------------------------------------------------------------------- drafts */

/**
 * A draft from text shaped like `poll.md`, or a refusal naming every fault.
 * What the CLI reads with `--from` and from the editor.
 */
export function parseDraft(core: Core, text: string): PollDraft {
  let parsed: ParsedFile;
  try {
    parsed = core.parseFile(text);
  } catch (error) {
    core.wsFail("invalid-input", error instanceof Error ? error.message : String(error));
  }
  const draft = draftFromParsed(parsed);
  if ("problems" in draft) {
    const [first, ...rest] = draft.problems;
    refuse(
      core,
      "invalid-input",
      `the poll is not valid: ${first?.message ?? "unknown fault"}`,
      rest.map((problem) => problem.message),
    );
  }
  return draft;
}

/**
 * Refuse a `poll.md` that would not be valid once written, naming every fault.
 * A draft an API caller built has not been through the file reader, so what
 * it says is checked here exactly as a file's would be.
 */
function requireValid(core: Core, content: string): ParsedFile {
  const parsed = core.parseFile(content);
  const problems = validatePoll(parsed);
  if (problems.length > 0) {
    const [first, ...rest] = problems;
    refuse(
      core,
      "invalid-input",
      `the poll is not valid: ${first?.message}`,
      rest.map((problem) => problem.message),
    );
  }
  return parsed;
}

/**
 * Refuse questions over the counts of §4.2 before anything is made of them:
 * what {@link requireValid} would find too, but only after filling in the IDs
 * and writing out every option.
 */
function requireCountable(core: Core, questions: readonly DraftQuestion[]): void {
  const faults = draftCountFaults(questions);
  if (faults.length > 0) {
    const [first, ...rest] = faults;
    refuse(core, "invalid-input", `the poll is not valid: ${first}`, rest);
  }
}

/** An answer as it is checked and written: its write-in trimmed, and a blank one none. */
function trimmedAnswer(answer: Answer): Answer {
  return { picks: [...answer.picks], other: answer.other?.trim() ? answer.other.trim() : null };
}

/* ----------------------------------------------------------------- open */

export interface OpenPollResult {
  id: string;
  dirPath: string;
  filePath: string;
  run: RunPlanResult;
}

/** Refuse to ask anything in what is not an open issue. */
export function requireOpenIssue(core: Core, issue: EntityRecord): void {
  if (issue.kind !== "issue") core.wsFail("wrong-kind", `#${issue.id} is not an issue`);
  if (issue.status !== "open") {
    core.wsFail("precondition", `#${issue.id} is closed; reopen it to ask anything in it`);
  }
}

/** Open a poll on an issue (§3). */
export function openPoll(
  core: Core,
  ws: WsCtx,
  issue: EntityRecord,
  draft: PollDraft,
  opts: CommitOptions,
): OpenPollResult {
  requireOpenIssue(core, issue);
  requireCountable(core, draft.questions);
  const { created } = core.prepareOpen(ws);
  const content = newPollFile(draft, { author: core.currentAuthor(ws), created });
  requireValid(core, content);
  const id = ws.mintId(takenIds(core, ws));
  const dirPath = `${issue.dirPath}/${POLL_DIR}/${core.dirName(id, core.slugify(draft.title))}`;
  const filePath = `${dirPath}/${POLL_FILE}`;
  const run = change(
    core,
    ws,
    "open",
    { id },
    issue,
    [{ op: "write", path: filePath, content }],
    opts,
  );
  return { id, dirPath, filePath, run };
}

/* ----------------------------------------------------------------- edit */

/** Refuse a change to a poll whose file has faults: what it says cannot be read whole. */
function requireSound(core: Core, poll: PollRecord, doing: string): void {
  if (poll.problems.length === 0) return;
  refuse(
    core,
    "precondition",
    `poll ${poll.id} has faults; fix ${POLL_FILE} by hand before you ${doing}`,
    poll.problems.map((problem) => problem.message),
  );
}

/** Refuse a change to a poll that is closed, or whose file has faults. */
export function requireOpenPoll(core: Core, poll: PollRecord, doing: string): void {
  requireSound(core, poll, doing);
  if (poll.closedByIssue) {
    core.wsFail(
      "precondition",
      `poll ${poll.id} is closed with its issue #${poll.issue.id}; reopen the issue to ${doing}`,
    );
  }
  if (poll.closed !== null) {
    core.wsFail("precondition", `poll ${poll.id} is closed; reopen it to ${doing}`);
  }
}

export interface EditPollResult {
  run: RunPlanResult;
  /** How many ballots counted before the edit and no longer do (§5). */
  revoked: number;
}

/** How many of a poll's counting ballots its file, as it now reads, revokes (§5). */
function revokedBy(poll: PollRecord, parsed: ParsedFile): number {
  return fingerprint(readPoll(parsed).questions) === poll.fingerprint ? 0 : poll.voters;
}

/**
 * Change what a poll asks: its title, preamble, `results`, `deadline` or
 * questions — whichever `changes` names. A change to the questions revokes
 * every ballot (§5), and the result says how many that was.
 */
export function editPoll(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  changes: PollChanges,
  opts: EditOptions,
): EditPollResult {
  requireOpenPoll(core, poll, "edit it");
  assertUnchanged(core, poll.blobSha, `poll ${poll.id}`, opts.baseSha);
  if (changes.questions !== undefined) requireCountable(core, changes.questions);
  const text = readFileSync(core.absPath(ws, poll.filePath), "utf8");
  const content = rewritePoll(text, changes);
  if (content === text) core.wsFail("precondition", `that changes nothing in poll ${poll.id}`);
  const parsed = requireValid(core, content);
  const run = change(
    core,
    ws,
    "edit",
    poll,
    poll.issue,
    [{ op: "write", path: poll.filePath, content }],
    opts,
  );
  return { run, revoked: revokedBy(poll, parsed) };
}

/**
 * Faults in a `poll.md` somebody edited in place: whatever `validatePoll`
 * finds, and any change to the keys only closing writes.
 */
export function revalidateEditedPoll(core: Core, path: string): string[] {
  let parsed: ParsedFile;
  try {
    parsed = core.parseFile(readFileSync(path, "utf8"));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const problems = validatePoll(parsed).map((problem) => problem.message);
  for (const key of CLOSING_KEYS) {
    if (parsed.fm[key] !== undefined && parsed.fm[key] !== null)
      problems.push(`'${key}' is written by 'nav poll close', not by an edit`);
  }
  return problems;
}

/** Record an edit somebody already made to a poll's file, in place. */
export function applyPollEdit(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  opts: CommitOptions,
): EditPollResult {
  const content = readFileSync(core.absPath(ws, poll.filePath), "utf8");
  const revoked = revokedBy(poll, core.parseFile(content));
  const run = change(
    core,
    ws,
    "edit",
    poll,
    poll.issue,
    [{ op: "write", path: poll.filePath, content }],
    opts,
  );
  return { run, revoked };
}

/* ----------------------------------------------------------------- vote */

export interface VoteInput {
  /** The answers, by question ID; an empty map withdraws. */
  answers: Answers;
  /** The voter's note, in Markdown. */
  note?: string | null;
}

export interface VoteOptions extends CommitOptions {
  /**
   * The fingerprint of the questions the voter was answering. Given and not
   * the poll's current one, the vote is refused: the questions changed under
   * the form, and its answers may not mean what they meant.
   */
  fingerprint?: string;
}

export interface VoteResult {
  id: string;
  path: string;
  withdrawn: boolean;
  run: RunPlanResult;
}

/**
 * The answers a ballot is written with, in the poll's order: write-ins trimmed,
 * and a question with nothing in its answer left out — skipped.
 */
function writtenAnswers(questions: readonly PollQuestion[], given: Answers): Answers {
  const out: Answers = new Map();
  for (const question of questions) {
    const answer = given.get(question.id);
    if (answer === undefined) continue;
    const trimmed = trimmedAnswer(answer);
    if (trimmed.picks.length > 0 || trimmed.other !== null) out.set(question.id, trimmed);
  }
  return out;
}

/**
 * The IDs the tree already holds, read from names alone as `scanAllIds` reads
 * them — which sees every poll and every live poll's votes, and stops one
 * level above an archived issue's votes
 * (`archive/<year>/issues/<status>/<issue>/poll/<poll>/`). Those are added
 * here, so a new ID is never one an archived vote has.
 */
export function takenIds(core: Core, ws: WsCtx): Set<string> {
  const taken = core.scanAllIds(ws.navRoot);
  const below = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name));
    } catch {
      return [];
    }
  };
  const steps: ((dir: string) => string[])[] = [
    below,
    (dir) => below(dir).filter((path) => path.endsWith(`${sep}issues`)),
    below,
    below,
    (dir) => below(dir).filter((path) => path.endsWith(`${sep}${POLL_DIR}`)),
    below,
  ];
  let dirs = [join(ws.navRoot, "archive")];
  for (const step of steps) dirs = dirs.flatMap(step);
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      const vote = core.parseCommentFileName(name);
      if (vote !== null) taken.add(vote.id);
    }
  }
  return taken;
}

/** The clock, to the second a file name records. */
function nowToTheSecond(ws: WsCtx): number {
  return Math.floor(ws.now().getTime() / 1000) * 1000;
}

/**
 * The latest of these votes' stamps, short of any more than `skew` ahead of
 * `now`; -Infinity when there is none.
 */
function latestStamp(votes: Iterable<{ date: Date }>, now: number, skew: number): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const { date } of votes) {
    const at = date.getTime();
    if (at <= now + skew && at > latest) latest = at;
  }
  return latest;
}

/**
 * When a new vote is cast: now, or a second after the voter's last valid vote
 * when that is not earlier — file names are to the second, and a person's
 * votes must sort in the order they cast them (§4), or a quick second vote
 * could lose to the first.
 *
 * However far ahead of the clock that last vote is: one stamped by a laptop
 * running ten minutes fast is still the voter's latest word, and a new vote
 * stamped before it would sort before it and change nothing. Closing does not
 * wait for a vote that far ahead (§3.2); X-poll-2 points it out.
 */
function castAt(poll: PollRecord, ws: WsCtx, author: string): Date {
  const now = nowToTheSecond(ws);
  const key = voterKey(author);
  const last = latestStamp(
    poll.ballots.map((reading) => reading.vote).filter((vote) => voterKey(vote.author) === key),
    now,
    Number.POSITIVE_INFINITY,
  );
  return new Date(last >= now ? last + 1000 : now);
}

/** Cast a vote (§4): a new ballot for the person acting, replacing their last. */
export function castVote(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  input: VoteInput,
  opts: VoteOptions,
): VoteResult {
  requireOpenPoll(core, poll, "vote");
  if (opts.fingerprint !== undefined && opts.fingerprint !== poll.fingerprint) {
    core.wsFail("stale-content", `the questions of poll ${poll.id} changed since you opened it`, [
      "reload it, and answer the questions it asks now",
    ]);
  }
  const byId = questionsById(poll.questions);
  const unknown = [...input.answers.keys()].filter((qid) => !byId.has(qid));
  const answers = writtenAnswers(poll.questions, input.answers);
  const note = bodyText(input.note ?? "");
  const tooLong = lengthFault(note, LIMITS.note, "the note");
  const faults = [
    ...unknown.map((qid) => `'${qid}' is not a question of this poll`),
    ...answersFaults(poll.questions, answers),
    ...(tooLong === null ? [] : [tooLong]),
  ];
  if (faults.length > 0) {
    const [first, ...rest] = faults;
    refuse(core, "invalid-input", first as string, rest);
  }
  const author = core.currentAuthor(ws);
  const withdrawn = answers.size === 0;
  const ballot = ballotOf(poll.ballots, author);
  if (withdrawn && (ballot === undefined || ballot.state === "withdrawn")) {
    core.wsFail(
      "precondition",
      `you have no vote on poll ${poll.id} to withdraw; answer at least one question to vote`,
    );
  }
  if (
    ballot?.state === "counted" &&
    ballot.vote.note === note &&
    sameAnswers(ballot.vote.answers, answers)
  ) {
    core.wsFail("precondition", `your vote on poll ${poll.id} already says exactly this`);
  }
  const id = ws.mintId(takenIds(core, ws));
  const path = `${poll.dirPath}/${core.commentFileName(castAt(poll, ws, author), id)}`;
  const content = newVoteFile({ author, fingerprint: poll.fingerprint, answers, note });
  const run = change(
    core,
    ws,
    withdrawn ? "withdraw" : "vote",
    poll,
    poll.issue,
    [{ op: "write", path, content }],
    opts,
    id,
  );
  return { id, path, withdrawn, run };
}

/** Whether two ballots answer every question alike. */
function sameAnswers(a: Answers, b: Answers): boolean {
  return a.size === b.size && [...a].every(([qid, answer]) => sameAnswer(answer, b.get(qid)));
}

/* ---------------------------------------------------------------- close */

export interface CloseInput {
  /**
   * What the closer decided, by question ID: an answer, or null to leave the
   * question undecided. A question left out gets the decision the poll comes
   * to (§6.3).
   */
  decide?: ReadonlyMap<string, Answer | null>;
  note?: string | null;
}

export interface CloseResult {
  decision: Answers;
  run: RunPlanResult;
}

/**
 * What closing a poll now would do: the instant it would write, and the
 * tallies and the decision of the ballots it would read (§3.2, §6.3) — which
 * are not the poll's own when a vote is stamped further ahead than closing
 * waits for, since closing makes that vote late.
 */
export interface Closing {
  at: Date;
  tallies: QuestionTally[];
  proposed: Answers;
}

/** What closing `poll` at the clock of `ws` would do. */
export function closingOf(poll: PollRecord, ws: WsCtx): Closing {
  const at = closeAt(poll, ws);
  const valid = poll.ballots.map((reading) => reading.vote);
  if (!valid.some((vote) => vote.date.getTime() > at.getTime()))
    return { at, tallies: poll.tallies, proposed: poll.proposed };
  const tallies = tally(poll.questions, counted(readBallots(valid, poll.fingerprint, at)));
  return { at, tallies, proposed: proposedDecision(poll.questions, tallies) };
}

/** The questions closing would leave to the closer: tied over the ballots it reads (§6.3). */
export function closingTies(closing: Pick<Closing, "tallies">): string[] {
  return closing.tallies.filter((entry) => entry.tied).map((entry) => entry.question);
}

/**
 * The decision closing would record: the closer's, else what the tallies of
 * `closing` come to — the poll's own unless told otherwise. Refused when a
 * tied question is left to the tallies, which cannot break a tie (§6.3).
 */
export function decisionFor(
  core: Core,
  poll: PollRecord,
  input: CloseInput,
  closing: Pick<Closing, "tallies" | "proposed"> = poll,
): Answers {
  const decide = new Map<string, Answer | null>(
    [...(input.decide ?? [])].map(([qid, answer]) => [
      qid,
      answer === null ? null : trimmedAnswer(answer),
    ]),
  );
  const faults: string[] = [];
  const byId = questionsById(poll.questions);
  for (const [qid, answer] of decide) {
    const question = byId.get(qid);
    if (question === undefined) faults.push(`'${qid}' is not a question of poll ${poll.id}`);
    else if (answer !== null) faults.push(...answerFaults(question, answer));
  }
  const note = lengthFault(bodyText(input.note ?? ""), LIMITS.note, "the note");
  if (note !== null) faults.push(note);
  if (faults.length > 0) {
    const [first, ...rest] = faults;
    refuse(core, "invalid-input", first as string, rest);
  }
  const decision: Answers = new Map();
  const tied: string[] = [];
  const tallies = new Map(closing.tallies.map((entry) => [entry.question, entry]));
  for (const question of poll.questions) {
    if (decide.has(question.id)) {
      const answer = decide.get(question.id);
      if (answer) decision.set(question.id, { picks: [...answer.picks], other: answer.other });
      continue;
    }
    const entry = tallies.get(question.id);
    if (entry?.tied) tied.push(`'${question.id}' is tied between ${entry.leaders.join(", ")}`);
    const proposed = closing.proposed.get(question.id);
    if (proposed !== undefined) decision.set(question.id, proposed);
  }
  if (tied.length > 0) {
    core.wsFail(
      "precondition",
      `poll ${poll.id} has ${tied.length === 1 ? "a tie" : "ties"} only you can break: decide ${tied.length === 1 ? "it" : "them"}, or leave ${tied.length === 1 ? "it" : "them"} undecided`,
      tied,
    );
  }
  return decision;
}

/**
 * When a poll is closed: now, or the latest valid vote's second when that is
 * later — a vote stamped after its voter's last one may run ahead of the clock
 * (§4), and closing must not make a ballot it has just read late (§3.2).
 *
 * Every valid vote, not only those that count: a withdrawal made late would
 * bring back the ballot it withdrew. Not a vote with faults, which counts for
 * nothing either way; nor one stamped further ahead than a clock runs fast.
 */
function closeAt(poll: PollRecord, ws: WsCtx): Date {
  const now = nowToTheSecond(ws);
  return new Date(
    Math.max(
      now,
      latestStamp(
        poll.ballots.map((reading) => reading.vote),
        now,
        CLOCK_SKEW_MS,
      ),
    ),
  );
}

/** Close a poll (§3.2), recording the decision. */
export function closePoll(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  input: CloseInput,
  opts: EditOptions,
): CloseResult {
  requireSound(core, poll, "close it");
  if (poll.closed !== null) core.wsFail("precondition", `poll ${poll.id} is already closed`);
  assertUnchanged(core, poll.blobSha, `poll ${poll.id}`, opts.baseSha);
  // Proposed from the ballots the close reads, not those the poll counts while
  // open: a vote stamped too far ahead is one the close makes late.
  const closing = closingOf(poll, ws);
  const decision = decisionFor(core, poll, input, closing);
  const text = readFileSync(core.absPath(ws, poll.filePath), "utf8");
  const content = closedPoll(text, {
    at: core.toIsoSeconds(closing.at),
    by: core.currentAuthor(ws),
    decision,
    note: input.note ?? null,
  });
  const run = change(
    core,
    ws,
    "close",
    poll,
    poll.issue,
    [{ op: "write", path: poll.filePath, content }],
    opts,
  );
  return { decision, run };
}

export interface ReopenResult {
  run: RunPlanResult;
  /**
   * How many votes cast while it was closed — which only a race or a hand
   * edit produces — count again now that it is open (§3.2).
   */
  late: number;
}

/** Reopen a closed poll (§3.2): its decision goes, and voting resumes. */
export function reopenPoll(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  opts: EditOptions,
): ReopenResult {
  if (poll.closed === null) {
    core.wsFail(
      "precondition",
      poll.closedByIssue
        ? `poll ${poll.id} is closed only because #${poll.issue.id} is; reopen the issue`
        : `poll ${poll.id} is not closed`,
    );
  }
  if (poll.issue.status !== "open") {
    core.wsFail("precondition", `#${poll.issue.id} is closed; reopen it before its poll`);
  }
  assertUnchanged(core, poll.blobSha, `poll ${poll.id}`, opts.baseSha);
  const text = readFileSync(core.absPath(ws, poll.filePath), "utf8");
  const run = change(
    core,
    ws,
    "reopen",
    poll,
    poll.issue,
    [{ op: "write", path: poll.filePath, content: reopenedPoll(text) }],
    opts,
  );
  return { run, late: poll.ballots.filter((ballot) => ballot.state === "late").length };
}

/* ------------------------------------------------------------------ people */

/** The address of the person acting, lowercased; null when git cannot say. */
export function actingVoter(core: Core, ws: WsCtx): string | null {
  try {
    return voterKey(core.currentAuthor(ws));
  } catch (error) {
    if (error instanceof core.MissingIdentityError) return null;
    throw error;
  }
}

/* ------------------------------------------------------------------- helpers */

/**
 * Refuse a write whose author was looking at an older version of the file,
 * before anything is written.
 */
function assertUnchanged(
  core: Core,
  current: string,
  describe: string,
  baseSha: string | undefined,
): void {
  if (baseSha === undefined || current === baseSha) return;
  core.wsFail("stale-content", `${describe} changed since you opened it`, [
    "reload it and apply your change to what it says now",
  ]);
}
