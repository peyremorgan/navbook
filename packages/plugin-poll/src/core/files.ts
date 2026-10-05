/**
 * The two file types this plugin defines — `doc/spec.md` §3 and §4.
 *
 * A poll is `poll/<id>-<slug>/poll.md` inside an issue's directory; a vote is a
 * file named like a comment beside it. This module reads both defensively,
 * says what is wrong with them, composes new ones, and computes the
 * fingerprint (§5) that ties a ballot to the questions it answered. Where they
 * live is `tree.ts`; what the votes add up to is `ballot.ts`.
 */

import { createHash } from "node:crypto";
import type * as NavbookCore from "@navbook/core";
import type { NavDoc, ParsedFile, Problem } from "@navbook/core";

/**
 * The running core, handed to `activate` and kept here.
 *
 * A *type* import of `@navbook/core` above and no value import: a plugin must
 * never resolve its own copy (see `@navbook/plugin-kb`'s `files.ts`, which
 * explains why at length). Set once, before anything below is called: every
 * entry point of this plugin runs after its own `activate`.
 */
let core: typeof NavbookCore;

/** Called by each entry's `activate` before any of these functions can be reached. */
export function useCore(host: typeof NavbookCore): void {
  core = host;
}

/** The running core, for the modules of this plugin that are not handed one. */
export function runningCore(): typeof NavbookCore {
  return core;
}

/** This plugin's directory inside an issue's (§2). */
export const POLL_DIR = "poll";

/** A poll's file, inside its directory. */
export const POLL_FILE = "poll.md";

/** The commit scope every change this plugin makes uses (§9). */
export const SCOPE = "poll";

/** The slug grammar of 02 §2.3, which question and option IDs follow (§3.1). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A fingerprint as a vote records it (§5). */
export const FINGERPRINT = /^[0-9a-f]{16}$/;

/** The values `results` takes (§3); the first is what an absent key means. */
export const RESULTS = ["hidden", "visible"] as const;
export type Results = (typeof RESULTS)[number];

/** The keys closing a poll writes, and reopening removes (§3.2). */
export const CLOSING_KEYS = ["closed", "closed-by", "decision", "decision-note"] as const;

/* ------------------------------------------------------------------ shapes */

export interface PollOption {
  id: string;
  label: string;
  /** Markdown; null when absent or blank. */
  description: string | null;
}

export interface PollQuestion {
  id: string;
  text: string;
  multi: boolean;
  other: boolean;
  options: PollOption[];
}

/** One question's answer, in a ballot or a decision (§4.1). */
export interface Answer {
  picks: string[];
  /** The write-in; null when there is none. */
  other: string | null;
}

/** Answers by question ID, in the order they were written. */
export type Answers = Map<string, Answer>;

/** What `poll.md` says, read defensively: a bad value reads as absent. */
export interface PollFields {
  title: string;
  author: string;
  created: string;
  results: Results;
  deadline: string | null;
  questions: PollQuestion[];
  closed: string | null;
  closedBy: string | null;
  decision: Answers | null;
  decisionNote: string | null;
}

/** What a vote says, read defensively. */
export interface VoteFields {
  author: string;
  fingerprint: string;
  /** Null when `answers` is missing or not a map. */
  answers: Answers | null;
}

/* ----------------------------------------------------------------- reading */

type Path = readonly (string | number)[];

/**
 * A scalar as text: a string as it is, and a number or a boolean as it was
 * written — `1.10` stays `1.10` (§3.1) — which the document at `path` says.
 * Anything else, `null` included, is not text.
 */
function textAt(value: unknown, path: Path, nav: NavDoc): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return core.stringAt(nav, path) ?? String(value);
  return null;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path as a message names it: `questions[2].options[1]`, counting from 1. */
function where(path: Path): string {
  let out = "";
  for (const part of path)
    out += typeof part === "number" ? `[${part + 1}]` : `${out === "" ? "" : "."}${part}`;
  return out;
}

/** Text that is set, not blank, and on one line. */
function lineFault(text: string | null, what: string): string | null {
  if (text === null || text.trim() === "") return `${what} must be a non-empty string`;
  if (/[\r\n]/.test(text)) return `${what} must be on one line`;
  return null;
}

