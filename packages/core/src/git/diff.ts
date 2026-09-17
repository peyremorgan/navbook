/**
 * What a pull request's revision changes, read from the two SHAs it pins.
 *
 * A revision names `head` and `base`, and `base` is the merge base with the
 * target *at that time* (spec 02 §2.7). So `git diff base head` is exactly the
 * three-dot diff a forge shows for a pull request, and it stays right after the
 * target moves on: nothing the target gained since is in it, and nothing the
 * branch did is left out. The commits are `base..head` for the same reason.
 *
 * Both answers are functions of two immutable objects, which is why nothing
 * here looks at HEAD, the index or the working tree, and why a caller may
 * remember an answer for as long as it likes under the pair that produced it.
 *
 * Git writes the patch; this file reads it. The unified format is parsed here
 * rather than in a client so that the record a client gets — one per file,
 * with its status, its counts and its hunks — is the same whichever client
 * asks, and so that the one place that knows what `rename from` means is next
 * to the one place that runs `git diff`.
 */

import { type GitAsyncOptions, GitError, git, gitRun, gitRunAsync } from "./exec.ts";
import { COMMIT_LOG_ARGS, type CommitSummary, parseCommitLog } from "./history.ts";

/**
 * A budget for the patch itself, sized so that a diff git takes a second to
 * produce fits. Beyond it the caller gets an error, and the file listing is
 * the thing to ask for instead.
 */
const PATCH_MAX_BUFFER = 256 * 1024 * 1024;

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

/** One file of a diff, as git reports it. */
export interface ChangedFile {
  /** Path after the change; for a deleted file, the path it had. */
  path: string;
  /** Where a renamed or copied file came from; null otherwise. */
  oldPath: string | null;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /**
   * The hunks, from the first `@@` to the end of the file's entry, without
   * the `diff --git` header and the `---`/`+++` lines. Empty for a binary
   * file, a pure rename, a mode change, and when patches were not asked for.
   */
  patch: string;
  /**
   * How many lines `patch` holds, so a size decision needs no second pass.
   * When patches were not read, a lower bound: the additions and deletions.
   */
  lines: number;
}

export interface Diff {
  base: string;
  head: string;
  /** In git's order: by path, with tracker files wherever they sort. */
  files: ChangedFile[];
  additions: number;
  deletions: number;
}

export interface DiffOptions extends Pick<GitAsyncOptions, "timeoutMs"> {
  /**
   * Whether to read the hunks at all.
   *
   * `false` asks git for its raw and numstat listings only — one short line
   * per file — which is what makes a listing of thousands of files cheap
   * enough to answer even where the patch itself would not fit in memory.
   */
  patches?: boolean;
  /** Limit to these paths; the whole diff otherwise. */
  paths?: readonly string[];
}

export interface CommitRange {
  /** How many commits `base..head` holds, whatever the limit kept. */
  total: number;
  /** Oldest first, which is the order they were made in. */
  commits: CommitSummary[];
}

/**
 * The commits a revision introduces: `base..head`, oldest first.
 *
 * One walk with no `-n`: git applies a limit before it reverses, so limiting
 * here is what keeps the oldest rather than the newest. The whole walk is
 * cheap — a line per commit — and a range with more commits than fit in the
 * default buffer is not a pull request. Throws a `GitError` when git cannot
 * walk the range, which a caller must not mistake for an empty one.
 */
export function commitsBetween(
  cwd: string,
  base: string,
  head: string,
  limit?: number,
): CommitRange {
  const args = commitsArgs(base, head);
  const result = gitRun(args, { cwd });
  if (result.code !== 0) throw new GitError(args, result);
  return limitRange(parseCommitLog(result.stdout), limit);
}

