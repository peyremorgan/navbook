/**
 * Reading polls and votes out of a tree — `doc/spec.md` §2 and §6.
 *
 * The entity location for `poll/` inside an issue's directory. Each poll comes
 * out of it already read: its questions and fingerprint, its votes, which of
 * them count, the tallies and the decision. Only what depends on who is asking
 * — where *you* stand — is left to the caller, so the reading is one thing for
 * a query term, a `show` and the API alike.
 */

import type {
  EntityRecord,
  NavTree,
  ParsedFile,
  Problem,
  Repo,
  StructuralProblem,
} from "@navbook/core";
import {
  type BallotReading,
  type CastVote,
  counted,
  proposedDecision,
  type QuestionTally,
  readBallots,
  tally,
  type VoterState,
  voterKey,
  voterState,
} from "./ballot.ts";
import {
  type Answers,
  answersFaults,
  bodyText,
  fingerprint,
  POLL_DIR,
  POLL_FILE,
  type PollFields,
  readPoll,
  readVote,
  runningCore,
  validatePoll,
  validateVote,
} from "./files.ts";

/** A vote (§4), valid or not. */
export interface VoteRecord extends CastVote {
  /** Path relative to the Navbook directory. */
  path: string;
  /** When it was cast, as an ISO timestamp. */
  cast: string;
  blobSha: string;
  parsed: ParsedFile;
  /** Schema faults, and — when it answered the current questions — faults against them (X-poll-1). */
  problems: Problem[];
}

/** Open, or closed by `closed` or by its issue (§6.2). */
export type PollStatus = "open" | "closed";

/** A poll (§3), with what its votes say (§6). */
export interface PollRecord extends PollFields {
  id: string;
  slug: string;
  dirName: string;
  /** Directory path relative to the Navbook directory. */
  dirPath: string;
  /** Path of `poll.md`, relative to the Navbook directory. */
  filePath: string;
  /** The hash of `poll.md`'s text, exactly as it was parsed: what an editor hands back as `baseSha`. */
  blobSha: string;
  parsed: ParsedFile;
  preamble: string;
  /** The fingerprint of the questions as they are now (§5). */
  fingerprint: string;
  /** Schema faults of `poll.md` (X-poll-1). */
  problems: Problem[];
  /** Every vote file, oldest first, valid or not. */
  votes: VoteRecord[];
  /** The valid votes' states, oldest first (§6.1). */
  ballots: BallotReading<VoteRecord>[];
  /** How many ballots count. */
  voters: number;
  tallies: QuestionTally[];
  status: PollStatus;
  /** True when it reads as closed only because its issue is (§6.2). */
  closedByIssue: boolean;
  /**
   * What it came to: the recorded decision when it was closed, the one its
   * tallies come to when its issue closed it, and null while it is open.
   */
  outcome: Answers | null;
  /** What it would come to if it were closed now (§6.3). */
  proposed: Answers;
  /** The issue whose directory holds it. */
  issue: { id: string; dirPath: string; status: string };
  /** Other files in its directory, preserved untouched. */
  extraFiles: string[];
}

/** What this plugin hangs off an issue, under `poll` in `EntityRecord.ext`. */
export interface IssuePollsModel {
  polls: PollRecord[];
}

const NO_POLLS: IssuePollsModel = { polls: [] };

/**
 * How a file's text becomes a record: the host's parser and hash, passed in so
 * the plugin reads with the core that is running.
 */
export interface PollReader {
  parse(text: string): ParsedFile;
  hash(text: string): string;
}

/**
 * The path of a Markdown file directly in a poll's directory, live or
 * archived: what the entity location reads. Anything else is listed and never
 * read.
 */
const POLL_MARKDOWN = /^(?:archive\/[^/]+\/)?issues\/[^/]+\/[^/]+\/poll\/[^/]+\/[^/]+\.md$/;