const QUESTION_KEYS = new Set(["id", "text", "multi", "other", "options"]);
const OPTION_KEYS = new Set(["id", "label", "description"]);
const ANSWER_KEYS = new Set(["picks", "other"]);

/**
 * Read `questions` (§3.1), collecting every fault on the way.
 *
 * Returns what could be read: a question or option missing something it needs
 * is left out, so a reader still has the rest. `requireIds` is false for a
 * draft, whose IDs a tool fills in; an ID that is given must still be one.
 * Draft IDs left out come back as the empty string.
 */
function readQuestions(
  value: unknown,
  nav: NavDoc,
  problems: Problem[],
  requireIds: boolean,
): PollQuestion[] {
  const fault = (path: Path, message: string): void => {
    problems.push({ key: "questions", message: `${where(path)}: ${message}` });
  };
  if (value === undefined || value === null) {
    problems.push({ key: "questions", message: "missing required key 'questions'" });
    return [];
  }
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({
      key: "questions",
      message: "'questions' must be a list of at least one question",
    });
    return [];
  }
  const questions: PollQuestion[] = [];
  const questionIds = new Set<string>();
  value.forEach((raw, q) => {
    const at: Path = ["questions", q];
    if (!isMap(raw)) {
      fault(at, "a question must be a map");
      return;
    }
    let ok = true;
    for (const key of Object.keys(raw)) {
      if (!QUESTION_KEYS.has(key)) {
        fault(at, `'${key}' is not a key of a question`);
        ok = false;
      }
    }
    const id = readId(raw.id, [...at, "id"], nav, requireIds, fault);
    if (id === null) ok = false;
    else if (id !== "") {
      if (questionIds.has(id)) {
        fault([...at, "id"], `'${id}' is the ID of an earlier question`);
        ok = false;
      }
      questionIds.add(id);
    }
    const text = textAt(raw.text, [...at, "text"], nav);
    const textFault = lineFault(text, "'text'");
    if (textFault !== null) {
      fault(at, textFault);
      ok = false;
    }
    const multi = readFlag(raw.multi, [...at, "multi"], fault);
    const other = readFlag(raw.other, [...at, "other"], fault);
    if (multi === null || other === null) ok = false;
    const options = readOptions(raw.options, at, nav, requireIds, fault);
    if (options === null) ok = false;
    else if (options.length + (other === true ? 1 : 0) < 2) {
      fault(
        at,
        "a question must offer at least two choices: two options, or one and 'other: true'",
      );
      ok = false;
    }
    if (!ok || id === null || options === null) return;
    questions.push({
      id,
      text: text as string,
      multi: multi === true,
      other: other === true,
      options,
    });
  });
  return questions;
}

function readOptions(
  value: unknown,
  at: Path,
  nav: NavDoc,
  requireIds: boolean,
  fault: (path: Path, message: string) => void,
): PollOption[] | null {
  const path = [...at, "options"];
  if (!Array.isArray(value) || value.length === 0) {
    fault(at, "'options' must be a list of at least one option");
    return null;
  }
  const options: PollOption[] = [];
  const ids = new Set<string>();
  let ok = true;
  value.forEach((raw, o) => {
    const here: Path = [...path, o];
    if (!isMap(raw)) {
      fault(here, "an option must be a map");
      ok = false;
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!OPTION_KEYS.has(key)) {
        fault(here, `'${key}' is not a key of an option`);
        ok = false;
      }
    }
    const id = readId(raw.id, [...here, "id"], nav, requireIds, fault);
    if (id === null) ok = false;
    else if (id !== "") {
      if (ids.has(id)) {
        fault([...here, "id"], `'${id}' is the ID of an earlier option of this question`);
        ok = false;
      }
      ids.add(id);
    }
    const label = textAt(raw.label, [...here, "label"], nav);
    const labelFault = lineFault(label, "'label'");
    if (labelFault !== null) {
      fault(here, labelFault);
      ok = false;
    }
    let description: string | null = null;
    if (raw.description !== undefined && raw.description !== null) {
      const text = textAt(raw.description, [...here, "description"], nav);
      if (text === null) {
        fault(here, "'description' must be a string");
        ok = false;
      } else description = descriptionOf(text);
    }
    if (id !== null && labelFault === null)
      options.push({ id, label: label as string, description });
  });
  return ok ? options : null;
}