/** {@link commitsBetween}, without blocking. */
export async function commitsBetweenAsync(
  cwd: string,
  base: string,
  head: string,
  limit?: number,
): Promise<CommitRange> {
  const args = commitsArgs(base, head);
  const result = await gitRunAsync(args, { cwd });
  if (result.code !== 0) throw new GitError(args, result);
  return limitRange(parseCommitLog(result.stdout), limit);
}

function commitsArgs(base: string, head: string): string[] {
  return ["log", "--reverse", ...COMMIT_LOG_ARGS, `${base}..${head}`];
}

function limitRange(commits: CommitSummary[], limit: number | undefined): CommitRange {
  return {
    total: commits.length,
    commits: limit === undefined ? commits : commits.slice(0, limit),
  };
}

/**
 * The arguments every diff here is run with.
 *
 * The prefixes and the quoting are pinned rather than inherited, because the
 * parser reads them: a clone with `diff.noprefix` or `diff.mnemonicPrefix` set
 * would otherwise change what a header line says. `core.quotePath=false`
 * leaves a non-ASCII path readable; a path with a control character or a
 * quote in it is still quoted, and {@link unquote} reads that. No external
 * diff driver, no textconv: what is wanted is the change, not a rendering of
 * it somebody configured for their terminal.
 */
function diffArgs(base: string, head: string, opts: DiffOptions): string[] {
  const args = [
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ];
  if (opts.patches === false) args.push("--raw", "--numstat", "-z");
  else args.push("--unified=3");
  args.push(base, head);
  // Literal, because a path is what the listing said and not a pattern: a
  // name beginning with `:` would otherwise be read as pathspec magic.
  if (opts.paths?.length) args.push("--", ...opts.paths.map((path) => `:(literal)${path}`));
  return args;
}

function toDiff(base: string, head: string, files: ChangedFile[]): Diff {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { base, head, files, additions, deletions };
}

/**
 * What `head` changes against `base`, without blocking.
 *
 * The async runner is the one a server wants: a diff of a large branch is the
 * better part of a second of git's time, and a server that spent it blocked
 * would spend every other request's latency with it. Throws a `GitError` when
 * git refuses — an object it does not have, most likely — and whatever the
 * runner throws when the patch outgrows its buffer or its time.
 */
export async function diffBetweenAsync(
  cwd: string,
  base: string,
  head: string,
  opts: DiffOptions = {},
): Promise<Diff> {
  const args = diffArgs(base, head, opts);
  const result = await gitRunAsync(args, {
    cwd,
    maxBuffer: PATCH_MAX_BUFFER,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  if (result.code !== 0) throw new GitError(args, result);
  const files =
    opts.patches === false ? parseRawNumstat(result.stdout) : parseUnifiedDiff(result.stdout);
  return toDiff(base, head, files);
}

/** The blocking twin of {@link diffBetweenAsync}, for a process that has nothing else to do. */
export function diffBetween(cwd: string, base: string, head: string, opts: DiffOptions = {}): Diff {
  const output = git(diffArgs(base, head, opts), { cwd, maxBuffer: PATCH_MAX_BUFFER });
  const files = opts.patches === false ? parseRawNumstat(output) : parseUnifiedDiff(output);
  return toDiff(base, head, files);
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                  */
/* ------------------------------------------------------------------------ */

const FILE_HEADER = "diff --git ";

/**
 * Read a path as git prints it in a header.
 *
 * With `core.quotePath=false` git still quotes a path holding a control
 * character, a double quote or a backslash, in C style. Those are the escapes
 * read back here; an octal escape is a byte of UTF-8, so a run of them is
 * decoded as one.
 */
export function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  const out: string[] = [];
  const flush = (): void => {
    if (bytes.length === 0) return;
    out.push(Buffer.from(bytes).toString("utf8"));
    bytes.length = 0;
  };
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] as string;
    if (ch !== "\\") {
      flush();
      out.push(ch);
      continue;
    }
    const next = inner[i + 1] ?? "";
    if (/[0-7]/.test(next)) {
      const octal = inner.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      bytes.push(Number.parseInt(octal, 8));
      i += octal.length;
      continue;
    }
    flush();
    const simple: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      a: "",
      b: "\b",
      f: "\f",
      v: "\v",
      "\\": "\\",
      '"': '"',
    };
    out.push(simple[next] ?? next);
    i += 1;
  }
  flush();
  return out.join("");
}

