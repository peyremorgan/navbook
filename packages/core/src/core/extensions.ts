/**
 * What a plugin registers with the core — spec 02 §2.12, spec 05 §5.2.
 *
 * The manifest in `plugins.ts` says *that* a plugin adds a query key or a
 * doctor check; this is *how* the answer is computed. Every shape here is a
 * plain record of functions, held on the workspace context and passed down to
 * the pure functions that consume them. Core never learns a plugin's name,
 * never imports anything, and behaves exactly as it did when the registry is
 * empty — which is what {@link NO_EXTENSIONS} is for, and why the existing
 * suites needed no edits.
 *
 * The reason this is data rather than a base class a plugin extends: the same
 * registrations are consumed by four different callers (a listing, a `show`,
 * the doctor, the API), none of which knows which plugin produced what, and
 * one of which — the doctor — has to sort what comes back into a stable order.
 */

import type { ParsedFile, Problem } from "./files.ts";
import type { PluginManifest } from "./plugins.ts";
import { QUERY_TERMS } from "./query.ts";
import type { EntityKind, EntityRecord, NavTree, Repo, StructuralProblem } from "./tree.ts";
import type { Level } from "./validate.ts";

/**
 * A top-level directory inside the Navbook root that a plugin owns.
 *
 * `build` is handed every path under `dir/` and returns whatever model the
 * plugin wants to hang off the tree, plus the layout faults it found. The
 * model is opaque to core: it lands in `Repo.ext` under the directory's name
 * and is read back by the plugin's own code, which is the only thing that
 * knows its shape.
 *
 * Faults come back rather than being thrown because a tree with a malformed
 * plugin directory must still list its issues. What to *do* about them is the
 * plugin's business too — it reports them from a check of its own, so the
 * level and the wording are the plugin's to choose.
 */
export interface TreeLocation {
  /** The directory's name, relative to the Navbook root. */
  dir: string;
  build(
    files: NavTree,
    paths: readonly string[],
  ): { model: unknown; problems: StructuralProblem[] };
}

/**
 * A directory a plugin owns inside every entity directory of some kinds —
 * `<short>/` beside `issue.md` or `pr.md`, the second namespace of §2.12.
 *
 * The counterpart of {@link TreeLocation} for data that belongs to one entity
 * and travels with it: moved when the entity is closed or merged, carried by
 * the branch the entity lives on. `build` is handed every path under
 * `<entity dir>/<dir>/` and the entity those paths belong to, and its model
 * lands on the entity record, under `EntityRecord.ext`, so that anything
 * holding the record — a query term, a `show`, a listing read out of another
 * branch — holds the plugin's reading of it too.
 *
 * `reads` says which of those paths `build` will ask for the content of. A
 * reader that must fetch in advance, like the scan of other branches, fetches
 * exactly those; the rest — screenshots beside a test run, say — are listed
 * and never read. Absent, every path is read.
 */
export interface EntityLocation {
  /** The directory's name inside an entity directory. */
  dir: string;
  /** The kinds of entity it may appear in; elsewhere it stays an extra file. */
  kinds: EntityKind[];
  reads?(path: string): boolean;
  build(
    files: NavTree,
    entity: Omit<EntityRecord, "ext">,
    paths: readonly string[],
  ): { model: unknown; problems: StructuralProblem[] };
}

/**
 * What a check may ask of the repository's history, when there is one.
 *
 * Handed to plugin checks by `nav doctor` on a working tree, and withheld
 * where there is no history to ask — under `--staged`, whose commit does not
 * exist yet, and wherever a tree is validated on its own. A check that needs
 * it degrades to saying nothing, for the reason D7, D9 and D10 do: an object
 * this clone does not hold is not evidence of a fault.
 *
 * An interface rather than the workspace itself, so the pure layer the checks
 * run in still knows no git (spec 05 §5.2).
 */
export interface DoctorTools {
  /** The text of a blob by its SHA, or null when this clone does not hold it. */
  readBlob(sha: string): string | null;
  /** Whether a commit with this SHA exists in this clone. */
  commitExists(sha: string): boolean;
}