/**
 * A description as it is read and fingerprinted (§3.1): without trailing
 * whitespace — the line break a YAML block leaves at its end is formatting, not
 * text — and none at all when that leaves nothing.
 */
export function descriptionOf(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").replace(/\s+$/, "");
  return trimmed.trim() === "" ? null : trimmed;
}

/** An ID: a slug, written however YAML read it. "" for a draft's missing one; null for a fault. */
function readId(
  value: unknown,
  path: Path,
  nav: NavDoc,
  required: boolean,
  fault: (path: Path, message: string) => void,
): string | null {
  if (value === undefined || value === null) {
    if (!required) return "";
    fault(path.slice(0, -1), "missing required key 'id'");
    return null;
  }
  const id = textAt(value, path, nav);
  if (id === null || !SLUG_PATTERN.test(id)) {
    fault(
      path,
      `${JSON.stringify(id ?? value)} is not an ID: lowercase letters, digits and single hyphens`,
    );
    return null;
  }
  return id;
}

function readFlag(
  value: unknown,
  path: Path,
  fault: (path: Path, message: string) => void,
): boolean | null {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  fault(path, `must be true or false, got ${JSON.stringify(value)}`);
  return null;
}

/**
 * Read one answer (§4.1) from the file alone: its shape, not whether the poll
 * has the question or the options it names. Null, with the faults recorded,
 * when it cannot be read.
 */
function readAnswer(
  raw: unknown,
  at: Path,
  nav: NavDoc,
  fault: (path: Path, message: string) => void,
): Answer | null {
  if (!isMap(raw)) {
    fault(at, "an answer must be a map with 'picks', and 'other' when there is a write-in");
    return null;
  }
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!ANSWER_KEYS.has(key)) {
      fault(at, `'${key}' is not a key of an answer`);
      ok = false;
    }
  }
  const picks: string[] = [];
  if (!Array.isArray(raw.picks)) {
    fault(at, "'picks' must be a list of option IDs");
    ok = false;
  } else {
    raw.picks.forEach((value, index) => {
      const pick = textAt(value, [...at, "picks", index], nav);
      if (pick === null || !SLUG_PATTERN.test(pick)) {
        fault([...at, "picks", index], `${JSON.stringify(pick ?? value)} is not an option ID`);
        ok = false;
      } else if (picks.includes(pick)) {
        fault(at, `'${pick}' is picked twice`);
        ok = false;
      } else picks.push(pick);
    });
  }
  let other: string | null = null;
  if (raw.other !== undefined && raw.other !== null) {
    other = textAt(raw.other, [...at, "other"], nav);
    const otherFault = lineFault(other, "'other'");
    if (otherFault !== null) {
      fault(at, otherFault);
      ok = false;
    }
  }
  if (ok && picks.length === 0 && other === null) {
    fault(at, "an answer must pick an option or write one in; leave a question out to skip it");
    ok = false;
  }
  return ok ? { picks, other } : null;
}

/** Read a map of answers — a ballot's, or a decision's. Null when it is not a map at all. */
function readAnswers(
  value: unknown,
  key: string,
  nav: NavDoc,
  problems: Problem[],
): Answers | null {
  const fault = (path: Path, message: string): void => {
    problems.push({ key, message: `${where(path)}: ${message}` });
  };
  if (!isMap(value)) {
    problems.push({ key, message: `'${key}' must be a map of answers by question ID` });
    return null;
  }
  const answers: Answers = new Map();
  for (const [qid, raw] of Object.entries(value)) {
    if (!SLUG_PATTERN.test(qid)) {
      fault([key], `'${qid}' is not a question ID`);
      continue;
    }
    const answer = readAnswer(raw, [key, qid], nav, fault);
    if (answer !== null) answers.set(qid, answer);
  }
  return answers;
}