/**
 * Strip the `a/` or `b/` git puts before a path in a `---`/`+++` line.
 *
 * A path holding a space is followed by a tab on those two lines — git's
 * courtesy to `patch(1)`, which would otherwise stop reading at the space —
 * so that is dropped first.
 */
function stripPrefix(raw: string): string {
  const path = unquote(raw.endsWith("\t") ? raw.slice(0, -1) : raw);
  return path.startsWith("a/") || path.startsWith("b/") ? path.slice(2) : path;
}

/** Where a quoted token that starts at `from` ends, or -1 when it does not. */
function closingQuote(text: string, from: number): number {
  for (let i = from + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === '"') return i;
  }
  return -1;
}

/**
 * The two paths of a `diff --git a/x b/y` line.
 *
 * A path may hold spaces, so the line is ambiguous in general. Where the two
 * paths are the same — every entry that is not a rename or copy — its length
 * says where the split is. A rename's paths come from its `rename from`/`to`
 * lines instead, and the header is left unread.
 */
function samePathOf(headerLine: string): string | null {
  const rest = headerLine.slice(FILE_HEADER.length);
  if (rest.startsWith('"')) {
    // Quoted, which git does to both halves when it does it to one: the
    // closing quote says where the first path ends, so no guessing is needed.
    const end = closingQuote(rest, 0);
    if (end === -1) return null;
    const left = unquote(rest.slice(0, end + 1));
    const right = unquote(rest.slice(end + 2));
    if (!left.startsWith("a/") || !right.startsWith("b/")) return null;
    return left.slice(2) === right.slice(2) ? left.slice(2) : null;
  }
  if ((rest.length - 5) % 2 !== 0) return null;
  const half = (rest.length - 5) / 2;
  const left = rest.slice(0, half + 2);
  const right = rest.slice(half + 3);
  if (!left.startsWith("a/") || !right.startsWith("b/")) return null;
  if (left.slice(2) !== right.slice(2)) return null;
  return unquote(left.slice(2));
}

interface Entry {
  header: string;
  /** The lines between the header and the first hunk (or the end). */
  meta: string[];
  /** From the first `@@` on, verbatim. */
  hunks: string[];
}

/** Split a unified diff into its per-file entries. */
function splitEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | null = null;
  let inHunks = false;
  for (const line of text.split("\n")) {
    if (line.startsWith(FILE_HEADER)) {
      current = { header: line, meta: [], hunks: [] };
      entries.push(current);
      inHunks = false;
      continue;
    }
    if (current === null) continue;
    if (!inHunks && line.startsWith("@@")) inHunks = true;
    if (inHunks) current.hunks.push(line);
    else current.meta.push(line);
  }
  // The split leaves a trailing empty string after the final newline.
  const last = entries.at(-1);
  if (last && last.hunks.at(-1) === "") last.hunks.pop();
  if (last && last.hunks.length === 0 && last.meta.at(-1) === "") last.meta.pop();
  return entries;
}

/**
 * One file's record from its entry.
 *
 * Status comes from the meta lines: `new file mode`, `deleted file mode`,
 * `rename from`/`copy from`; anything else is a modification, a mode change
 * included. Paths come from `rename to` / `copy to`, else from `+++`
 * (`---` for a deletion), else from the header when both its halves agree —
 * which covers a binary file and a mode-only change, neither of which has a
 * `+++` line.
 */
