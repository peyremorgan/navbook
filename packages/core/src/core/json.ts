/**
 * Canonical machine-readable projection — spec 04 §4.2.
 *
 * The shape lives in `core` so every implementation emits byte-identical
 * `--json` output and differential testing stays meaningful. Output is
 * newline-delimited JSON: one object per entity, one object per line.
 *
 * `list` emits entity objects alone; `show` adds a `comments` array. No key
 * ever changes type between commands.
 */

import { keysInOrder } from "./frontmatter.ts";
import type { CommentRecord, EntityRecord, FeatureRecord, SpecRecord } from "./tree.ts";

/**
 * One entity: identity first, then its frontmatter in file order, then body.
 *
 * `navDir` prefixes the emitted `path`, which is repository-relative: the
 * consumer of `--json` wants a path it can open, not one relative to a root it
 * would have to locate itself.
 */
export function entityJson(
  navDir: string,
  entity: EntityRecord,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: entity.id,
    slug: entity.slug,
    kind: entity.kind,
    status: entity.status,
    path: `${navDir}/${entity.dirPath}`,
  };
  if (entity.archived) out.archived = true;
  for (const key of keysInOrder(entity.parsed.nav)) {
    if (key === "" || key in out) continue;
    out[key] = entity.fm[key];
  }
  out.body = entity.body.trim();
  return { ...out, ...extra };
}

/** One comment, including any review fields it carries. */
export function commentJson(navDir: string, comment: CommentRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: comment.id,
    path: `${navDir}/${comment.path}`,
    created: comment.stamp,
  };
  for (const key of keysInOrder(comment.parsed.nav)) {
    if (key === "" || key in out) continue;
    out[key] = comment.parsed.fm[key];
  }
  out.body = comment.body.trim();
  return out;
}

/**
 * One feature: its slug and path, then its frontmatter in file order, then the
 * summary, then the documents it holds. A feature has no ID and no status, so
 * neither key appears — the slug is the identity (spec 02 §2.11).
 */
export function featureJson(
  navDir: string,
  feature: FeatureRecord,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    slug: feature.slug,
    path: `${navDir}/${feature.dirPath}`,
  };
  for (const key of keysInOrder(feature.parsed.nav)) {
    if (key === "" || key in out) continue;
    out[key] = feature.fm[key];
  }
  out.body = feature.body.trim();
  out.specs = feature.specs.map((spec) => ({ file: spec.fileName, title: spec.title }));
  return { ...out, ...extra };
}

/** One specification document, named by the feature that holds it. */
export function specJson(
  navDir: string,
  feature: FeatureRecord,
  spec: SpecRecord,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    feature: feature.slug,
    file: spec.fileName,
    path: `${navDir}/${spec.path}`,
  };
  for (const key of keysInOrder(spec.parsed.nav)) {
    if (key === "" || key in out) continue;
    out[key] = spec.fm[key];
  }
  out.body = spec.body.trim();
  return out;
}

/** Serialize objects as newline-delimited JSON (one per line). */
export function toNdjson(objects: readonly Record<string, unknown>[]): string {
  return objects.map((o) => JSON.stringify(o)).join("\n");
}
