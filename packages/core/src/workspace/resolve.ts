/**
 * Turning what the user typed into the entity they meant — spec 02 §2.2
 * (prefixes of at least four characters) and spec 04 §4.3 (a verb given an ID
 * of the other kind points at the right noun).
 */

import { isSpecFileName } from "../core/files.ts";
import { MIN_PREFIX_LENGTH, resolvePrefix } from "../core/id.ts";
import { SLUG_PATTERN } from "../core/slug.ts";
import {
  allEntities,
  type EntityKind,
  type EntityRecord,
  type FeatureRecord,
  type Repo,
  SPECS_DIR,
  type SpecRecord,
} from "../core/tree.ts";
import { wsFail } from "./errors.ts";

const NOUN: Record<EntityKind, string> = { issue: "issue", pr: "pull request" };
const COMMAND: Record<EntityKind, string> = { issue: "nav issue", pr: "nav pr" };

/**
 * Accept a whole entity directory name wherever an ID is expected.
 *
 * Shell completion offers `<id>-<slug>` names, and they are what a user copies
 * out of a path or a forge URL; the ID is simply its first eight characters.
 */
export function asId(argument: string): string {
  const match = /^([a-z][a-z0-9]{7})-[a-z0-9-]+$/.exec(argument.toLowerCase());
  return match ? (match[1] as string) : argument;
}

/** Resolve an ID or unambiguous prefix to an entity of the expected kind. */
export function resolveEntity(repo: Repo, prefix: string, kind: EntityKind): EntityRecord {
  const entities = allEntities(repo);
  const resolution = resolvePrefix(
    asId(prefix),
    entities.map((e) => e.id),
  );

  if (!resolution.ok) {
    switch (resolution.reason) {
      case "too-short":
        wsFail(
          "prefix-too-short",
          `'${prefix}' is too short; ID prefixes must be at least ${MIN_PREFIX_LENGTH} characters`,
        );
        break;
      case "not-found":
        wsFail("not-found", `no ${NOUN[kind]} matches '${prefix}'`);
        break;
      default:
        wsFail(
          "ambiguous",
          `'${prefix}' is ambiguous; ${resolution.matches.length} entities match`,
          resolution.matches.map((id) => describe(entities.find((e) => e.id === id))),
        );
    }
  }

  const matches = entities.filter((e) => e.id === resolution.id);
  const wanted = matches.find((e) => e.kind === kind);
  if (wanted) return wanted;

  const other = matches[0] as EntityRecord;
  wsFail(
    "wrong-kind",
    `#${other.id} is ${other.kind === "pr" ? "a pull request" : "an issue"} — use '${COMMAND[other.kind]} ${verbHint()}'`,
  );
}

function verbHint(): string {
  return "show";
}

function describe(entity: EntityRecord | undefined): string {
  if (!entity) return "";
  return `#${entity.id}  ${entity.kind === "pr" ? "pr   " : "issue"}  ${entity.title}`;
}

/**
 * Resolve a feature by its slug.
 *
 * By exact slug, never by prefix: a slug is a word somebody chose and typed,
 * not eight random characters nobody wants to type in full, so `auth` matching
 * `authentication` would be a surprise rather than a convenience.
 */
export function resolveFeature(repo: Repo, slug: string): FeatureRecord {
  const feature = repo.featureBySlug.get(slug);
  if (feature) return feature;
  if (!SLUG_PATTERN.test(slug)) {
    wsFail(
      "invalid-input",
      `'${slug}' is not a feature slug: lowercase letters, digits and single hyphens`,
    );
  }
  wsFail("not-found", `no feature named '${slug}' in ${SPECS_DIR}/`, [
    ...repo.features.map((f) => `${f.slug}  ${f.title}`),
  ]);
}

/**
 * Resolve one of a feature's documents by file name.
 *
 * By lookup rather than by joining the name onto a path: the record was parsed
 * from a file this tree holds, so its path cannot be anything the caller made
 * up. That is what makes serving a document by name safe over an API.
 */
export function resolveSpec(feature: FeatureRecord, fileName: string): SpecRecord {
  const spec = feature.specs.find((s) => s.fileName === fileName);
  if (spec) return spec;
  wsFail(
    "not-found",
    `feature '${feature.slug}' has no document named '${fileName}'`,
    feature.specs.map((s) => s.fileName),
  );
}

/** Refuse a document name a tool must not create (spec 02 §2.11). */
export function requireSpecFileName(fileName: string): string {
  if (isSpecFileName(fileName)) return fileName;
  wsFail(
    "invalid-input",
    `'${fileName}' is not a document name this tool will create: expected a slug and '.md', and not 'feature.md'`,
  );
}

/** Resolve a comment ID or prefix within one entity (used by `--reply-to`). */
export function resolveComment(entity: EntityRecord, prefix: string): string {
  const resolution = resolvePrefix(
    prefix,
    entity.comments.map((c) => c.id),
  );
  if (resolution.ok) return resolution.id;
  switch (resolution.reason) {
    case "too-short":
      wsFail(
        "prefix-too-short",
        `'${prefix}' is too short; ID prefixes must be at least ${MIN_PREFIX_LENGTH} characters`,
      );
      break;
    case "not-found":
      wsFail("not-found", `no comment of #${entity.id} matches '${prefix}'`);
      break;
    default:
      wsFail(
        "ambiguous",
        `'${prefix}' is ambiguous within #${entity.id}`,
        resolution.matches.map((id) => `#${id}`),
      );
  }
}
