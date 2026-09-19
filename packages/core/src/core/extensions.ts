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
   */
  run(repo: Repo): { check: string; level: Level; path: string; message: string }[];
}

/** Everything the loaded plugins add, merged. */
export interface CoreExtensions {
  treeLocations: readonly TreeLocation[];
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
export function mergeExtensions(parts: readonly ExtensionParts[]): CoreExtensions {
  const treeLocations: TreeLocation[] = [];
  const frontmatterKeys: FrontmatterKeyDef[] = [];
  const queryKeys: QueryKeyDef[] = [];
  const doctorChecks: DoctorCheckDef[] = [];
  const commitScopes: string[] = [];
  const conflicts: string[] = [];

  const seen = {
    dir: new Set<string>(),
    key: new Set<string>(),
    query: new Set<string>(),
    check: new Set<string>(),
  };

  for (const part of parts) {
    for (const location of part.treeLocations ?? []) {
      if (seen.dir.has(location.dir))
        conflicts.push(`two plugins claim the '${location.dir}/' directory`);
      else {
        seen.dir.add(location.dir);
        treeLocations.push(location);
      }
    }
    for (const def of part.frontmatterKeys ?? []) {
      if (seen.key.has(def.key))
        conflicts.push(`two plugins claim the '${def.key}' frontmatter key`);
      else {
        seen.key.add(def.key);
        frontmatterKeys.push(def);
      }
    }
    for (const def of part.queryKeys ?? []) {
      if (seen.query.has(def.key)) conflicts.push(`two plugins claim the '${def.key}:' query term`);
      else {
        seen.query.add(def.key);
        queryKeys.push(def);
      }
    }
    for (const def of part.doctorChecks ?? []) {
      if (seen.check.has(def.id)) conflicts.push(`two plugins claim the check id '${def.id}'`);
      else {
        seen.check.add(def.id);
        doctorChecks.push(def);
      }
    }
    for (const scope of part.commitScopes ?? []) {
      if (!commitScopes.includes(scope)) commitScopes.push(scope);
    }
  }

  if (conflicts.length > 0) throw new ExtensionConflictError(conflicts);
  return { treeLocations, frontmatterKeys, queryKeys, doctorChecks, commitScopes };
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
