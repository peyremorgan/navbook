/**
 * The fast frontmatter reader, held to one property: whenever it reads a block,
 * every reader in `frontmatter.ts` answers exactly what it answers when `yaml`
 * parsed the same block.
 *
 * The comparison runs over every Navbook file in this repository and in the
 * conformance fixtures, and over a corpus of values chosen to sit on the edges
 * of the subset — each is either read identically or refused, and a refusal is
 * always correct, since the caller then parses with `yaml` as before.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseDocument } from "yaml";
import { normalizeFrontmatter } from "../src/core/files.ts";
import { parseFlatYaml } from "../src/core/flat-yaml.ts";
import {
  FrontmatterError,
  hasKey,
  keysInOrder,
  type NavDoc,
  parseDoc,
  patchDoc,
  seqLength,
  serializeDoc,
  splitFrontmatter,
  stringAt,
  toPlain,
} from "../src/core/frontmatter.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");

/** The block as `yaml` alone reads it, with the fast reader kept out. */
function slowDoc(yaml: string): NavDoc {
  const doc = parseDocument(yaml, { keepSourceTokens: false });
  return { doc, rawYaml: yaml, body: "", dirty: false, errors: doc.errors.map((e) => e.message) };
}

/** The block as `parseDoc` reads it, which takes the fast path when it can. */
function fastDoc(yaml: string): NavDoc {
  return parseDoc(`---\n${yaml}---\n`);
}

/**
 * Assert every reader agrees, when the fast path read the block.
 * Returns whether it did.
 */
