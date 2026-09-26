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
import {
  type FlatFrontmatter,
  type FlatList,
  type FlatScalar,
  flatToPlain,
  isFlatList,
  parseFlatYaml,
} from "./flat-yaml.ts";

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
  /**
   * The frontmatter as the fast reader read it, when it could (see
   * `flat-yaml.ts`). The readers below answer from it while nothing has been
   * written, and `doc` is only parsed when something needs it.
   */
  flat?: FlatFrontmatter;
}

export class FrontmatterError extends Error {}

const DELIMITER = /^---[ \t]*\r?$/;

/**
 * Split a Navbook file into its YAML block and its body.
 *
 * Walks the lines by index rather than splitting the file into them: the body
 * is most of the text and is handed back whole, so there is no reason to cut
 * it into lines only to join them again.
 */
export function splitFrontmatter(text: string): { yaml: string; body: string } {
  const firstEnd = text.indexOf("\n");
  if (!DELIMITER.test(firstEnd === -1 ? text : text.slice(0, firstEnd))) {
    throw new FrontmatterError("file must start with a '---' frontmatter delimiter at byte 0");
  }
  let start = firstEnd + 1;
  while (firstEnd !== -1) {
    const end = text.indexOf("\n", start);
    if (DELIMITER.test(end === -1 ? text.slice(start) : text.slice(start, end))) {
      const yaml = text.slice(firstEnd + 1, Math.max(firstEnd + 1, start - 1));
      const body = end === -1 ? "" : text.slice(end + 1);
      return { yaml: yaml === "" ? "" : `${yaml}\n`, body };
    }
    if (end === -1) break;
    start = end + 1;
  }
  throw new FrontmatterError("frontmatter block is not closed by a '---' line");
}

/** Parse a Navbook file into a {@link NavDoc}. Throws only on a missing block. */
export function parseDoc(text: string): NavDoc {
  const { yaml, body } = splitFrontmatter(text);
  const flat = parseFlatYaml(yaml);
  if (flat) {
    // What the fast reader accepts, `yaml` parses without errors; the
    // Document is built only if something asks for it, which reading never does.
    let doc: Document | undefined;
    return {
      get doc(): Document {
        doc ??= parseDocument(yaml, { keepSourceTokens: false });
        return doc;
      },
      rawYaml: yaml,
      body,
      dirty: false,
      errors: [],
      flat,
    };
  }
  const doc = parseDocument(yaml, { keepSourceTokens: false });
  const errors = doc.errors.map((e) => e.message);
  return { doc, rawYaml: yaml, body, dirty: false, errors };
}

/** The fast reader's frontmatter, while nothing has been written over it. */
function flatOf(nav: NavDoc): FlatFrontmatter | undefined {
  return nav.dirty ? undefined : nav.flat;
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
  if (doc.errors.length > 0) {
    // The YAML parser refuses to stringify a document it could not parse, and
    // a caller rewriting frontmatter would otherwise get its bare message.
    throw new FrontmatterError(
      `frontmatter is not valid YAML and cannot be rewritten: ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }
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
  const flat = flatOf(nav);
  if (flat) return flatToPlain(flat);
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
  const flat = flatOf(nav);
  if (flat && path.length <= 2) {
    const found = flatNode(flat, path);
    if (found === undefined || isFlatList(found)) return undefined;
    if (typeof found.value === "string") return found.value;
    if (found.value === null) {
      const source = found.source;
      return source !== undefined && NULL_SOURCES.has(source) ? undefined : source;
    }
    return found.source ?? String(found.value);
  }
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
  const flat = flatOf(nav);
  if (flat && path.length <= 2) {
    const found = flatNode(flat, path);
    return found !== undefined && isFlatList(found) ? found.items.length : null;
  }
  const node = path.length === 1 ? nav.doc.get(path[0] as string, true) : nav.doc.getIn(path, true);
  return isSeq(node) ? node.items.length : null;
}

/** True when the frontmatter has the key at all (even with a null value). */
export function hasKey(nav: NavDoc, key: string): boolean {
  const flat = flatOf(nav);
  if (flat) return flat.nodes.has(key);
  return isMap(nav.doc.contents) && nav.doc.has(key);
}

/** Ordered list of frontmatter keys, as they appear in the file. */
export function keysInOrder(nav: NavDoc): string[] {
  const flat = flatOf(nav);
  if (flat) return [...flat.keys];
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

/** The node at a one- or two-step path: a key, then an index into its list. */
function flatNode(
  flat: FlatFrontmatter,
  path: readonly (string | number)[],
): FlatScalar | FlatList | undefined {
  const node = flat.nodes.get(String(path[0]));
  if (path.length === 1 || node === undefined) return node;
  const index = path[1];
  if (!isFlatList(node) || typeof index !== "number") return undefined;
  return node.items[index];
}