/* ------------------------------------------------------------------- polls */

/** Read `poll.md`'s frontmatter defensively; {@link validatePoll} says which values were bad. */
export function readPoll(parsed: ParsedFile): PollFields {
  const fm = parsed.fm;
  const nav = parsed.nav;
  const text = (key: string): string | null => {
    const value = fm[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  const results = fm.results;
  const closed = text("closed");
  const ignored: Problem[] = [];
  return {
    title: text("title") ?? "",
    author: text("author") ?? "",
    created: text("created") ?? "",
    results: results === "visible" ? "visible" : "hidden",
    deadline: core.readDeadline(fm),
    questions: readQuestions(fm.questions, nav, ignored, true),
    closed: closed !== null && core.parseIso(closed) !== null ? closed : null,
    closedBy: text("closed-by"),
    decision:
      fm.decision === undefined || fm.decision === null
        ? null
        : readAnswers(fm.decision, "decision", nav, ignored),
    decisionNote: text("decision-note"),
  };
}

/**
 * Validate a `poll.md` (§3): its frontmatter, every question, and — when it is
 * closed — that the decision answers questions it has, as a ballot would
 * (§3.2).
 */
export function validatePoll(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  const fm = parsed.fm;
  const title = core.requireString(parsed, "title", problems);
  if (title !== null && /[\r\n]/.test(title))
    problems.push({ key: "title", message: "'title' must be on one line" });
  core.checkPerson(parsed, "author", problems);
  core.checkTimestamp(parsed, "created", problems);
  core.checkNoStatusKey(parsed, problems);
  checkResultsAndDeadline(fm, problems);
  const questions = readQuestions(fm.questions, parsed.nav, problems, true);

  const present = (key: string): boolean => fm[key] !== undefined && fm[key] !== null;
  if (present("closed")) {
    core.checkTimestamp(parsed, "closed", problems);
    if (!present("closed-by"))
      problems.push({
        key: "closed-by",
        message: "a closed poll must say who closed it: 'closed-by'",
      });
  }
  if (present("closed-by")) {
    if (!present("closed"))
      problems.push({
        key: "closed-by",
        message: "'closed-by' without 'closed': the poll is not closed",
      });
    else core.checkPerson(parsed, "closed-by", problems);
  }
  for (const key of ["decision", "decision-note"] as const) {
    if (present(key) && !present("closed"))
      problems.push({
        key,
        message: `'${key}' without 'closed': only a closed poll has a decision`,
      });
  }
  if (present("decision-note") && typeof fm["decision-note"] !== "string")
    problems.push({ key: "decision-note", message: "'decision-note' must be a string" });
  if (present("decision")) {
    const decision = readAnswers(fm.decision, "decision", parsed.nav, problems);
    if (decision !== null) {
      for (const message of answersFaults(questions, decision))
        problems.push({ key: "decision", message: `decision: ${message}` });
    }
  }
  return problems;
}

function checkResultsAndDeadline(fm: Record<string, unknown>, problems: Problem[]): void {
  const results = fm.results;
  if (
    results !== undefined &&
    results !== null &&
    !(RESULTS as readonly unknown[]).includes(results)
  ) {
    problems.push({
      key: "results",
      message: `'results' must be ${RESULTS.join(" or ")}, got ${JSON.stringify(results)}`,
    });
  }
  const deadline = fm.deadline;
  if (
    deadline !== undefined &&
    deadline !== null &&
    (typeof deadline !== "string" || !core.isCalendarDate(deadline))
  ) {
    problems.push({
      key: "deadline",
      message: `'deadline' must be a calendar date as YYYY-MM-DD, got ${JSON.stringify(deadline)}`,
    });
  }
}

/**
 * What is wrong with answers to these questions (§4.1, the half that needs the
 * poll): a question or option it does not have, a write-in it does not accept,
 * and the wrong number of answers for its kind.
 */
export function answersFaults(questions: readonly PollQuestion[], answers: Answers): string[] {
  const faults: string[] = [];
  for (const [qid, answer] of answers) {
    const question = questions.find((candidate) => candidate.id === qid);
    if (question === undefined) {
      faults.push(`'${qid}' is not a question of this poll`);
      continue;
    }
    faults.push(...answerFaults(question, answer));
  }
  return faults;
}

/** What is wrong with one answer to one question. */
export function answerFaults(question: PollQuestion, answer: Answer): string[] {
  const faults: string[] = [];
  const named = `question '${question.id}'`;
  answer.picks.forEach((pick, index) => {
    if (!question.options.some((option) => option.id === pick))
      faults.push(`'${pick}' is not an option of ${named}`);
    else if (answer.picks.indexOf(pick) !== index) faults.push(`'${pick}' is picked twice`);
  });
  if (answer.other !== null) {
    if (!question.other) faults.push(`${named} does not accept an answer in other words`);
    else {
      const fault = lineFault(answer.other, `the answer in other words to ${named}`);
      if (fault !== null) faults.push(fault);
    }
  }
  const count = answer.picks.length + (answer.other === null ? 0 : 1);
  if (count === 0) faults.push(`${named} is answered with nothing; leave it out to skip it`);
  else if (!question.multi && count > 1)
    faults.push(`${named} takes one answer: one option, or one answer in other words`);
  return faults;
}

/* ------------------------------------------------------------------ drafts */

/** A poll as somebody describes a new one, or a new version of one: IDs optional. */
export interface PollDraft {
  title: string;
  preamble: string;
  results: Results | null;
  deadline: string | null;
  questions: DraftQuestion[];
}

export interface DraftQuestion {
  id?: string | null;
  text: string;
  multi?: boolean | null;
  other?: boolean | null;
  options: { id?: string | null; label: string; description?: string | null }[];
}

/**
 * Read a draft from text shaped like `poll.md` (§3): a tool fills in `author`
 * and `created`, and the IDs left out. Returns the faults instead when there
 * are any, including keys only closing a poll may write.
 */
export function draftFromParsed(parsed: ParsedFile): PollDraft | { problems: Problem[] } {
  const problems = validatePollDraft(parsed);
  if (problems.length > 0) return { problems };
  const fm = parsed.fm;
  const questions = readQuestions(fm.questions, parsed.nav, [], false);
  return {
    title: fm.title as string,
    preamble: parsed.body,
    results: fm.results === undefined || fm.results === null ? null : (fm.results as Results),
    deadline: core.readDeadline(fm),
    questions: questions.map((question) => ({
      id: question.id === "" ? null : question.id,
      text: question.text,
      multi: question.multi,
      other: question.other,
      options: question.options.map((option) => ({
        id: option.id === "" ? null : option.id,
        label: option.label,
        description: option.description,
      })),
    })),
  };
}

/**
 * Validate text shaped like `poll.md` as a draft: what {@link validatePoll}
 * checks, less `author` and `created` (a tool writes those) and with IDs
 * optional; and none of the keys closing writes.
 */
export function validatePollDraft(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  const title = core.requireString(parsed, "title", problems);
  if (title !== null && /[\r\n]/.test(title))
    problems.push({ key: "title", message: "'title' must be on one line" });
  core.checkNoStatusKey(parsed, problems);
  checkResultsAndDeadline(parsed.fm, problems);
  readQuestions(parsed.fm.questions, parsed.nav, problems, false);
  for (const key of CLOSING_KEYS) {
    if (parsed.fm[key] !== undefined && parsed.fm[key] !== null)
      problems.push({
        key,
        message: `'${key}' is written by closing a poll, not by describing one`,
      });
  }
  return problems;
}

/**
 * A draft's questions as a poll holds them: every ID filled in (§3.1), and
 * the whole checked as `poll.md` will be.
 *
 * A question left without one is `q<n>`, by position; an option, its label as
 * a slug, or `o<n>` when the label has nothing a slug can keep. Either takes a
 * `-2`, `-3`… when that is already taken. IDs that were given are kept, and
 * are never what a filled-in one is made to avoid colliding with by changing
 * them.
 */
export function completeQuestions(draft: readonly DraftQuestion[]): PollQuestion[] {
  const questionIds = new Set(draft.map((question) => question.id ?? "").filter((id) => id !== ""));
  return draft.map((question, q) => {
    const optionIds = new Set(
      question.options.map((option) => option.id ?? "").filter((id) => id !== ""),
    );
    const options = question.options.map((option, o) => ({
      id: option.id || unique(optionBase(option.label, o), optionIds),
      label: option.label.trim(),
      description: descriptionOf(option.description),
    }));
    return {
      id: question.id || unique(`q${q + 1}`, questionIds),
      text: question.text.trim(),
      multi: question.multi === true,
      other: question.other === true,
      options,
    };
  });
}

/** The longest an ID made from a label is. */
const MAX_DERIVED_ID = 32;

function optionBase(label: string, index: number): string {
  const folded = label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_DERIVED_ID)
    .replace(/-+$/, "");
  return slug === "" ? `o${index + 1}` : slug;
}

/** `base`, or `base-2`, `base-3`… — the first not in `taken`, which it is added to. */
function unique(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** The questions as YAML holds them: defaults left out, so a file says only what it means. */
function questionsYaml(questions: readonly PollQuestion[]): unknown[] {
  return questions.map((question) => ({
    id: question.id,
    text: question.text,
    ...(question.multi ? { multi: true } : {}),
    ...(question.other ? { other: true } : {}),
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.description === null ? {} : { description: option.description }),
    })),
  }));
}

