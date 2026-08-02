/**
 * The three Navbook file kinds — spec 02 §2.5 (`issue.md`), §2.6 (comments and
 * reviews) and §2.7 (`pr.md`): parsing, validation, and construction.
 *
 * Parsing never throws on schema problems; it collects them so `nav doctor` can
 * report every fault in a file at once.
 *
 * Frontmatter is normalized once, at parse time: keys whose spec type is a
 * string (or a list/map of strings) are read from the scalar's source text, so
 * a hand-written all-digit commit SHA — which YAML would resolve to a lossy
 * number — still round-trips as the forty characters the author typed.
 */

import {
  emptyDoc,
  hasKey,
  keysInOrder,
  type NavDoc,
  parseDoc,
  patchDoc,
  seqLength,
  serializeDoc,
  setFlowList,
  stringAt,
  toPlain,
} from "./frontmatter.ts";
import { isId } from "./id.ts";
import { formatPerson, parsePerson } from "./person.ts";
import { parseIso } from "./time.ts";

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const VERDICTS = ["approve", "request-changes"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Problem {
  key?: string;
  message: string;
}

export interface ParsedFile {
  nav: NavDoc;
  /** Frontmatter with spec-typed keys normalized; unknown keys passed through. */
  fm: Record<string, unknown>;
  /** Frontmatter exactly as the YAML parser resolved it. */
  raw: Record<string, unknown>;
  body: string;
  problems: Problem[];
}

export interface Revision {
  head: string;
  base: string;
  date: string;
}

/** Keys whose spec type is a single string-ish scalar. */
const STRING_KEYS = [
  "title",
  "author",
  "created",
  "target",
  "source",
  "milestone",
  "resolution",
  "duplicate-of",
  "superseded-by",
  "reply-to",
  "verdict",
  "revision",
  "file",
  "imported-from",
  "imported-at",
  "signature",
] as const;

/** Parse any Navbook file; frontmatter faults surface as problems, not throws. */
export function parseFile(text: string): ParsedFile {
  const nav = parseDoc(text);
  const problems: Problem[] = nav.errors.map((message) => ({
    message: `invalid YAML: ${message}`,
  }));
  // One conversion out of the YAML document, shared by both views of it.
  const raw = toPlain(nav);
  return { nav, fm: normalizeFrontmatter(nav, raw), raw, body: nav.body, problems };
}

/** Coerce spec-typed frontmatter keys; leave unknown keys exactly as parsed. */
export function normalizeFrontmatter(
  nav: NavDoc,
  parsed?: Record<string, unknown>,
): Record<string, unknown> {
  const raw = parsed ?? toPlain(nav);
  const out: Record<string, unknown> = {};
  for (const key of keysInOrder(nav)) {
    if (key === "") continue;
    out[key] = normalizeKey(nav, key, raw[key]);
  }
  return out;
}

function normalizeKey(nav: NavDoc, key: string, rawValue: unknown): unknown {
  if ((STRING_KEYS as readonly string[]).includes(key)) {
    return stringAt(nav, [key]) ?? rawValue;
  }
  if (key === "labels") return normalizeStringList(nav, key, rawValue);
  if (key === "assignee") {
    return Array.isArray(rawValue)
      ? normalizeStringList(nav, key, rawValue)
      : (stringAt(nav, [key]) ?? rawValue);
  }
  if (key === "revisions") return normalizeRevisions(nav, rawValue);
  if (key === "merged") return normalizeMerged(nav, rawValue);
  return rawValue;
}

function normalizeStringList(nav: NavDoc, key: string, rawValue: unknown): unknown {
  const length = seqLength(nav, [key]);
  if (length === null || !Array.isArray(rawValue)) return rawValue;
  return rawValue.map((item, index) => stringAt(nav, [key, index]) ?? item);
}

function normalizeRevisions(nav: NavDoc, rawValue: unknown): unknown {
  if (seqLength(nav, ["revisions"]) === null || !Array.isArray(rawValue)) return rawValue;
  return rawValue.map((item, index) => {
    if (!isPlainObject(item)) return item;
    const out: Record<string, unknown> = { ...item };
    for (const field of ["head", "base", "date"]) {
      if (out[field] === undefined) continue;
      out[field] = stringAt(nav, ["revisions", index, field]) ?? out[field];
    }
    return out;
  });
}

function normalizeMerged(nav: NavDoc, rawValue: unknown): unknown {
  if (!isPlainObject(rawValue)) return rawValue;
  const out: Record<string, unknown> = { ...rawValue };
  for (const field of ["date", "by", "commit"]) {
    if (out[field] === undefined) continue;
    out[field] = stringAt(nav, ["merged", field]) ?? out[field];
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ helpers */

function requireString(parsed: ParsedFile, key: string, problems: Problem[]): string | null {
  const value = parsed.fm[key];
  if (value === undefined || value === null) {
    if (hasKey(parsed.nav, key)) {
      problems.push({ key, message: `'${key}' must be a non-empty string` });
    } else {
      problems.push({ key, message: `missing required key '${key}'` });
    }
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    problems.push({ key, message: `'${key}' must be a non-empty string` });
    return null;
  }
  return value;
}

function checkOptionalString(parsed: ParsedFile, key: string, problems: Problem[]): void {
  const value = parsed.fm[key];
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.trim() === "") {
    problems.push({ key, message: `'${key}' must be a non-empty string` });
  }
}

function checkPerson(parsed: ParsedFile, key: string, problems: Problem[]): void {
  const value = requireString(parsed, key, problems);
  if (value === null) return;
  if (!parsePerson(value)) {
    problems.push({
      key,
      message: `'${key}' must be an RFC 5322 address, got ${JSON.stringify(value)}`,
    });
  }
}

function checkTimestamp(parsed: ParsedFile, key: string, problems: Problem[]): void {
  const value = requireString(parsed, key, problems);
  if (value === null) return;
  if (!parseIso(value)) {
    problems.push({
      key,
      message: `'${key}' must be an ISO 8601 timestamp, got ${JSON.stringify(value)}`,
    });
  }
}

function checkLabels(parsed: ParsedFile, problems: Problem[]): void {
  const value = parsed.fm.labels;
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.trim() === "")) {
    problems.push({ key: "labels", message: "'labels' must be a list of non-empty strings" });
  }
}

