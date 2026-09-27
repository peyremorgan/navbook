/**
 * What one tracker commit did, said in the format's own terms.
 *
 * A pull request's branch carries tracker commits beside its code: the pull
 * request's own `pr.md`, the issue it closes, comments. A diff shows them as
 * renames and one-line frontmatter edits; this reads them back as the verbs
 * they were made with — "closed #ozzaoa36 as fixed" — so a front end can say
 * so without knowing the format.
 *
 * Nothing here guesses. The subject is read when it follows the grammar
 * `--commit` writes (`docsSubject`, and the older `nb: <verb> #<id>`); the
 * commit's own files are read always, both to find
 * the verb of a commit somebody wrote by hand and for the facts, which come
 * from comparing the record's frontmatter before and after. Two steps,
 * because this layer does no I/O: {@link trackerReads} says which files to
 * read, and {@link summariseTrackerCommit} reads what the caller fetched.
 *
 * Issues and pull requests only: those are the records the format defines.
 * A plugin's directories (a knowledge base's `specs/`) are its own, so a
 * commit that touches only those names no record here, and is shown by its
 * subject and its files.
 */

import { isOpinionated, parseFile } from "./files.ts";
import { parseDirName } from "./slug.ts";
import { ENTITY_DIR, type EntityKind } from "./tree.ts";

/** One thing the commit changed about its record, before and after. */
export interface TrackerFact {
  field: string;
  /** Null when the field was not set before. */
  before: string | null;
  /** Null when it is no longer set, or when the fact is only its name. */
  after: string | null;
}

export interface TrackerSummary {
  /**
   * `open`, `close`, `reopen`, `merge`, `edit`, `update`, `comment`,
   * `review`, `request review`, `delete`, `link` or `unlink`. Null when
   * neither the subject nor the files say, and the subject is then the best
   * description there is.
   */
  verb: string | null;
  kind: EntityKind;
  entity: string;
  /** The record's title after the commit, or before it for a deletion. */
  title: string | null;
  facts: TrackerFact[];
}

/** A changed file, as much of it as a summary reads. */
export interface TrackerFileChange {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
}

/** A file to read for a summary: at the commit's parent, or at the commit. */
export interface TrackerRead {
  side: "before" | "after";
  path: string;
}

/** Answers a {@link TrackerRead} with the file's text, or null. */
export type TrackerReader = (side: TrackerRead["side"], path: string) => string | null;

const MAIN_FILE: Record<EntityKind, string> = { issue: "issue.md", pr: "pr.md" };

/** The verbs `--commit` writes for an entity (`docsSubject`), and the old `nb:` ones. */
const ENTITY_VERBS = new Set([
  "open",
  "close",
  "reopen",
  "edit",
  "comment on",
  "review",
  "update",
  "merge",
  "request review",
  "delete",
  "link",
  "unlink",
]);

const ENTITY_SUBJECT = /^(?:docs\((issue|pr)\)|nb): (.+) #([a-z][a-z0-9]{7})$/;

/** Frontmatter keys that never change once written, so a fact would only repeat them. */
const QUIET_KEYS = new Set(["author", "created"]);

interface Location {
  kind: EntityKind;
  entity: string;
  /** The status directory. */
  status: string;
  /** The path inside the record's directory. */
  rest: string;
}

interface Touch {
  file: TrackerFileChange;
  before: Location | null;
  after: Location | null;
}

/** Where a path sits in the tree: which record, and where inside it. */
function locate(path: string, navDir: string): Location | null {
  const prefix = `${navDir}/`;
  if (!path.startsWith(prefix)) return null;
  let segments = path.slice(prefix.length).split("/");
  if (segments[0] === "archive") segments = segments.slice(2);
  const [root, second, third, ...more] = segments;
  if (second === undefined || third === undefined) return null;
  const kind = root === ENTITY_DIR.issue ? "issue" : root === ENTITY_DIR.pr ? "pr" : null;
  const dir = parseDirName(third);
  if (kind === null || dir === null || more.length === 0) return null;
  return { kind, entity: dir.id, status: second, rest: more.join("/") };
}

interface Subject {
  entity: string;
  /** Null when the words before the ID are not a verb `--commit` writes. */
  verb: string | null;
}

