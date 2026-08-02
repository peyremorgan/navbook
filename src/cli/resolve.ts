/**
 * Turning what the user typed into the entity they meant — spec 02 §2.2
 * (prefixes of at least four characters) and spec 04 §4.3 (a verb given an ID
 * of the other kind points at the right noun).
 */

import { MIN_PREFIX_LENGTH, resolvePrefix } from "../core/id.ts";
import { allEntities, type EntityKind, type EntityRecord, type Repo } from "../core/tree.ts";
import { fail } from "./errors.ts";

const NOUN: Record<EntityKind, string> = { issue: "issue", pr: "pull request" };
const COMMAND: Record<EntityKind, string> = { issue: "nav issue", pr: "nav pr" };

/** Resolve an ID or unambiguous prefix to an entity of the expected kind. */
export function resolveEntity(repo: Repo, prefix: string, kind: EntityKind): EntityRecord {
  const entities = allEntities(repo);
  const resolution = resolvePrefix(
    prefix,
    entities.map((e) => e.id),
  );

  if (!resolution.ok) {
    switch (resolution.reason) {
      case "too-short":
        fail(
          `'${prefix}' is too short; ID prefixes must be at least ${MIN_PREFIX_LENGTH} characters`,
        );
        break;
      case "not-found":
        fail(`no ${NOUN[kind]} matches '${prefix}'`);
        break;
      default:
        fail(
          `'${prefix}' is ambiguous; ${resolution.matches.length} entities match`,
          resolution.matches.map((id) => describe(entities.find((e) => e.id === id))),
        );
    }
  }

  const matches = entities.filter((e) => e.id === resolution.id);
  const wanted = matches.find((e) => e.kind === kind);
  if (wanted) return wanted;

  const other = matches[0] as EntityRecord;
  fail(
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

/** Resolve a comment ID or prefix within one entity (used by `--reply-to`). */
export function resolveComment(entity: EntityRecord, prefix: string): string {
  const resolution = resolvePrefix(
    prefix,
    entity.comments.map((c) => c.id),
  );
  if (resolution.ok) return resolution.id;
  switch (resolution.reason) {
    case "too-short":
      fail(
        `'${prefix}' is too short; ID prefixes must be at least ${MIN_PREFIX_LENGTH} characters`,
      );
      break;
    case "not-found":
      fail(`no comment of #${entity.id} matches '${prefix}'`);
      break;
    default:
      fail(
        `'${prefix}' is ambiguous within #${entity.id}`,
        resolution.matches.map((id) => `#${id}`),
      );
  }
}