/** True for a path the entity location reads. */
export function readsIssuePath(path: string): boolean {
  return POLL_MARKDOWN.test(path);
}

interface PollDraft {
  dirName: string;
  dirPath: string;
  pollFile?: string;
  votes: string[];
  extraFiles: string[];
}

/** The polls in one issue's `poll/`, and what is wrong with the layout. */
export function buildIssuePolls(
  files: NavTree,
  entity: Pick<EntityRecord, "id" | "dirPath" | "status">,
  paths: readonly string[],
  reader: PollReader,
): { model: IssuePollsModel; problems: StructuralProblem[] } {
  const core = runningCore();
  const problems: StructuralProblem[] = [];
  const dir = `${entity.dirPath}/${POLL_DIR}`;
  const drafts = new Map<string, PollDraft>();
  const badDirs = new Set<string>();

  for (const path of [...paths].sort()) {
    const inner = path.slice(dir.length + 1).split("/");
    const name = inner[0] as string;
    if (inner.length === 1) {
      problems.push({ path, message: `'${POLL_DIR}/' must contain poll directories, not files` });
      continue;
    }
    if (core.parseDirName(name) === null) {
      if (!badDirs.has(name)) {
        badDirs.add(name);
        problems.push({
          path: `${dir}/${name}`,
          message: `poll directory name '${name}' does not match <id>-<slug>`,
        });
      }
      continue;
    }
    let draft = drafts.get(name);
    if (draft === undefined) {
      draft = { dirName: name, dirPath: `${dir}/${name}`, votes: [], extraFiles: [] };
      drafts.set(name, draft);
    }
    const file = inner[1] as string;
    if (inner.length > 2 || !file.endsWith(".md")) draft.extraFiles.push(path);
    else if (file === POLL_FILE) draft.pollFile = path;
    else if (core.parseCommentFileName(file) !== null) draft.votes.push(path);
    else
      problems.push({
        path,
        message: `'${file}' is not a vote: a vote is named <timestamp>-<id>.md, and only ${POLL_FILE} and votes may be Markdown here`,
      });
  }

  const polls: PollRecord[] = [];
  for (const draft of drafts.values()) {
    if (draft.pollFile === undefined) {
      problems.push({ path: draft.dirPath, message: `poll directory is missing its ${POLL_FILE}` });
      continue;
    }
    const poll = materialize(files, draft, draft.pollFile, entity, problems, reader);
    if (poll !== null) polls.push(poll);
  }
  polls.sort(byCreated);
  return { model: polls.length === 0 ? NO_POLLS : { polls }, problems };
}

