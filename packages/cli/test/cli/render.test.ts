/**
 * Column-aligned listings with text that is not one column per code unit.
 *
 * Checked on the renderer rather than through `nav issue list`, because a
 * listing only shrinks to fit a terminal, and a test harness spawns its child
 * on pipes: `stdout.columns` is undefined there and nothing is ever cut.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stringWidth from "string-width";
import { makeColors } from "../../src/render/colors.ts";
import { type Column, pad, renderTable, truncate } from "../../src/render/table.ts";

const EMOJI = "😀😀😀😀";
const FAMILY = "👨‍👩‍👧 team";
const JAPANESE = "認証が失敗する";
/** "éclair" with the accent as a combining mark after a plain e. */
const DECOMPOSED = `e${String.fromCharCode(0x301)}clair`;

describe("truncate", () => {
  it("never cuts a character in half", () => {
    for (const text of [EMOJI, FAMILY, JAPANESE, "éclair", DECOMPOSED]) {
      for (let width = 1; width <= 12; width++) {
        const cut = truncate(text, width);
        assert.ok(cut.isWellFormed(), `${JSON.stringify(text)} @ ${width}: ${JSON.stringify(cut)}`);
      }
    }
  });

  it("never exceeds the width it was given", () => {
    for (const text of [EMOJI, FAMILY, JAPANESE, "plain ascii text"]) {
      for (let width = 0; width <= 16; width++) {
        const cut = truncate(text, width);
        assert.ok(stringWidth(cut) <= width, `${JSON.stringify(text)} @ ${width}: ${cut}`);
      }
    }
  });

  it("counts a wide character as two columns", () => {
    // Five kanji and kana would be the old answer; three is what fits in five
    // columns beside the ellipsis.
    assert.equal(truncate(JAPANESE, 6), "認証~");
    assert.equal(truncate(JAPANESE, 7), "認証が~");
    assert.equal(truncate(EMOJI, 2), "~");
    assert.equal(truncate(EMOJI, 3), "😀~");
  });

  it("keeps a ZWJ sequence whole or drops it", () => {
    // 👨‍👩‍👧 is one grapheme of two columns: at width 3 it fits beside the
    // ellipsis, at width 2 nothing of it is kept.
    assert.equal(truncate(FAMILY, 3), "👨‍👩‍👧~");
    assert.equal(truncate(FAMILY, 2), "~");
  });

  it("keeps a combining mark with its base", () => {
    assert.equal(truncate(DECOMPOSED, 3), `${DECOMPOSED.slice(0, 3)}~`);
  });

  it("leaves text that fits alone, and ASCII as it was", () => {
    assert.equal(truncate(JAPANESE, 14), JAPANESE);
    assert.equal(truncate("plain ascii text", 6), "plain~");
    assert.equal(truncate("anything", 1), "~");
    assert.equal(truncate("anything", 0), "");
  });
});

describe("renderTable", () => {
  const colors = makeColors({ isTTY: false }, {});
  const columns: Column[] = [
    { header: "id" },
    { header: "title", flexible: true, minWidth: 8 },
    { header: "labels" },
  ];
  const rows = [
    ["#aaaa", "Plain ASCII title for alignment", "bug"],
    ["#bbbb", "認証が失敗する場合のタイムアウト", "バグ"],
    ["#cccc", `${"😀".repeat(12)} party`, "ui"],
    ["#dddd", FAMILY, "x"],
  ];

  /** The column each row's last cell starts at, in terminal columns. */
  function labelColumns(table: string): number[] {
    return table.split("\n").map((line) => {
      const cells = line.split(/ {2,}/);
      return stringWidth(line) - stringWidth(cells.at(-1) as string);
    });
  }

  for (const width of [undefined, 40, 30, 24]) {
    it(`aligns every column with wide text${width ? ` in ${width} columns` : ""}`, () => {
      const table = renderTable(columns, rows, { colors, width });
      assert.ok(table.isWellFormed(), table);
      const starts = labelColumns(table);
      assert.equal(new Set(starts).size, 1, `labels start at ${starts.join(", ")}\n${table}`);
      if (width !== undefined) {
        for (const line of table.split("\n")) {
          assert.ok(stringWidth(line) <= width, `${stringWidth(line)} > ${width}: ${line}`);
        }
      }
    });
  }
});

describe("control characters in a cell", () => {
  const colors = makeColors({ isTTY: false }, {});
  const columns: Column[] = [
    { header: "title", flexible: true, minWidth: 4 },
    { header: "labels" },
  ];

  it("shows a tab as a space and an escape as a replacement character", () => {
    const table = renderTable(
      columns,
      [
        ["a\tb", "x"],
        ["\u001b[31mred\u001b[0m", "y"],
      ],
      {
        colors,
      },
    );
    assert.ok(!table.includes("\t") && !table.includes("\u001b"), JSON.stringify(table));
    assert.match(table, /a b/);
    assert.match(table, /\uFFFD\[31mred\uFFFD\[0m/);
  });

  it("cuts a cell that held an escape sequence by what it shows", () => {
    const table = renderTable(columns, [["\u001b[31mredredred\u001b[0m", "x"]], {
      colors,
      width: 10,
    });
    // The title column shrinks to its minimum of 4. The escape counts as the
    // one column its replacement takes, not as nothing, and no colour code is
    // left open to bleed into the columns after it.
    const row = table.split("\n")[1] as string;
    assert.equal(row, "\uFFFD[3~  x");
  });
});

describe("pad", () => {
  it("pads by terminal column", () => {
    assert.equal(pad("認証.md", 10), "認証.md   ");
    assert.equal(pad("auth.md", 10), "auth.md   ");
    assert.equal(stringWidth(pad(JAPANESE, 20)), 20);
  });
});