function fileOf(entry: Entry): ChangedFile {
  let status: ChangeStatus = "modified";
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let binary = false;
  for (const line of entry.meta) {
    if (line.startsWith("new file mode")) status = "added";
    else if (line.startsWith("deleted file mode")) status = "deleted";
    else if (line.startsWith("rename from ")) {
      status = "renamed";
      oldPath = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) newPath = unquote(line.slice("rename to ".length));
    else if (line.startsWith("copy from ")) {
      status = "copied";
      oldPath = unquote(line.slice("copy from ".length));
    } else if (line.startsWith("copy to ")) newPath = unquote(line.slice("copy to ".length));
    else if (line.startsWith("Binary files ")) binary = true;
    else if (line.startsWith("--- ") && status === "deleted")
      newPath ??= stripPrefix(line.slice(4));
    else if (line.startsWith("+++ ") && status !== "deleted" && newPath === null) {
      const target = line.slice(4);
      if (target !== "/dev/null") newPath = stripPrefix(target);
    }
  }
  const path = newPath ?? samePathOf(entry.header) ?? entry.header.slice(FILE_HEADER.length);

  let additions = 0;
  let deletions = 0;
  for (const line of entry.hunks) {
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  const patch = entry.hunks.length === 0 ? "" : `${entry.hunks.join("\n")}\n`;
  return {
    path,
    oldPath: status === "renamed" || status === "copied" ? oldPath : null,
    status,
    additions,
    deletions,
    binary,
    patch,
    lines: entry.hunks.length,
  };
}

/** Read what `git diff` printed, one record per file, in git's order. */
export function parseUnifiedDiff(text: string): ChangedFile[] {
  return splitEntries(text).map(fileOf);
}

/**
 * Read `--raw --numstat -z` output, which is the listing without the hunks.
 *
 * Git prints every raw record, then every numstat record, in the same order.
 * A raw record is `:oldmode newmode oldsha newsha S\0path\0`, with a second
 * path for a rename or copy (`R<score>`, `C<score>`); a numstat record is
 * `added\tdeleted\t\0path\0`, again with two paths for a rename, and `-` for
 * either count of a binary file.
 */
export function parseRawNumstat(text: string): ChangedFile[] {
  const fields = text.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const files: ChangedFile[] = [];
  let i = 0;
  // Raw records first: each starts with a colon.
  while (i < fields.length && (fields[i] as string).startsWith(":")) {
    const record = fields[i] as string;
    const code = record.split(" ")[4] ?? "M";
    const letter = code.charAt(0);
    if (letter === "R" || letter === "C") {
      const oldPath = fields[i + 1] ?? "";
      const path = fields[i + 2] ?? "";
      files.push({
        path,
        oldPath,
        status: letter === "R" ? "renamed" : "copied",
        additions: 0,
        deletions: 0,
        binary: false,
        patch: "",
        lines: 0,
      });
      i += 3;
    } else {
      const path = fields[i + 1] ?? "";
      const status: ChangeStatus =
        letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
      files.push({
        path,
        oldPath: null,
        status,
        additions: 0,
        deletions: 0,
        binary: false,
        patch: "",
        lines: 0,
      });
      i += 2;
    }
  }
  // Then the numstat records, one per raw record, in the same order.
  let n = 0;
  while (i < fields.length && n < files.length) {
    const record = fields[i] as string;
    const [added, deleted] = record.split("\t");
    const file = files[n] as ChangedFile;
    // A rename's numstat record ends its counts with a tab and holds the two
    // paths as the next two fields; a plain one has its path after the tab.
    i += file.oldPath === null ? 1 : 3;
    n += 1;
    if (added === "-" || deleted === "-") {
      file.binary = true;
      continue;
    }
    file.additions = Number.parseInt(added ?? "0", 10) || 0;
    file.deletions = Number.parseInt(deleted ?? "0", 10) || 0;
    // No hunks were read, but the patch would hold at least this many lines,
    // and a caller deciding whether there is anything to ask for needs that.
    file.lines = file.additions + file.deletions;
  }
  return files;
}
