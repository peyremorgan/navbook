/**
 * Laying a file's hunks out as rows.
 *
 * The server sends the text git printed; the numbers beside each row and the
 * span marked within a changed pair are worked out here, and are what these
 * tests pin down.
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { countsLabel, MAX_LINE_CHARS, parseHunks } from "../../app/utils/diff";

const PATCH = [
  "@@ -1,3 +1,4 @@",
  " one",
  "-two",
  "+2",
  " three",
  "+four",
  "\\ No newline at end of file",
  "@@ -10,2 +11,2 @@ function f() {",
  "-  return a + b;",
  "+  return a - b;",
  "",
].join("\n");

describe("parseHunks", () => {
  it("numbers every row from its hunk header on", () => {
    const rows = parseHunks(PATCH).map((r) => [r.kind, r.oldNo, r.newNo, r.text]);
    assert.deepEqual(rows, [
      ["hunk", null, null, "@@ -1,3 +1,4 @@"],
      ["context", 1, 1, "one"],
      ["del", 2, null, "two"],
      ["add", null, 2, "2"],
      ["context", 3, 3, "three"],
      ["add", null, 4, "four"],
      ["note", null, null, "No newline at end of file"],
      ["hunk", null, null, "@@ -10,2 +11,2 @@ function f() {"],
      ["del", 10, null, "  return a + b;"],
      ["add", null, 11, "  return a - b;"],
    ]);
  });

  it("marks the span in which a replaced line differs from its replacement", () => {
    const rows = parseHunks(PATCH);
    const [del, add] = rows.slice(8, 10);
    assert.deepEqual(del?.mark, [11, 12]);
    assert.deepEqual(add?.mark, [11, 12]);
    // "two" and "2" share nothing, so neither is marked: the colours suffice.
    assert.equal(rows[2]?.mark, null);
    assert.equal(rows[3]?.mark, null);
    // An addition with no deletion before it has nothing to pair with.
    assert.equal(rows[5]?.mark, null);
  });

  it("pairs a run of deletions with the run of additions after it, in order", () => {
    const rows = parseHunks("@@ -1,3 +1,2 @@\n-ab\n-cd\n-ef\n+ax\n+cy\n");
    assert.deepEqual(
      rows.map((r) => r.mark),
      [null, [1, 2], [1, 2], null, [1, 2], [1, 2]],
    );
  });

  it("cuts a line longer than the browser should lay out", () => {
    const long = "x".repeat(MAX_LINE_CHARS + 7);
    const [, row] = parseHunks(`@@ -1 +1 @@\n+${long}\n`);
    assert.equal(row?.text.length, MAX_LINE_CHARS + " … 7 more characters".length);
    assert.match(row?.text ?? "", / … 7 more characters$/);
  });

  it("reads nothing from nothing", () => {
    assert.deepEqual(parseHunks(""), []);
  });
});

describe("countsLabel", () => {
  it("spells the two counts as every forge does", () => {
    assert.equal(countsLabel(12, 3), "+12 −3");
  });
});