/**
 * How a frontmatter key a plugin owns is read and checked.
 *
 * `shape` is what {@link normalizeFrontmatter} needs: the format lets several
 * keys be written as either a scalar or a list, and a reader that did not know
 * which would hand a plugin a string where it expected an array exactly as
 * often as somebody writes one feature instead of two.
 */
export interface FrontmatterKeyDef {
  key: string;
  kinds: EntityKind[];
  /**
   * `string-or-list` accepts both spellings and yields a list, as `assignee`
   * does. `raw` passes the parsed YAML through untouched, for a key whose
   * value is a structure rather than a scalar.
   */
  shape: "string" | "string-or-list" | "string-list" | "raw";
  /** Schema faults in the value, reported as D2 is for a built-in key. */
  validate?(value: unknown, parsed: ParsedFile): Problem[];
}

/** A query term a plugin answers (spec 04 §4.3). */
export interface QueryKeyDef {
  key: string;
  kinds: EntityKind[];
  /** True when matching reads comment bodies, so a listing knows to load them. */
  needsComments?: boolean;
  /**
   * Check and normalise one term's value before matching.
   *
   * A string result replaces the value; an object is the complaint to print.
   * This runs while parsing the query, so a mistyped term is refused with the
   * term in hand rather than silently matching nothing.
   */
  parse?(value: string): string | { message: string };
  /**
   * True when the entity satisfies every value given for this key.
   *
   * The values are all of them, so the definition chooses whether repeating a
   * term ANDs or ORs — the format has both (spec 04 §4.3), and only the key
   * knows which it is.
   *
   * The entity and nothing else, as every built-in term has: a listing may be
   * filtering entities read out of other branches (spec 03 §3.5), where the
   * only tree in hand is not the one they came from, and a term answered
   * against the wrong tree would be worse than one that cannot be answered.
   */
  matches(values: readonly string[], entity: EntityRecord): boolean;
}

/** A doctor check a plugin adds, numbered `X-<short>-<n>` (spec 04 §4.3). */
export interface DoctorCheckDef {
  id: string;
  level: Level;
  /**
   * Run against the whole tree, returning diagnostics carrying this check's id.
   *
   * The return type is deliberately loose about `check`: `Diagnostic` types it
   * as the built-in union plus any `X-` code, and a plugin cannot narrow that
   * to its own id without importing a type it has no use for.
   *
   * `tools` is present only where there is history to ask ({@link DoctorTools}).
   */
  run(
    repo: Repo,
    tools?: DoctorTools,
  ): { check: string; level: Level; path: string; message: string }[];
}

/** Everything the loaded plugins add, merged. */
export interface CoreExtensions {
  treeLocations: readonly TreeLocation[];
  entityLocations: readonly EntityLocation[];
  frontmatterKeys: readonly FrontmatterKeyDef[];
  queryKeys: readonly QueryKeyDef[];
  doctorChecks: readonly DoctorCheckDef[];
  /** Commit scopes plugins declare, for `--commit` help and validation. */
  commitScopes: readonly string[];
}

/**
 * No plugins: the reading of every repository that has none, and the default
 * everywhere an extension set is optional.
 *
 * Shared rather than rebuilt, so the common path allocates nothing, and frozen
 * so a caller that mistakes it for a builder finds out immediately.
 */
export const NO_EXTENSIONS: CoreExtensions = Object.freeze({
  treeLocations: Object.freeze([]),
  entityLocations: Object.freeze([]),
  frontmatterKeys: Object.freeze([]),
  queryKeys: Object.freeze([]),
  doctorChecks: Object.freeze([]),
  commitScopes: Object.freeze([]),
});

/** What a plugin hands to `host.register`: any subset of the registries. */
export type ExtensionParts = Partial<{
  -readonly [K in keyof CoreExtensions]: CoreExtensions[K];
}>;

/** A collision between two plugins, or between a plugin and the format. */
export class ExtensionConflictError extends Error {
  readonly conflicts: string[];