/** The body of a poll or a vote: Markdown, with one blank line after the frontmatter. */
function bodyOf(text: string): string {
  const body = bodyText(text);
  return body === "" ? "" : `\n${body}\n`;
}

/**
 * A body's text as a reader shows it: without the blank lines that separate it
 * from the frontmatter, or trailing whitespace. Indentation on its first line
 * is the author's, and is kept.
 */
export function bodyText(body: string): string {
  return body.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/** Render a new `poll.md`, its question and option IDs filled in. */
export function newPollFile(draft: PollDraft, stamp: { author: string; created: string }): string {
  const questions = completeQuestions(draft.questions);
  const nav = core.emptyDoc();
  core.patchDoc(nav, {
    title: draft.title.trim(),
    author: stamp.author,
    created: stamp.created,
    results: draft.results ?? "hidden",
    ...(draft.deadline === null ? {} : { deadline: draft.deadline }),
    questions: questionsYaml(questions),
  });
  nav.body = bodyOf(draft.preamble);
  return core.serializeDoc(nav);
}

/**
 * What an edit changes; a field left out is left as it is. `null` removes
 * `results` (back to `hidden`) and `deadline`.
 */
export interface PollChanges {
  title?: string;
  preamble?: string;
  results?: Results | null;
  deadline?: string | null;
  questions?: readonly DraftQuestion[];
}

/**
 * A poll's text with changes applied: its frontmatter patched in place, so a
 * key a later revision of this format adds survives (02 §2.4), and the body
 * replaced when a preamble is given. Questions are rewritten only when given:
 * a change to the title alone must not reformat them.
 */
export function rewritePoll(text: string, changes: PollChanges): string {
  const nav = core.parseDoc(text);
  const patch: Record<string, unknown> = {};
  if (changes.title !== undefined) patch.title = changes.title.trim();
  if (changes.results !== undefined) patch.results = changes.results ?? undefined;
  if (changes.deadline !== undefined) patch.deadline = changes.deadline ?? undefined;
  if (changes.questions !== undefined)
    patch.questions = questionsYaml(completeQuestions(changes.questions));
  core.patchDoc(nav, patch);
  if (changes.preamble !== undefined) nav.body = bodyOf(changes.preamble);
  return core.serializeDoc(nav);
}

/** A poll's text closed (§3.2): who, when, and what it came to. */
export function closedPoll(
  text: string,
  close: { at: string; by: string; decision: Answers; note: string | null },
): string {
  const nav = core.parseDoc(text);
  const note = bodyText(close.note ?? "");
  core.patchDoc(nav, {
    closed: close.at,
    "closed-by": close.by,
    decision: close.decision.size === 0 ? undefined : answersYaml(close.decision),
    "decision-note": note === "" ? undefined : note,
  });
  return core.serializeDoc(nav);
}

/** A poll's text reopened (§3.2): the keys closing wrote, gone. */
export function reopenedPoll(text: string): string {
  const nav = core.parseDoc(text);
  core.patchDoc(nav, Object.fromEntries(CLOSING_KEYS.map((key) => [key, undefined])));
  return core.serializeDoc(nav);
}

function answersYaml(answers: Answers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [qid, answer] of answers) {
    out[qid] = {
      picks: [...answer.picks],
      ...(answer.other === null ? {} : { other: answer.other }),
    };
  }
  return out;
}

