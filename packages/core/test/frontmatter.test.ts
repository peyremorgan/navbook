import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendListItem,
  emptyDoc,
  FrontmatterError,
  keysInOrder,
  parseDoc,
  patchDoc,
  serializeDoc,
  setFlowList,
  splitFrontmatter,
  stringAt,
  toPlain,
} from "../src/core/frontmatter.ts";

const HAND_WRITTEN = `---
title: Login times out # why it matters
author: Alice Smith <alice@example.com>
created: 2026-08-02T09:14:00Z
labels: [bug, auth]
some-unknown-key:
  nested: true
  list:
    - one
    - two
---

Login POST aborts after 5 s.

Second paragraph.
`;

describe("splitFrontmatter", () => {
  it("requires the opening delimiter at byte 0", () => {
    assert.throws(() => splitFrontmatter("\n---\ntitle: x\n---\n"), FrontmatterError);
    assert.throws(() => splitFrontmatter("no frontmatter here"), FrontmatterError);
    assert.throws(() => splitFrontmatter(" ---\ntitle: x\n---\n"), FrontmatterError);
  });

  it("requires the block to be closed", () => {
    assert.throws(() => splitFrontmatter("---\ntitle: x\n"), FrontmatterError);
  });

  it("handles an empty block and an empty body", () => {
    assert.deepEqual(splitFrontmatter("---\n---\n"), { yaml: "", body: "" });
  });

  it("tolerates CRLF line endings on the delimiters", () => {
    const result = splitFrontmatter("---\r\ntitle: x\r\n---\r\nbody\r\n");
    assert.equal(result.body, "body\r\n");
  });

  it("stops at the first closing delimiter, leaving later ones in the body", () => {
    const { body } = splitFrontmatter("---\na: 1\n---\nintro\n\n---\n\noutro\n");
    assert.equal(body, "intro\n\n---\n\noutro\n");
  });
});

describe("round-tripping", () => {
  it("reproduces an untouched file byte for byte", () => {
    assert.equal(serializeDoc(parseDoc(HAND_WRITTEN)), HAND_WRITTEN);
  });

  it("preserves unknown keys, key order and comments when a file is rewritten", () => {
    const doc = parseDoc(HAND_WRITTEN);
    patchDoc(doc, { resolution: "fixed" });
    const output = serializeDoc(doc);

    assert.match(output, /# why it matters/, "inline comment survives");
    assert.match(output, /some-unknown-key:/, "unknown key survives");
    assert.match(output, /nested: true/, "nested unknown data survives");
    assert.deepEqual(keysInOrder(parseDoc(output)), [
      "title",
      "author",
      "created",
      "labels",
      "some-unknown-key",
      "resolution",
    ]);
    assert.match(output, /\n\nLogin POST aborts after 5 s\.\n\nSecond paragraph\.\n$/);
  });

  it("deletes keys when a change is undefined, and ignores absent ones", () => {
    const doc = parseDoc("---\ntitle: x\nresolution: fixed\n---\nbody\n");
    patchDoc(doc, { resolution: undefined, milestone: undefined });
    assert.equal(serializeDoc(doc), "---\ntitle: x\n---\nbody\n");
  });

  it("does not mark a document dirty when nothing was deleted", () => {
    const doc = parseDoc(HAND_WRITTEN);
    patchDoc(doc, { nonexistent: undefined });
    assert.equal(doc.dirty, false);
    assert.equal(serializeDoc(doc), HAND_WRITTEN);
  });

  it("writes an empty document as an empty block", () => {
    assert.equal(serializeDoc(emptyDoc()), "---\n---\n");
  });

  it("can add keys to a file whose frontmatter was empty", () => {
    const doc = parseDoc("---\n---\nbody\n");
    patchDoc(doc, { title: "hello" });
    assert.equal(serializeDoc(doc), "---\ntitle: hello\n---\nbody\n");
  });
});

describe("value styles", () => {
  it("writes scalar lists in flow style, as the spec's examples do", () => {
    const doc = emptyDoc();
    setFlowList(doc, "labels", ["bug", "auth"]);
    assert.match(serializeDoc(doc), /labels: \[bug, auth\]/);
  });

  it("writes lists of maps in block style", () => {
    const doc = emptyDoc();
    appendListItem(doc, "revisions", { head: "a".repeat(40), base: "b".repeat(40), date: "x" });
    appendListItem(doc, "revisions", { head: "c".repeat(40), base: "d".repeat(40), date: "y" });
    const text = serializeDoc(doc);
    assert.match(
      text,
      /revisions:\n {2}- head: a{40}\n {4}base: b{40}\n {4}date: x\n {2}- head: c{40}/,
    );
  });

  it("quotes values that would otherwise parse back as another type", () => {
    const doc = emptyDoc();
    patchDoc(doc, { title: "x: y", other: "true", sha: "4".repeat(40) });
    const text = serializeDoc(doc);
    assert.match(text, /title: "x: y"/);
    assert.match(text, /other: "true"/);
    assert.match(text, /sha: "4{40}"/);
    assert.equal(toPlain(parseDoc(text)).sha, "4".repeat(40));
  });

  it("leaves ordinary hex SHAs and timestamps unquoted", () => {
    const doc = emptyDoc();
    patchDoc(doc, {
      sha: "4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d",
      when: "2026-08-02T09:14:00Z",
    });
    const text = serializeDoc(doc);
    assert.match(text, /sha: 4f2c9d1e8a7b3c5d9e0f1a2b3c4d5e6f7a8b9c0d\n/);
    assert.match(text, /when: 2026-08-02T09:14:00Z\n/);
  });
});

describe("stringAt", () => {
  it("recovers the source text of scalars YAML resolved to numbers", () => {
    const doc = parseDoc(`---\nsha: ${"4".repeat(40)}\nzeros: 0123456789\ntitle: 42\n---\nbody\n`);
    assert.equal(stringAt(doc, ["sha"]), "4".repeat(40));
    assert.equal(stringAt(doc, ["zeros"]), "0123456789");
    assert.equal(stringAt(doc, ["title"]), "42");
  });

  it("returns quoted strings as their value, without the quotes", () => {
    const doc = parseDoc(`---\na: 'quoted'\nb: "also quoted"\n---\n`);
    assert.equal(stringAt(doc, ["a"]), "quoted");
    assert.equal(stringAt(doc, ["b"]), "also quoted");
  });

  it("treats explicit and implicit nulls as absent", () => {
    const doc = parseDoc("---\na:\nb: null\nc: ~\n---\n");
    assert.equal(stringAt(doc, ["a"]), undefined);
    assert.equal(stringAt(doc, ["b"]), undefined);
    assert.equal(stringAt(doc, ["c"]), undefined);
  });

  it("returns undefined for missing keys and for collections", () => {
    const doc = parseDoc("---\nlist: [1, 2]\nmap:\n  k: v\n---\n");
    assert.equal(stringAt(doc, ["nope"]), undefined);
    assert.equal(stringAt(doc, ["list"]), undefined);
    assert.equal(stringAt(doc, ["map"]), undefined);
  });

  it("reaches into nested paths", () => {
    const doc = parseDoc(`---\nrevisions:\n  - head: ${"7".repeat(40)}\n---\n`);
    assert.equal(stringAt(doc, ["revisions", 0, "head"]), "7".repeat(40));
  });
});

describe("malformed YAML", () => {
  it("reports parse errors instead of throwing", () => {
    const doc = parseDoc("---\ntitle: [unclosed\n---\nbody\n");
    assert.ok(doc.errors.length > 0);
  });
});
