/**
 * A fast reader for the flat frontmatter nearly every Navbook file carries.
 *
 * Issues and comments — the bulk of any tree — hold one level of keys whose
 * values are plain scalars, quoted strings or flow lists of those. Building a
 * `yaml` Document for each was most of what reading a tree cost (#esqpmn7i),
 * and none of that Document is needed to read one. This reads exactly that
 * subset and nothing else: anything it is not certain it reads the way `yaml`
 * reads it — a nested block, a comment, an escape, a number that is not a plain
 * integer, a duplicate key — makes it return null, and the caller parses the
 * text with `yaml` as before.
 *
 * So the one property that matters is: whenever this returns a result, it is
 * the result `yaml` gives. `test/flat-yaml.test.ts` checks that against `yaml`
 * over every file in the repository and a corpus of awkward values.
 */

/** A scalar as `yaml` resolves it, with the text a plain one was written as. */
export interface FlatScalar {
  value: unknown;
  /** The source of a plain scalar; undefined for a quoted one. */
  source?: string;
}

/** A flow list of scalars. */
export interface FlatList {
  items: FlatScalar[];
}

export type FlatNode = FlatScalar | FlatList;

export interface FlatFrontmatter {
  /** Keys in the order the file gives them. */
  keys: string[];
  nodes: Map<string, FlatNode>;
}

export function isFlatList(node: FlatNode): node is FlatList {
  return "items" in node;
}

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?: +(.*))?$/;
// The core schema's tags that are not plain strings (yaml `schema/core`), tried
// in its order. Only null, booleans and decimal integers are resolved here;
// any other number is left to `yaml`.
const NULL = /^(?:~|[Nn]ull|NULL)?$/;
const BOOL = /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/;
const INT = /^[-+]?[0-9]+$/;
const OTHER_NUMBER =
  /^(?:0o[0-7]+|0x[0-9a-fA-F]+|[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+|[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*))$/;
// Characters a plain scalar may not start with, in block or flow context.
const INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

/**
 * True when `line` holds anything but printable, tab-free, single-line text:
 * a control character, DEL, the BOM, or a character YAML 1.1 breaks a line at.
 */
function unsafe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x85) return true;
    if (code === 0x2028 || code === 0x2029 || code === 0xfeff) return true;
  }
  return false;
}

/** Read `text` as flat frontmatter, or return null to have `yaml` read it. */
export function parseFlatYaml(text: string): FlatFrontmatter | null {
  const keys: string[] = [];
  const nodes = new Map<string, FlatNode>();
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    start = end === -1 ? text.length : end + 1;
    if (line.trim() === "" && !line.includes("\t")) continue;
    if (unsafe(line)) return null;

    const match = KEY.exec(line);
    if (!match) return null;
    const key = match[1] as string;
    // A key that is not a plain string would come back as another type.
    if (NULL.test(key) || BOOL.test(key) || nodes.has(key)) return null;
    const node = readValue((match[2] ?? "").trimEnd());
    if (node === null) return null;
    keys.push(key);
    nodes.set(key, node);
  }
  return { keys, nodes };
}

/** The frontmatter as plain values, freshly built, as `Document.toJS` gives it. */
export function flatToPlain(flat: FlatFrontmatter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of flat.keys) {
    const node = flat.nodes.get(key) as FlatNode;
    out[key] = isFlatList(node) ? node.items.map((item) => item.value) : node.value;
  }
  return out;
}

function readValue(text: string): FlatNode | null {
  if (text === "") return { value: null, source: "" };
  if (text.startsWith("[")) return readFlowList(text);
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = readQuoted(text, 0);
    return quoted && quoted.end === text.length ? { value: quoted.value } : null;
  }
  return readPlain(text, false);
}

function readPlain(text: string, flow: boolean): FlatScalar | null {
  if (text === "" || INDICATOR.test(text)) return null;
  // What would end the scalar early or make it something else: a comment, a
  // mapping, and in a flow list the list's own punctuation.
  if (text.includes(" #") || text.includes(": ") || text.endsWith(":")) return null;
  if (flow && /[,[\]{}]/.test(text)) return null;
  if (NULL.test(text)) return { value: null, source: text };
  if (BOOL.test(text)) return { value: text[0] === "t" || text[0] === "T", source: text };
  if (INT.test(text)) return { value: Number.parseInt(text, 10), source: text };
  if (OTHER_NUMBER.test(text)) return null;
  return { value: text, source: text };
}

/** A quoted scalar starting at `at`: its value and the index just past it. */
function readQuoted(text: string, at: number): { value: string; end: number } | null {
  const quote = text[at];
  let value = "";
  let i = at + 1;
  while (i < text.length) {
    const char = text[i] as string;
    if (quote === "'") {
      if (char === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        return { value, end: i + 1 };
      }
    } else {
      if (char === "\\") {
        const next = text[i + 1];
        // Only the two escapes that stand for themselves; `yaml` reads the rest.
        if (next !== '"' && next !== "\\") return null;
        value += next;
        i += 2;
        continue;
      }
      if (char === '"') return { value, end: i + 1 };
    }
    value += char;
    i++;
  }
  return null;
}

function readFlowList(text: string): FlatList | null {
  if (!text.endsWith("]")) return null;
  const items: FlatScalar[] = [];
  let i = 1;
  const skipSpaces = () => {
    while (text[i] === " ") i++;
  };
  skipSpaces();
  if (text[i] === "]") return i === text.length - 1 ? { items } : null;
  for (;;) {
    skipSpaces();
    const char = text[i];
    if (char === '"' || char === "'") {
      const quoted = readQuoted(text, i);
      if (!quoted) return null;
      items.push({ value: quoted.value });
      i = quoted.end;
    } else {
      let end = i;
      while (end < text.length && text[end] !== "," && text[end] !== "]") end++;
      const item = readPlain(text.slice(i, end).trimEnd(), true);
      if (!item) return null;
      items.push(item);
      i = end;
    }
    skipSpaces();
    if (text[i] === ",") {
      i++;
      continue;
    }
    // The closing bracket, and nothing after it.
    return text[i] === "]" && i === text.length - 1 ? { items } : null;
  }
}