/* ------------------------------------------------------------------- votes */

/** Read a vote's frontmatter defensively; {@link validateVote} says which values were bad. */
export function readVote(parsed: ParsedFile): VoteFields {
  const fm = parsed.fm;
  const fingerprint = fingerprintOf(parsed);
  return {
    author: typeof fm.author === "string" ? fm.author : "",
    fingerprint:
      typeof fingerprint === "string" && FINGERPRINT.test(fingerprint) ? fingerprint : "",
    answers: isMap(fm.answers) ? readAnswers(fm.answers, "answers", parsed.nav, []) : null,
  };
}

/**
 * A vote's `fingerprint` as written. Sixteen hexadecimal digits can be all
 * decimal ones, or read as a float (`12e4…`), and YAML would make a number of
 * them; the text is what was meant (§3.1).
 */
function fingerprintOf(parsed: ParsedFile): unknown {
  return textAt(parsed.fm.fingerprint, ["fingerprint"], parsed.nav) ?? parsed.fm.fingerprint;
}

/**
 * Validate a vote (§4): what can be judged from the file alone. What needs the
 * poll's questions is {@link answersFaults}, applied by the reader only when
 * the fingerprint says the questions are the ones it answered.
 */
export function validateVote(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  const fm = parsed.fm;
  core.checkPerson(parsed, "author", problems);
  const fingerprint = fingerprintOf(parsed);
  if (fingerprint === undefined || fingerprint === null) {
    problems.push({ key: "fingerprint", message: "missing required key 'fingerprint'" });
  } else if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) {
    problems.push({
      key: "fingerprint",
      message: `'fingerprint' must be 16 lowercase hexadecimal digits, got ${JSON.stringify(fingerprint)}`,
    });
  }
  if (fm.answers === undefined || fm.answers === null) {
    problems.push({
      key: "answers",
      message: "missing required key 'answers'; '{}' withdraws a vote",
    });
  } else readAnswers(fm.answers, "answers", parsed.nav, problems);
  core.checkNoStatusKey(parsed, problems);
  return problems;
}