function checkAssignee(parsed: ParsedFile, problems: Problem[]): void {
  const value = parsed.fm.assignee;
  if (value === undefined || value === null) return;
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length === 0) {
    problems.push({ key: "assignee", message: "'assignee' must be a person or list of persons" });
    return;
  }
  for (const entry of entries) {
    if (typeof entry !== "string" || !parsePerson(entry)) {
      problems.push({ key: "assignee", message: "'assignee' must be a person or list of persons" });
      return;
    }
  }
}

function checkIdReference(parsed: ParsedFile, key: string, problems: Problem[]): void {
  const value = parsed.fm[key];
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !isId(value)) {
    problems.push({ key, message: `'${key}' must be a Navbook ID` });
  }
}

function checkNoStatusKey(parsed: ParsedFile, problems: Problem[]): void {
  if (hasKey(parsed.nav, "status")) {
    problems.push({
      key: "status",
      message: "entity files must not carry a 'status' key; status is the path (§2.1)",
    });
  }
}

/** Read `labels` defensively, ignoring malformed entries. */
export function readLabels(fm: Record<string, unknown>): string[] {
  const value = fm.labels;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Read `assignee` (scalar or list) defensively. */
export function readAssignees(fm: Record<string, unknown>): string[] {
  const value = fm.assignee;
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((v): v is string => typeof v === "string");
}

/** Read `revisions` defensively, keeping only well-formed entries. */
export function readRevisions(fm: Record<string, unknown>): Revision[] {
  const value = fm.revisions;
  if (!Array.isArray(value)) return [];
  const out: Revision[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (
      typeof entry.head === "string" &&
      typeof entry.base === "string" &&
      typeof entry.date === "string"
    ) {
      out.push({ head: entry.head, base: entry.base, date: entry.date });
    }
  }
  return out;
}

/** Read the `merged:` block defensively. */
export function readMerged(fm: Record<string, unknown>): Record<string, unknown> | null {
  return isPlainObject(fm.merged) ? fm.merged : null;
}

/* --------------------------------------------------------------- validation */

/** Validate an `issue.md` (§2.5). */
export function validateIssue(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  requireString(parsed, "title", problems);
  checkPerson(parsed, "author", problems);
  checkTimestamp(parsed, "created", problems);
  checkLabels(parsed, problems);
  checkAssignee(parsed, problems);
  checkOptionalString(parsed, "milestone", problems);
  checkOptionalString(parsed, "resolution", problems);
  checkIdReference(parsed, "duplicate-of", problems);
  checkNoStatusKey(parsed, problems);
  if (parsed.body.trim() === "") {
    problems.push({ message: "issue description must not be empty (§2.5)" });
  }
  return problems;
}

/** Validate a `pr.md` (§2.7). */
export function validatePr(parsed: ParsedFile): Problem[] {
  const problems = [...parsed.problems];
  requireString(parsed, "title", problems);
  checkPerson(parsed, "author", problems);
  checkTimestamp(parsed, "created", problems);
  requireString(parsed, "target", problems);
  checkOptionalString(parsed, "source", problems);
  checkLabels(parsed, problems);
  checkAssignee(parsed, problems);
  checkOptionalString(parsed, "milestone", problems);
  checkOptionalString(parsed, "resolution", problems);
  checkIdReference(parsed, "superseded-by", problems);
  checkNoStatusKey(parsed, problems);
  if (parsed.fm.draft !== undefined && typeof parsed.fm.draft !== "boolean") {
    problems.push({ key: "draft", message: "'draft' must be a boolean" });
  }
  validateRevisions(parsed, problems);
  validateMergedBlock(parsed, problems);
  return problems;
}

function validateRevisions(parsed: ParsedFile, problems: Problem[]): void {
  const value = parsed.fm.revisions;
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({
      key: "revisions",
      message: "'revisions' must be a list with at least one entry (§2.7)",
    });
    return;
  }
  value.forEach((entry, index) => {
    const where = `revisions[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push({ key: "revisions", message: `${where} must be a map` });
      return;
    }
    for (const field of ["head", "base"] as const) {
      const sha = entry[field];
      if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
        problems.push({
          key: "revisions",
          message: `${where}.${field} must be a 40-hex commit SHA`,
        });
      }
    }
    if (typeof entry.date !== "string" || !parseIso(entry.date)) {
      problems.push({ key: "revisions", message: `${where}.date must be an ISO 8601 timestamp` });
    }
  });
}

function validateMergedBlock(parsed: ParsedFile, problems: Problem[]): void {
  const value = parsed.fm.merged;
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    problems.push({ key: "merged", message: "'merged' must be a map of date, by and commit" });
    return;
  }
  if (value.date !== undefined && (typeof value.date !== "string" || !parseIso(value.date))) {
    problems.push({ key: "merged", message: "'merged.date' must be an ISO 8601 timestamp" });
  }
  if (value.by !== undefined && (typeof value.by !== "string" || !parsePerson(value.by))) {
    problems.push({ key: "merged", message: "'merged.by' must be an RFC 5322 address" });
  }
  if (
    value.commit !== undefined &&
    (typeof value.commit !== "string" || !SHA_PATTERN.test(value.commit))
  ) {
    problems.push({ key: "merged", message: "'merged.commit' must be a 40-hex commit SHA" });
  }
}

/** Validate a comment file (§2.6), including the optional review fields. */
export function validateComment(parsed: ParsedFile, opts: { onPr: boolean }): Problem[] {
  const problems = [...parsed.problems];
  const { fm } = parsed;
  checkPerson(parsed, "author", problems);
  checkIdReference(parsed, "reply-to", problems);

  const hasVerdict = fm.verdict !== undefined && fm.verdict !== null;
  const hasFile = fm.file !== undefined && fm.file !== null;

  if (hasVerdict && !VERDICTS.includes(fm.verdict as Verdict)) {
    problems.push({ key: "verdict", message: `'verdict' must be one of ${VERDICTS.join(" | ")}` });
  }
  if (hasFile && (typeof fm.file !== "string" || fm.file.trim() === "")) {
    problems.push({ key: "file", message: "'file' must be a repository-relative path" });
  }
  if (fm.line !== undefined && fm.line !== null && !isValidLine(fm.line)) {
    problems.push({ key: "line", message: "'line' must be an integer or a 'start-end' range" });
  }
  if (hasVerdict || hasFile) {
    if (typeof fm.revision !== "string" || !SHA_PATTERN.test(fm.revision)) {
      problems.push({
        key: "revision",
        message: "'revision' (40-hex SHA) is required when 'verdict' or 'file' is present (§2.6)",
      });
    }
    if (!opts.onPr) {
      problems.push({
        message: "review fields are only meaningful on pull-request comments (§2.6)",
      });
    }
  } else if (fm.revision !== undefined && fm.revision !== null) {
    if (typeof fm.revision !== "string" || !SHA_PATTERN.test(fm.revision)) {
      problems.push({ key: "revision", message: "'revision' must be a 40-hex commit SHA" });
    }
  }
  return problems;
}

function isValidLine(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value > 0;
  if (typeof value !== "string") return false;
  const match = /^(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (!match) return false;
  const start = Number(match[1]);
  if (start <= 0) return false;
  if (match[2] === undefined) return true;
  return Number(match[2]) >= start;
}

/* ------------------------------------------------------------- construction */

export interface NewIssueInput {
  title: string;
  author: string;
  created: string;
  body: string;
  labels?: string[];
  assignee?: string[];
  milestone?: string;
}

/** Render a new `issue.md`. */
export function newIssueFile(input: NewIssueInput): string {
  const nav = emptyDoc();
  patchDoc(nav, { title: input.title, author: input.author, created: input.created });
  applyOptionalMeta(nav, input);
  nav.body = `\n${normalizeBody(input.body)}`;
  return serializeDoc(nav);
}

export interface NewPrInput extends NewIssueInput {
  target: string;
  source: string;
  revisions: Revision[];
  draft?: boolean;
}

/** Render a new `pr.md`. */
export function newPrFile(input: NewPrInput): string {
  const nav = emptyDoc();
  patchDoc(nav, {
    title: input.title,
    author: input.author,
    created: input.created,
    target: input.target,
    source: input.source,
  });
  if (input.draft) patchDoc(nav, { draft: true });
  applyOptionalMeta(nav, input);
  patchDoc(nav, { revisions: input.revisions });
  nav.body = `\n${normalizeBody(input.body)}`;
  return serializeDoc(nav);
}

function applyOptionalMeta(nav: NavDoc, input: NewIssueInput): void {
  if (input.labels?.length) setFlowList(nav, "labels", input.labels);
  if (input.assignee?.length) {
    if (input.assignee.length === 1) patchDoc(nav, { assignee: input.assignee[0] });
    else setFlowList(nav, "assignee", input.assignee);
  }
  if (input.milestone) patchDoc(nav, { milestone: input.milestone });
}

export interface NewCommentInput {
  author: string;
  body: string;
  replyTo?: string;
  verdict?: Verdict;
  revision?: string;
  file?: string;
  line?: string;
}

/** Render a new comment or review file. */
export function newCommentFile(input: NewCommentInput): string {
  const nav = emptyDoc();
  patchDoc(nav, { author: input.author });
  if (input.replyTo) patchDoc(nav, { "reply-to": input.replyTo });
  if (input.verdict) patchDoc(nav, { verdict: input.verdict });
  if (input.revision) patchDoc(nav, { revision: input.revision });
  if (input.file) patchDoc(nav, { file: input.file });
  if (input.line) patchDoc(nav, { line: normalizeLine(input.line) });
  nav.body = `\n${normalizeBody(input.body)}`;
  return serializeDoc(nav);
}

function normalizeLine(line: string): string | number {
  const trimmed = line.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** Trim trailing whitespace and guarantee exactly one closing newline. */
export function normalizeBody(body: string): string {
  const trimmed = body.replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/** Format a person for frontmatter, falling back to the bare address. */
export function formatAuthor(name: string | undefined, email: string): string {
  return formatPerson(name ? { name, email } : { email });
}