function parseSubject(subject: string): Subject | null {
  const entity = ENTITY_SUBJECT.exec(subject);
  if (entity) {
    const [, , words, id] = entity as unknown as [string, string | undefined, string, string];
    return {
      entity: id,
      verb: ENTITY_VERBS.has(words) ? (words === "comment on" ? "comment" : words) : null,
    };
  }
  return null;
}

const keyOf = (kind: EntityKind, entity: string): string => `${kind}:${entity}`;

/** The record a commit is about, and the files of it the commit touched. */
function primaryRecord(
  subject: string,
  files: readonly TrackerFileChange[],
  navDir: string,
): { parsed: Subject | null; kind: EntityKind; entity: string; touches: Touch[] } | null {
  const records = new Map<string, Touch[]>();
  for (const file of files) {
    const after = file.status === "deleted" ? null : locate(file.path, navDir);
    const before = file.status === "added" ? null : locate(file.oldPath ?? file.path, navDir);
    const where = after ?? before;
    if (where === null) continue;
    const key = keyOf(where.kind, where.entity);
    const list = records.get(key) ?? [];
    list.push({ file, before, after });
    records.set(key, list);
  }
  const parsed = parseSubject(subject);
  // The record the subject names, when the commit touched it; the first one
  // it touched otherwise.
  const named = [...records.keys()].find(
    (key) => parsed !== null && key.endsWith(`:${parsed.entity}`),
  );
  const key = named ?? records.keys().next().value;
  if (key === undefined) return null;
  const touches = records.get(key) as Touch[];
  const where = (touches[0]?.after ?? touches[0]?.before) as Location;
  return {
    parsed: named === undefined ? null : parsed,
    kind: where.kind,
    entity: where.entity,
    touches,
  };
}

/**
 * The main file's path after the commit, when the commit did not touch it:
 * the record's directory is known from any file inside it.
 */
function untouchedMain(kind: EntityKind, touches: readonly Touch[]): string | null {
  if (touches.some((t) => isMain(t.after, kind) || isMain(t.before, kind))) return null;
  const inside = touches.find((t) => t.after !== null);
  if (inside === undefined || inside.after === null) return null;
  const dir = inside.file.path.slice(0, inside.file.path.length - inside.after.rest.length);
  return `${dir}${MAIN_FILE[kind]}`;
}

const isMain = (where: Location | null, kind: EntityKind): boolean =>
  where !== null && where.rest === MAIN_FILE[kind];

const isComment = (where: Location | null): boolean => where?.rest.startsWith("comments/") === true;

/**
 * The files {@link summariseTrackerCommit} will ask for: the record's main
 * file on both sides of the commit, and each comment the commit added.
 */
export function trackerReads(
  subject: string,
  files: readonly TrackerFileChange[],
  navDir: string,
): TrackerRead[] {
  const record = primaryRecord(subject, files, navDir);
  if (record === null) return [];
  const reads: TrackerRead[] = [];
  for (const { file, before, after } of record.touches) {
    if (isMain(before, record.kind))
      reads.push({ side: "before", path: file.oldPath ?? file.path });
    if (isMain(after, record.kind)) reads.push({ side: "after", path: file.path });
    if (file.status === "added" && isComment(after)) reads.push({ side: "after", path: file.path });
  }
  // A comment leaves the main file alone; it is still where the title is.
  const untouched = untouchedMain(record.kind, record.touches);
  if (untouched !== null) reads.push({ side: "after", path: untouched });
  return reads;
}

/**
 * What a commit did to the tracker, from its subject, the tracker files it
 * changed (paths from the repository root) and the texts of the files
 * {@link trackerReads} named. Null when it touched no issue or pull request
 * — only the marker, say, or a plugin's files.
 */
