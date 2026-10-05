/**
 * What can be done to polls — `doc/spec.md` §3, §4 and §9.
 *
 * Every change here is a `Plan` handed to the host's `runPlan`, which is how a
 * plugin's writes get `--commit`, the staged-changes guard and the commit
 * message conventions without implementing any of them. The CLI and the API
 * call the same functions: what differs between them is how the input was
 * gathered, never what is written.
 */

import { readFileSync } from "node:fs";
import type * as NavbookCore from "@navbook/core";
import type { EntityRecord, ParsedFile, Plan, Repo, RunPlanResult, WsCtx } from "@navbook/core";
import { ballotOf, sameAnswer, voterKey } from "./ballot.ts";
import {
  type Answer,
  type Answers,
  answerFaults,
  answersFaults,
  bodyText,
  CLOSING_KEYS,
  closedPoll,
  draftFromParsed,
  fingerprint,
  newPollFile,
  newVoteFile,
  POLL_DIR,
  POLL_FILE,
  type PollChanges,
  type PollDraft,
  type PollQuestion,
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
    core.wsFail(
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
    core.wsFail(
      "invalid-input",
      `the poll is not valid: ${first?.message}`,
      rest.map((problem) => problem.message),
    );
  }
  return parsed;
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

/** Refuse a change to a poll that is closed, or whose file has faults. */
export function requireOpenPoll(core: Core, poll: PollRecord, doing: string): void {
  if (poll.problems.length > 0) {
    core.wsFail(
      "precondition",
      `poll ${poll.id} has faults; fix ${POLL_FILE} by hand before you ${doing}`,
      poll.problems.map((problem) => problem.message),
    );
  }
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
 * IDs nothing in the tree holds yet: every name `scanAllIds` reads, and every
 * poll's and vote's — which, in an archived issue, sit deeper than it looks.
 */
export function takenIds(core: Core, ws: WsCtx): Set<string> {
  const taken = core.scanAllIds(ws.navRoot);
  for (const poll of allPolls(loadTree(core, ws))) {
    taken.add(poll.id);
    for (const vote of poll.votes) taken.add(vote.id);
  }
  return taken;
}

/**
 * When a new vote is cast: now, or a second after the voter's last vote when
 * that is not earlier — file names are to the second, and a person's votes
 * must sort in the order they cast them (§4), or a quick second vote could
 * lose to the first.
 */
function castAt(poll: PollRecord, ws: WsCtx, author: string): Date {
  const now = new Date(Math.floor(ws.now().getTime() / 1000) * 1000);
  const key = voterKey(author);
  const last = Math.max(
    ...poll.votes
      .filter((vote) => voterKey(vote.author) === key)
      .map((vote) => vote.date.getTime()),
  );
  return last >= now.getTime() ? new Date(last + 1000) : now;
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
  const unknown = [...input.answers.keys()].filter(
    (qid) => !poll.questions.some((question) => question.id === qid),
  );
  const answers = writtenAnswers(poll.questions, input.answers);
  const faults = [
    ...unknown.map((qid) => `'${qid}' is not a question of this poll`),
    ...answersFaults(poll.questions, answers),
  ];
  if (faults.length > 0) {
    const [first, ...rest] = faults;
    core.wsFail("invalid-input", first as string, rest);
  }
  const author = core.currentAuthor(ws);
  const note = bodyText(input.note ?? "");
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
 * The decision closing would record: the closer's, else what the tallies come
 * to. Refused when a tied question is left to the tallies, which cannot break
 * a tie (§6.3).
 */
export function decisionFor(core: Core, poll: PollRecord, input: CloseInput): Answers {
  const decide = new Map<string, Answer | null>(
    [...(input.decide ?? [])].map(([qid, answer]) => [
      qid,
      answer === null ? null : trimmedAnswer(answer),
    ]),
  );
  const faults: string[] = [];
  for (const [qid, answer] of decide) {
    const question = poll.questions.find((candidate) => candidate.id === qid);
    if (question === undefined) faults.push(`'${qid}' is not a question of poll ${poll.id}`);
    else if (answer !== null) faults.push(...answerFaults(question, answer));
  }
  if (faults.length > 0) {
    const [first, ...rest] = faults;
    core.wsFail("invalid-input", first as string, rest);
  }
  const decision: Answers = new Map();
  const tied: string[] = [];
  for (const question of poll.questions) {
    if (decide.has(question.id)) {
      const answer = decide.get(question.id);
      if (answer) decision.set(question.id, { picks: [...answer.picks], other: answer.other });
      continue;
    }
    const entry = poll.tallies.find((candidate) => candidate.question === question.id);
    if (entry?.tied) tied.push(`'${question.id}' is tied between ${entry.leaders.join(", ")}`);
    const proposed = poll.proposed.get(question.id);
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

/** Close a poll (§3.2), recording the decision. */
export function closePoll(
  core: Core,
  ws: WsCtx,
  poll: PollRecord,
  input: CloseInput,
  opts: EditOptions,
): CloseResult {
  if (poll.problems.length > 0) {
    core.wsFail(
      "precondition",
      `poll ${poll.id} has faults; fix ${POLL_FILE} by hand before you close it`,
      poll.problems.map((problem) => problem.message),
    );
  }
  if (poll.closed !== null) core.wsFail("precondition", `poll ${poll.id} is already closed`);
  assertUnchanged(core, poll.blobSha, `poll ${poll.id}`, opts.baseSha);
  const decision = decisionFor(core, poll, input);
  const text = readFileSync(core.absPath(ws, poll.filePath), "utf8");
  const content = closedPoll(text, {
    at: core.nowIso(ws),
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