  constructor(conflicts: string[]) {
    super(conflicts.join("; "));
    this.name = "ExtensionConflictError";
    this.conflicts = conflicts;
  }
}

/**
 * Merge what several plugins registered, refusing collisions.
 *
 * Two plugins claiming one directory, key or check id is refused rather than
 * resolved by order, for the reason spec 04 §4.3 gives about command names: a
 * tree where the same name means different things depending on which plugin
 * loaded first is worse than one where it means nothing. The caller reports
 * the conflict and drops the later plugin — it is the only one that knows
 * which plugin a registration came from, since a registration deliberately
 * does not carry its author.
 */
/**
 * Names the format already means something by, which no registration may take.
 *
 * A registration is matched against the tree only after the built-in reading
 * has had its turn — an entity path is classified before any plugin bucket, a
 * built-in key is normalised first, a built-in query term is parsed first — so
 * a plugin claiming one of these would not replace it but be silently
 * shadowed by it, with its own code run on the format's data.
 *
 * `feature` and `specs/` are absent on purpose: they are the one grandfathered
 * pair of §2.12, the knowledge base's to claim. D13 and D14 are its checks.
 */
const RESERVED_DIRS = new Set(["issues", "prs", "archive", "navbook.json"]);
/** What the format keeps inside an entity's own directory. */
const RESERVED_ENTITY_DIRS = new Set(["comments", "issue.md", "pr.md"]);
const RESERVED_KEYS = new Set([
  "title",
  "author",
  "created",
  "status",
  "labels",
  "assignee",
  "milestone",
  "rank",
  "deadline",
  "resolution",
  "duplicate-of",
  "parent",
  "subtasks",
  "target",
  "source",
  "reviewer",
  "draft",
  "revisions",
  "merged",
  "superseded-by",
  "reply-to",
  "verdict",
  "revision",
  "file",
  "line",
  "imported-from",
  "imported-at",
  "signature",
]);
const RESERVED_CHECKS = new Set([
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "D7",
  "D8",
  "D9",
  "D10",
  "D11",
  "D12",
  "D15",
  "D16",
]);
/** A directory is one plain segment: never a path, a dot-name or a traversal. */
const PLAIN_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
/** A key or a query term is a word, so it can never name an `Object.prototype` member. */
const PLAIN_WORD = /^[a-z][a-z0-9-]*$/;