export function summariseTrackerCommit(
  subject: string,
  files: readonly TrackerFileChange[],
  navDir: string,
  read: TrackerReader,
): TrackerSummary | null {
  const record = primaryRecord(subject, files, navDir);
  if (record === null) return null;
  const { kind, touches } = record;

  const main = touches.find((t) => isMain(t.after, kind) || isMain(t.before, kind));
  const beforeFm = main?.before
    ? frontmatterOf(read("before", main.file.oldPath ?? main.file.path))
    : null;
  const afterFm = main?.after ? frontmatterOf(read("after", main.file.path)) : null;

  const facts: TrackerFact[] = [];

  // The status is where the directory is, so a move is a fact of its own.
  const moved = touches.find((t) => t.before && t.after && t.before.status !== t.after.status);
  const from = moved?.before?.status ?? null;
  const to = moved?.after?.status ?? null;
  if (moved) facts.push({ field: "status", before: from, after: to });

  if (beforeFm !== null || afterFm !== null) facts.push(...frontmatterFacts(beforeFm, afterFm));

  const added = touches.filter((t) => t.file.status === "added" && isComment(t.after));
  const verdicts: string[] = [];
  for (const comment of added) {
    const verdict = frontmatterOf(read("after", comment.file.path))?.fm.verdict;
    if (isOpinionated(verdict) || verdict === "comment") verdicts.push(String(verdict));
  }
  for (const verdict of verdicts) facts.push({ field: "verdict", before: null, after: verdict });
  if (added.length > 1)
    facts.push({ field: "comments", before: null, after: `${added.length} added` });
  const carried = touches.filter(
    (t) =>
      t.file.status === "renamed" && isComment(t.after) && t.before?.status !== t.after?.status,
  ).length;
  if (carried > 0) facts.push({ field: "comments", before: null, after: `${carried} moved` });

  const derived = deriveVerb(main, to, added.length, verdicts.length, beforeFm, afterFm, touches);
  const untouched = untouchedMain(kind, touches);
  const current = untouched === null ? null : frontmatterOf(read("after", untouched));
  const title =
    text(afterFm?.fm.title) || text(beforeFm?.fm.title) || text(current?.fm.title) || null;

  return {
    verb: record.parsed?.verb ?? derived,
    kind,
    entity: record.entity,
    title,
    facts,
  };
}

interface Frontmatter {
  fm: Record<string, unknown>;
  body: string;
}

function frontmatterOf(source: string | null): Frontmatter | null {
  if (source === null) return null;
  try {
    const parsed = parseFile(source);
    return { fm: parsed.fm, body: parsed.body };
  } catch {
    return null;
  }
}

function deriveVerb(
  main: Touch | undefined,
  to: string | null,
  comments: number,
  verdicts: number,
  before: Frontmatter | null,
  after: Frontmatter | null,
  touches: readonly Touch[],
): string | null {
  if (main?.file.status === "added" || main?.file.status === "copied") return "open";
  if (main?.file.status === "deleted") return "delete";
  if (to === "closed") return "close";
  if (to === "open") return "reopen";
  if (to === "merged") return "merge";
  if (comments > 0) return verdicts > 0 ? "review" : "comment";
  if (main !== undefined) {
    const was = revisionCount(before?.fm.revisions);
    const is = revisionCount(after?.fm.revisions);
    return is > was ? "update" : "edit";
  }
  return touches.length > 0 ? "edit" : null;
}

function revisionCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Each frontmatter key whose value changed, and the body when it did. */
function frontmatterFacts(before: Frontmatter | null, after: Frontmatter | null): TrackerFact[] {
  const facts: TrackerFact[] = [];
  const keys = new Set([...Object.keys(before?.fm ?? {}), ...Object.keys(after?.fm ?? {})]);
  for (const key of keys) {
    if (QUIET_KEYS.has(key)) continue;
    // The title is shown with the summary; only a change to it is a fact.
    if (key === "title" && before === null) continue;
    // A new record's first revision is what opening it is, not news.
    if (key === "revisions" && before === null) continue;
    const was = show(key, before?.fm[key]);
    const is = show(key, after?.fm[key]);
    if (was !== is) facts.push({ field: key, before: was, after: is });
  }
  if (before === null && after !== null && after.body.trim() !== "") {
    const lines = after.body.trim().split("\n").length;
    facts.push({
      field: "description",
      before: null,
      after: `${lines} line${lines === 1 ? "" : "s"}`,
    });
  } else if (before !== null && after !== null && before.body !== after.body) {
    facts.push({ field: "description", before: null, after: "edited" });
  }
  return facts;
}

/** A frontmatter value as a short line of text, or null when unset. */
function show(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (key === "revisions" && Array.isArray(value)) return String(value.length);
  if (Array.isArray(value)) {
    const items = value.map((item) => scalar(item)).filter((item) => item !== null);
    return items.length === 0 ? null : items.join(", ");
  }
  return scalar(value);
}

function scalar(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // `merged:` and its like: who did it is the part worth a chip.
    const by = (value as Record<string, unknown>).by;
    return typeof by === "string" ? by : "set";
  }
  return String(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