function materialize(
  files: NavTree,
  draft: PollDraft,
  pollFile: string,
  entity: Pick<EntityRecord, "id" | "dirPath" | "status">,
  problems: StructuralProblem[],
  reader: PollReader,
): PollRecord | null {
  const core = runningCore();
  const read = parseOrReport(files, pollFile, problems, reader);
  if (read === null) return null;
  const fields = readPoll(read.parsed);
  const current = fingerprint(fields.questions);
  const name = core.parseDirName(draft.dirName) as { id: string; slug: string };

  const votes: VoteRecord[] = [];
  for (const path of draft.votes.sort()) {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const stamp = core.parseCommentFileName(fileName);
    const vote = parseOrReport(files, path, problems, reader);
    if (stamp === null || vote === null) continue;
    const said = readVote(vote.parsed);
    const voteProblems = validateVote(vote.parsed);
    // Judged against the questions only when it answered these ones (§4.1):
    // a revoked ballot answered questions that no longer exist.
    if (said.answers !== null && said.fingerprint === current) {
      for (const message of answersFaults(fields.questions, said.answers))
        voteProblems.push({ key: "answers", message });
    }
    votes.push({
      id: stamp.id,
      fileName,
      path,
      date: stamp.date,
      cast: core.toIsoSeconds(stamp.date),
      author: said.author,
      fingerprint: said.fingerprint,
      answers: said.answers ?? new Map(),
      note: bodyText(vote.parsed.body),
      blobSha: vote.blobSha,
      parsed: vote.parsed,
      problems: voteProblems,
    });
  }

  const closedAt = fields.closed === null ? null : core.parseIso(fields.closed);
  const ballots = readBallots(
    votes.filter((vote) => vote.problems.length === 0),
    current,
    closedAt,
  );
  const tallies = tally(fields.questions, counted(ballots));
  const proposed = proposedDecision(fields.questions, tallies);
  const closedByIssue = fields.closed === null && entity.status !== "open";
  return {
    ...fields,
    id: name.id,
    slug: name.slug,
    dirName: draft.dirName,
    dirPath: draft.dirPath,
    filePath: pollFile,
    blobSha: read.blobSha,
    parsed: read.parsed,
    preamble: bodyText(read.parsed.body),
    fingerprint: current,
    problems: validatePoll(read.parsed),
    votes,
    ballots,
    voters: ballots.filter((ballot) => ballot.state === "counted").length,
    tallies,
    status: fields.closed !== null || closedByIssue ? "closed" : "open",
    closedByIssue,
    outcome:
      fields.closed !== null ? (fields.decision ?? new Map()) : closedByIssue ? proposed : null,
    proposed,
    issue: { id: entity.id, dirPath: entity.dirPath, status: entity.status },
    extraFiles: draft.extraFiles.sort(),
  };
}

function parseOrReport(
  files: NavTree,
  path: string,
  problems: StructuralProblem[],
  reader: PollReader,
): { parsed: ParsedFile; blobSha: string } | null {
  // Read outside the `try`, as core does: a file that cannot be read has not
  // failed to parse, and must fail the load rather than drop the record.
  const text = files.get(path) ?? "";
  try {
    return { parsed: reader.parse(text), blobSha: reader.hash(text) };
  } catch (error) {
    problems.push({ path, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Oldest first, by when they were opened; the ID breaks a tie. */
function byCreated(a: PollRecord, b: PollRecord): number {
  if (a.created !== b.created) return a.created < b.created ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ---------------------------------------------------------------- reading */

/** The polls on an issue, oldest first. */
export function pollsOf(entity: Pick<EntityRecord, "ext">): PollRecord[] {
  return ((entity.ext?.get(POLL_DIR) as IssuePollsModel | undefined) ?? NO_POLLS).polls;
}

/** Every poll in the tree, oldest first. */
export function allPolls(repo: Repo): PollRecord[] {
  return repo.issues.flatMap(pollsOf).sort(byCreated);
}

/** Where `person` stands on a poll. */
export function stateOf(poll: PollRecord, person: string): VoterState {
  return voterState(poll.ballots, person);
}

/**
 * True when `person` has a hand in the issue: they filed it, it is assigned to
 * them, or they commented on it. The comments must have been read for the last
 * to count; a tree read without them answers from the first two.
 */
export function involved(issue: EntityRecord, person: string): boolean {
  const core = runningCore();
  const key = voterKey(person);
  const people = [
    typeof issue.fm.author === "string" ? issue.fm.author : "",
    ...core.readAssignees(issue.fm),
    ...issue.comments.map((comment) => comment.author),
  ];
  return people.some((someone) => someone !== "" && voterKey(someone) === key);
}

/**
 * True when a poll is waiting on `person`: it is open, and they have no ballot
 * that counts — either they have a hand in the issue and have not voted, or
 * the questions changed under the ballot they cast. A withdrawal is an answer.
 * A poll whose file has faults waits on nobody: no vote on it can be cast
 * until somebody fixes it by hand, so nobody can answer it by voting.
 */
export function awaits(issue: EntityRecord, poll: PollRecord, person: string): boolean {
  if (poll.status !== "open" || poll.problems.length > 0) return false;
  const state = stateOf(poll, person);
  return state === "revoked" || (state === "none" && involved(issue, person));
}
