/**
 * Entity directory names — spec 02 §2.3: `<id>-<slug>`.
 */

import { isId } from "./id.ts";

export const MAX_SLUG_LENGTH = 50;
export const SLUG_FALLBACK = "untitled";
export const DIR_NAME_PATTERN = /^[a-z][a-z0-9]{7}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Derive a display slug from a title: fold accents, lowercase, collapse every
 * run of non-alphanumerics to a single hyphen, cap at 50 characters.
 *
 * Titles with no ASCII-representable alphanumerics (CJK, emoji, punctuation
 * only) slug to {@link SLUG_FALLBACK}, since §2.3 requires at least one segment.
 */
export function slugify(title: string): string {
  const folded = title.normalize("NFKD").replace(/\p{M}/gu, "");
  let slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
  }
  return slug === "" ? SLUG_FALLBACK : slug;
}

/** Compose an entity directory name. */
export function dirName(id: string, slug: string): string {
  return `${id}-${slug}`;
}

/** Split an entity directory name, or return null if it violates the grammar. */
export function parseDirName(name: string): { id: string; slug: string } | null {
  if (!DIR_NAME_PATTERN.test(name)) return null;
  const id = name.slice(0, 8);
  if (!isId(id)) return null;
  return { id, slug: name.slice(9) };
}
