/**
 * YAML frontmatter — spec 02 §2.4.
 *
 * Every Navbook file is UTF-8 Markdown that begins, at byte 0, with a `---`
 * delimited YAML block. Unknown keys MUST be preserved when a tool rewrites a
 * file, so this module is built on the `yaml` package's Document API (which
 * keeps key order and comments) and additionally replays the original YAML text
 * verbatim whenever nothing was actually changed.
 */

import { Document, isMap, isScalar, isSeq, parseDocument } from "yaml";

export interface NavDoc {
  /** Mutable YAML document; only ever written through {@link patchDoc}. */
  doc: Document;
  /** Original YAML source between the delimiters, replayed while `dirty` is false. */
  rawYaml: string;
  /** Everything after the closing delimiter line, byte for byte. */
  body: string;
  dirty: boolean;
  /** Parse errors reported by the YAML parser, if any. */
  errors: string[];
}

export class FrontmatterError extends Error {}

const DELIMITER = /^---[ \t]*\r?$/;

/** Split a Navbook file into its YAML block and its body. */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
  const lines = text.split("\n");
  if (!DELIMITER.test(lines[0] ?? "")) {
    throw new FrontmatterError("file must start with a '---' frontmatter delimiter at byte 0");
  }
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER.test(lines[i] as string)) {
      const yaml = lines.slice(1, i).join("\n");
      const body = lines.slice(i + 1).join("\n");
      return { yaml: yaml === "" ? "" : `${yaml}\n`, body };
    }
  }
  throw new FrontmatterError("frontmatter block is not closed by a '---' line");
}

/** Parse a Navbook file into a {@link NavDoc}. Throws only on a missing block. */
export function parseDoc(text: string): NavDoc {
  const { yaml, body } = splitFrontmatter(text);
  const doc = parseDocument(yaml, { keepSourceTokens: false });
  const errors = doc.errors.map((e) => e.message);
  return { doc, rawYaml: yaml, body, dirty: false, errors };
}

/** Build a fresh document with no keys and an empty body. */
export function emptyDoc(): NavDoc {
  const doc = new Document({});
  return { doc, rawYaml: "", body: "", dirty: true, errors: [] };
}

/** Serialize a {@link NavDoc} back to file text. */
export function serializeDoc(nav: NavDoc): string {
  const yaml = nav.dirty ? serializeYaml(nav.doc) : nav.rawYaml;
  return `---\n${yaml}---\n${nav.body}`;
}

function serializeYaml(doc: Document): string {
  if (doc.contents === null || doc.contents === undefined) return "";
  if (isMap(doc.contents) && doc.contents.items.length === 0) return "";
  const text = doc.toString({
    lineWidth: 0,
    defaultKeyType: "PLAIN",
    flowCollectionPadding: false,
  });
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** All frontmatter as plain JavaScript values (unknown keys included). */
export function toPlain(nav: NavDoc): Record<string, unknown> {
  const value = nav.doc.toJS({ maxAliasCount: 100 });
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const NULL_SOURCES = new Set(["", "~", "null", "Null", "NULL"]);

/**
 * Read a scalar as the string the author wrote.
 *
 * YAML resolves some strings to other types — an all-digit commit SHA becomes a
 * (lossy) number, `title: 42` becomes an integer. Recovering the scalar's source
 * text keeps those hand-written files usable instead of merely diagnosable.
 */
export function stringAt(nav: NavDoc, path: readonly (string | number)[]): string | undefined {
  const node = path.length === 1 ? nav.doc.get(path[0] as string, true) : nav.doc.getIn(path, true);
  if (node === undefined || node === null) return undefined;
  if (!isScalar(node)) return undefined;
  if (typeof node.value === "string") return node.value;
  const source = (node as { source?: string }).source;
  if (node.value === null)
    return source !== undefined && NULL_SOURCES.has(source) ? undefined : source;
  return source ?? String(node.value);
}

/** Number of items in a sequence at `path`, or null when it is not a sequence. */
export function seqLength(nav: NavDoc, path: readonly (string | number)[]): number | null {
  const node = path.length === 1 ? nav.doc.get(path[0] as string, true) : nav.doc.getIn(path, true);
  return isSeq(node) ? node.items.length : null;
}

/** True when the frontmatter has the key at all (even with a null value). */
export function hasKey(nav: NavDoc, key: string): boolean {
  return isMap(nav.doc.contents) && nav.doc.has(key);
}

/** Ordered list of frontmatter keys, as they appear in the file. */
export function keysInOrder(nav: NavDoc): string[] {
  if (!isMap(nav.doc.contents)) return [];
  return nav.doc.contents.items.map((item) =>
    String((item.key as { value?: unknown })?.value ?? ""),
  );
}

/**
 * Set or delete frontmatter keys. A value of `undefined` deletes the key; new
 * keys are appended after the existing ones so hand-authored ordering survives.
 */
export function patchDoc(nav: NavDoc, changes: Record<string, unknown>): NavDoc {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      if (nav.doc.has(key)) {
        nav.doc.delete(key);
        nav.dirty = true;
      }
      continue;
    }
    nav.doc.set(key, value);
    nav.dirty = true;
  }
  return nav;
}

/**
 * Set a list of plain scalars in flow style (`labels: [bug, auth]`), matching
 * the spec's own examples. Flow scalar sequences are inside the conservative
 * YAML subset of spec 05 §5.3.
 */
export function setFlowList(nav: NavDoc, key: string, items: string[]): NavDoc {
  const node = nav.doc.createNode(items);
  if (isSeq(node)) node.flow = true;
  nav.doc.set(key, node);
  nav.dirty = true;
  return nav;
}

/** Append an item to a block-style list, creating the list if necessary. */
export function appendListItem(nav: NavDoc, key: string, item: unknown): NavDoc {
  const existing = nav.doc.get(key, true);
  if (isSeq(existing)) {
    existing.add(nav.doc.createNode(item));
  } else {
    nav.doc.set(key, nav.doc.createNode([item]));
  }
  nav.dirty = true;
  return nav;
}