function agrees(yaml: string): boolean {
  const fast = fastDoc(yaml);
  if (fast.flat === undefined) return false;
  const slow = slowDoc(yaml);
  const at = `for ${JSON.stringify(yaml)}`;
  assert.deepEqual(slow.errors, [], `yaml reports errors the fast path missed ${at}`);
  assert.deepEqual(fast.errors, slow.errors, at);
  assert.deepEqual(toPlain(fast), toPlain(slow), `plain values ${at}`);
  assert.deepEqual(normalizeFrontmatter(fast), normalizeFrontmatter(slow), `normalized ${at}`);
  const keys = keysInOrder(slow);
  assert.deepEqual(keysInOrder(fast), keys, `keys ${at}`);
  for (const key of [...keys, "absent"]) {
    assert.equal(hasKey(fast, key), hasKey(slow, key), `hasKey(${key}) ${at}`);
    assert.equal(stringAt(fast, [key]), stringAt(slow, [key]), `stringAt(${key}) ${at}`);
    assert.equal(seqLength(fast, [key]), seqLength(slow, [key]), `seqLength(${key}) ${at}`);
    for (const index of [0, 1, 2, 5]) {
      assert.equal(
        stringAt(fast, [key, index]),
        stringAt(slow, [key, index]),
        `stringAt(${key}, ${index}) ${at}`,
      );
    }
  }
  return true;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md")) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** Frontmatter blocks from real files, skipping any without one. */
function blocksUnder(dir: string): { path: string; yaml: string }[] {
  const out: { path: string; yaml: string }[] = [];
  for (const path of markdownFiles(dir)) {
    try {
      out.push({ path, yaml: splitFrontmatter(readFileSync(path, "utf8")).yaml });
    } catch {
      // Not a Navbook file, or deliberately broken: nothing to compare.
    }
  }
  return out;
}

describe("the fast frontmatter reader", () => {
  it("reads every file in this repository's tree as yaml does", () => {
    const blocks = blocksUnder(join(REPO, ".navbook"));
    assert.ok(blocks.length > 50, "the corpus is the tree itself, so it must be there");
    let read = 0;
    for (const { yaml } of blocks) if (agrees(yaml)) read++;
    // Issues and comments are the bulk of any tree, and all of them are flat:
    // a reader that refused them would be correct and useless.
    assert.ok(read / blocks.length > 0.8, `read ${read} of ${blocks.length}`);
  });

  it("reads every file in the conformance fixtures as yaml does", () => {
    for (const { yaml } of blocksUnder(join(REPO, "doc", "spec", "fixtures"))) agrees(yaml);
  });

  it("reads the shapes Navbook writes", () => {
    const shapes = [
      "title: Login times out\nauthor: Alice <alice@example.com>\ncreated: 2026-08-02T09:14:00Z\n",
      "labels: [bug, auth]\nassignee: [Claude <noreply@anthropic.com>]\nrank: 20\n",
      'title: "Fix: the colon"\nparent: bqlybac0\ndeadline: 2026-10-01\n',
      "author: bob@example.com\nreply-to: t5kr1gq6\n",
      "",
    ];
    for (const yaml of shapes) assert.ok(agrees(yaml), `refused ${JSON.stringify(yaml)}`);
  });

  it("reads each awkward value as yaml does, or leaves it to yaml", () => {
    const values = [
      // plain
      "Login times out",
      "Fix: the thing",
      "a:b",
      "C# is fun",
      "issue #12",
      "#hash",
      "- dash",
      "-dash",
      "-5",
      "+5",
      "007",
      "0",
      "-0",
      "+0",
      "12345678901234567890",
      "1.5",
      "1.",
      ".5",
      "1e3",
      "1E-3",
      "0x1F",
      "0o17",
      "0b101",
      ".inf",
      "-.Inf",
      ".nan",
      "true",
      "True",
      "TRUE",
      "tRue",
      "false",
      "yes",
      "no",
      "on",
      "off",
      "y",
      "null",
      "Null",
      "NULL",
      "nUll",
      "~",
      "2026-08-02T09:14:00Z",
      "2026-08-02",
      "12:30",
      "1_000",
      "a, b",
      "[not a list",
      "{x}",
      "x]",
      "back\\slash",
      "tab\there",
      "trailing   ",
      "Claude <noreply@anthropic.com>",
      "日本語のタイトル",
      "emoji 🎉",
      "a #b",
      "a#b",
      "a: b",
      "end:",
      "%percent",
      "@at",
      "`tick",
      "&anchor",
      "*alias",
      "!tag",
      "|",
      ">",
      "?q",
      "? q",
      ":colon",
      ",comma",
      "...",
      "---x",
      "= eq",
      "<<",
      "a  b",
      "a\u2028b",
      "k\u0085",
      "nbsp\u00a0here",
      "\ufeffbom",
      // double-quoted
      '"hello"',
      '"with \\"escaped\\" quote"',
      '"back\\\\slash"',
      '"\\n newline"',
      '"\\t"',
      '"\\u00e9"',
      '"\\x41"',
      '"unterminated',
      '"a" trailing',
      '""',
      '"a # b"',
      '"colon: inside"',
      "\"'single' inside\"",
      '"trailing"   ',
      '"a" # comment',
      // single-quoted
      "'hello'",
      "'it''s'",
      "''",
      "'a\" b'",
      "'x' y",
      "'back\\slash'",
      "'unterminated",
      // flow lists
      "[]",
      "[ ]",
      "[a]",
      "[a, b]",
      "[a,b]",
      "[ a , b ]",
      "[a, ]",
      "[, a]",
      '["x, y", z]',
      "['a', \"b\"]",
      "[1, 2]",
      "[true, null]",
      "[a: b]",
      "[a:b]",
      "[[nested]]",
      "[{a: 1}]",
      "[a] # c",
      "[a]x",
      "[a",
      "[a #b]",
      "[Claude <noreply@anthropic.com>, Bob <bob@x.io>]",
      "[1.5]",
      "[~]",
      '[""]',
      "[a,,b]",
      "['it''s']",
      "[-a]",
      "[a b]",
      "[ 'x' , 'y' ]",
      "[#x]",
      "[a]  ",
    ];
    for (const value of values) {
      agrees(`key: ${value}\n`);
      agrees(`title: x\nkey: ${value}\nother: y\n`);
    }
  });

  it("reads each awkward document as yaml does, or leaves it to yaml", () => {
    const documents = [
      "a: 1\na: 2\n", // a duplicate key, which yaml reports
      "a: 1\n\nb: 2\n",
      "a: 1\n   \nb: 2\n",
      "a: 1\n\t\nb: 2\n",
      "# a comment\na: 1\n",
      "a: 1 # trailing comment\n",
      "title: long\n  continued\n",
      "labels:\n  - bug\n  - auth\n",
      "labels:\n- bug\n",
      "merged:\n  date: 2026-08-02\n  by: a@b.c\n",
      "a:value\n",
      "Key: v\n",
      "true: x\n",
      "null: x\n",
      "Null: x\n",
      "yes: x\n",
      "123: x\n",
      "my_key: x\nmy-key: y\n",
      "a: x\r\nb: y\r\n",
      "\n",
      "a:\n",
      "a:   \n",
      "a: ~\nb:\nc: null\n",
      "a: [x]\nb: [y, z]\n",
      "? complex\n: key\n",
      "a: &x 1\nb: *x\n",
      "%YAML 1.2\n---\na: 1\n",
      "a: 1\n...\n",
      "- a\n- b\n",
      "just a string\n",
      "a: 1\nb\n",
      "a: >\n  folded\n",
      "a: |\n  literal\n",
      "  a: 1\n",
    ];
    for (const yaml of documents) agrees(yaml);
  });

  it("refuses rather than guesses on what it does not read", () => {
    for (const yaml of [
      "a: 1\na: 2\n",
      "labels:\n  - bug\n",
      "merged:\n  by: a@b.c\n",
      "a: 1.5\n",
      "a: 0x1F\n",
      '"a": 1\n',
      "a: 1 # comment\n",
      'a: "\\n"\n',
    ]) {
      assert.equal(parseFlatYaml(yaml), null, JSON.stringify(yaml));
    }
  });
});

describe("a file the fast reader read, once it is written", () => {
  it("answers from the edited document, exactly as one yaml read does", () => {
    const yaml = "title: Before\nlabels: [a]\n";
    const fast = parseDoc(`---\n${yaml}---\nBody.\n`);
    assert.ok(fast.flat, "the fast path read it");
    const slow = { ...slowDoc(yaml), body: "Body.\n" };
    const edit = { title: "After", labels: undefined, milestone: "v1" };
    patchDoc(fast, edit);
    patchDoc(slow, edit);

    assert.equal(stringAt(fast, ["title"]), "After");
    assert.equal(hasKey(fast, "labels"), false);
    assert.deepEqual(toPlain(fast), { title: "After", milestone: "v1" });
    for (const key of ["title", "labels", "milestone"]) {
      assert.equal(hasKey(fast, key), hasKey(slow, key));
      assert.equal(stringAt(fast, [key]), stringAt(slow, [key]));
    }
    assert.deepEqual(keysInOrder(fast), keysInOrder(slow));
    assert.deepEqual(toPlain(fast), toPlain(slow));
    assert.equal(serializeDoc(fast), "---\ntitle: After\nmilestone: v1\n---\nBody.\n");
    assert.equal(serializeDoc(fast), serializeDoc(slow));
  });

  it("replays the text byte for byte while nothing was written", () => {
    const text = "---\ntitle:   Spaced   \nlabels: [ a ,b ]\n---\nBody.\n";
    const nav = parseDoc(text);
    assert.ok(nav.flat);
    assert.equal(serializeDoc(nav), text);
  });
});

describe("splitFrontmatter", () => {
  /** The implementation it replaced, kept as the reference. */
  function byLines(text: string): { yaml: string; body: string } {
    const lines = text.split("\n");
    if (!/^---[ \t]*\r?$/.test(lines[0] ?? "")) {
      throw new FrontmatterError("file must start with a '---' frontmatter delimiter at byte 0");
    }
    for (let i = 1; i < lines.length; i++) {
      if (/^---[ \t]*\r?$/.test(lines[i] as string)) {
        const yaml = lines.slice(1, i).join("\n");
        const body = lines.slice(i + 1).join("\n");
        return { yaml: yaml === "" ? "" : `${yaml}\n`, body };
      }
    }
    throw new FrontmatterError("frontmatter block is not closed by a '---' line");
  }

  const outcome = (split: (text: string) => unknown, text: string) => {
    try {
      return { ok: split(text) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };

  it("splits every text exactly as the line-by-line version did", () => {
    const texts = [
      "---\n---\n",
      "---\n---",
      "---\nx: 1\n---",
      "---\nx: 1\n---\nbody\nmore\n",
      "---\r\nx: 1\r\n---\r\nbody\r\n",
      "---  \nx: 1\n---\t\nbody",
      "---\n---\n---\n",
      "---\nx: 1\n",
      "---",
      "",
      "no frontmatter\n",
      "\n---\nx: 1\n---\n",
      "----\nx\n---\n",
      "---\nx: 1\n--- \n\n\nbody\n",
      "---\n\n---\nbody",
      ...markdownFiles(join(REPO, ".navbook")).map((path) => readFileSync(path, "utf8")),
    ];
    for (const text of texts) {
      assert.deepEqual(
        outcome(splitFrontmatter, text),
        outcome(byLines, text),
        JSON.stringify(text),
      );
    }
  });
});