/** Render a vote. */
export function newVoteFile(input: {
  author: string;
  fingerprint: string;
  answers: Answers;
  note: string;
}): string {
  const nav = core.emptyDoc();
  core.patchDoc(nav, {
    author: input.author,
    fingerprint: input.fingerprint,
    answers: answersYaml(input.answers),
  });
  nav.body = bodyOf(input.note);
  return core.serializeDoc(nav);
}

/* ------------------------------------------------------------- fingerprint */

/**
 * JSON with object keys sorted by UTF-16 code units and no whitespace: RFC 8785
 * restricted to the values a fingerprint is taken of — objects, arrays,
 * strings and booleans (§5).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isMap(value)) {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  throw new TypeError(`no canonical JSON for ${typeof value}`);
}

/** The fingerprint of a poll's questions (§5). */
export function fingerprint(questions: readonly PollQuestion[]): string {
  const normal = questions.map((question) => ({
    id: question.id,
    text: question.text,
    multi: question.multi,
    other: question.other,
    options: question.options.map((option) =>
      option.description === null || option.description.trim() === ""
        ? { id: option.id, label: option.label }
        : { id: option.id, label: option.label, description: option.description },
    ),
  }));
  return createHash("sha256").update(canonicalJson(normal), "utf8").digest("hex").slice(0, 16);
}