export function mergeExtensions(parts: readonly ExtensionParts[]): CoreExtensions {
  const treeLocations: TreeLocation[] = [];
  const entityLocations: EntityLocation[] = [];
  const frontmatterKeys: FrontmatterKeyDef[] = [];
  const queryKeys: QueryKeyDef[] = [];
  const doctorChecks: DoctorCheckDef[] = [];
  const commitScopes: string[] = [];
  const conflicts: string[] = [];

  const seen = {
    dir: new Set<string>(),
    entityDir: new Set<string>(),
    key: new Set<string>(),
    query: new Set<string>(),
    check: new Set<string>(),
  };

  const builtinTerms = new Set<string>(QUERY_TERMS.map((term) => term.key));
  // A registration is plugin code's own object, so its shape is checked here
  // rather than trusted: a registry that is not a list becomes a conflict the
  // caller reports against that plugin, not a TypeError that stops every
  // command for everyone.
  const listOf = <T>(value: readonly T[] | undefined, what: string): readonly T[] => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    conflicts.push(`'${what}' was registered as something other than a list`);
    return [];
  };

  for (const part of parts) {
    for (const location of listOf(part.treeLocations, "treeLocations")) {
      const dir = location?.dir;
      if (typeof dir !== "string" || !PLAIN_SEGMENT.test(dir) || RESERVED_DIRS.has(dir))
        conflicts.push(`'${String(dir)}' is not a directory a plugin may claim`);
      else if (seen.dir.has(location.dir))
        conflicts.push(`two plugins claim the '${location.dir}/' directory`);
      else {
        seen.dir.add(location.dir);
        treeLocations.push(location);
      }
    }
    for (const location of listOf(part.entityLocations, "entityLocations")) {
      const dir = location?.dir;
      if (typeof dir !== "string" || !PLAIN_SEGMENT.test(dir) || RESERVED_ENTITY_DIRS.has(dir))
        conflicts.push(`'${String(dir)}' is not an entity directory a plugin may claim`);
      else if (seen.entityDir.has(location.dir))
        conflicts.push(`two plugins claim the '${location.dir}/' entity directory`);
      else {
        seen.entityDir.add(location.dir);
        entityLocations.push(location);
      }
    }
    for (const def of listOf(part.frontmatterKeys, "frontmatterKeys")) {
      const key = def?.key;
      if (typeof key !== "string" || !PLAIN_WORD.test(key) || RESERVED_KEYS.has(key))
        conflicts.push(`'${String(key)}' is not a frontmatter key a plugin may claim`);
      else if (seen.key.has(def.key))
        conflicts.push(`two plugins claim the '${def.key}' frontmatter key`);
      else {
        seen.key.add(def.key);
        frontmatterKeys.push(def);
      }
    }
    for (const def of listOf(part.queryKeys, "queryKeys")) {
      const key = def?.key;
      if (typeof key !== "string" || !PLAIN_WORD.test(key) || builtinTerms.has(key))
        conflicts.push(`'${String(key)}:' is not a query term a plugin may claim`);
      else if (seen.query.has(def.key))
        conflicts.push(`two plugins claim the '${def.key}:' query term`);
      else {
        seen.query.add(def.key);
        queryKeys.push(def);
      }
    }
    for (const def of listOf(part.doctorChecks, "doctorChecks")) {
      const id = def?.id;
      if (typeof id !== "string" || id === "" || RESERVED_CHECKS.has(id))
        conflicts.push(`'${String(id)}' is not a check id a plugin may claim`);
      else if (seen.check.has(def.id)) conflicts.push(`two plugins claim the check id '${def.id}'`);
      else {
        seen.check.add(def.id);
        doctorChecks.push(def);
      }
    }
    for (const scope of listOf(part.commitScopes, "commitScopes")) {
      if (!commitScopes.includes(scope)) commitScopes.push(scope);
    }
  }

  if (conflicts.length > 0) throw new ExtensionConflictError(conflicts);
  return {
    treeLocations,
    entityLocations,
    frontmatterKeys,
    queryKeys,
    doctorChecks,
    commitScopes,
  };
}

/**
 * What a plugin's `./core` entry is handed — spec 05 §5.2.
 *
 * `core` is the *host's* module object, never one the plugin resolved. That is
 * the single most important line here: a plugin with its own copy of
 * `@navbook/core` would make `instanceof WorkspaceError` false across the
 * boundary, put two YAML parsers on the startup path, and give two
 * structurally identical `Repo` types different identities. The CLI store
 * installs with `--omit=peer` so that copy cannot exist; this is how the
 * plugin gets the real one instead.
 *
 * Declared in core rather than in a front end because every front end builds
 * one, and a plugin typing against it should not have to depend on whichever
 * of them happens to be loading it.
 */
export interface CorePluginHost {
  /** The running core — the host's copy. */
  core: typeof import("../index.ts");
  /** The plugin's own manifest, so it need not read its `package.json`. */
  manifest: PluginManifest;
  /** What `navbook.json` declares under this plugin's name (spec 02 §2.12). */
  settings: Record<string, unknown>;
  /** Register tree locations, frontmatter keys, query terms and checks. */
  register(parts: ExtensionParts): void;
}

/** The definition for a query key, or undefined when no plugin answers it. */
export function queryKeyDef(ext: CoreExtensions, key: string): QueryKeyDef | undefined {
  return ext.queryKeys.find((def) => def.key === key);
}

/** The definitions for frontmatter keys that apply to one entity kind. */
export function frontmatterKeysFor(
  ext: CoreExtensions,
  kind: EntityKind,
): readonly FrontmatterKeyDef[] {
  return ext.frontmatterKeys.filter((def) => def.kinds.includes(kind));
}
