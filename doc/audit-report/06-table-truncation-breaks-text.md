# 06 — Listing truncation splits surrogate pairs and miscounts wide characters

**Tracked as:** `#ozzaoa36` — `nav issue show ozzaoa36`
**Severity:** Low–Medium — mojibake in `nav issue list`, and misaligned columns
for any non-Latin title.
**Where:** [`packages/cli/src/render/table.ts:84-93`](../../packages/cli/src/render/table.ts#L84-L93)

## What is wrong

Two measures of "width" are mixed in one function:

```ts
// packages/cli/src/render/table.ts:84-93
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width === 1) return "~";
  return `${text.slice(0, width - 1)}~`;   // ← UTF-16 code units
}

function displayWidth(text: string): number {
  return [...text].length;                  // ← code points
}
```

`displayWidth` counts code points; `String.prototype.slice` counts UTF-16 code
units. For any character outside the Basic Multilingual Plane the two disagree
by a factor of two, and the slice can land between a high and a low surrogate.

Separately, neither measure is the terminal's. `displayWidth` also drives `pad`
(line 78), so a CJK or emoji title is padded as if each character occupied one
column when it occupies two.

## Reproduction

```ts
import { truncate } from "./packages/cli/src/render/table.ts";

truncate("😀😀😀😀", 2);   // "\ud83d~"  ← a lone high surrogate
truncate("😀😀😀😀", 3);   // "😀~"      ← correct, by luck of the offset
truncate("認証が失敗する", 6);  // "認証が失敗~" — 6 "wide" units, ~12 terminal columns
```

```
emoji title, truncated to 2: "\ud83d~"  (code points: 2, UTF-16 units: 2)
has lone surrogate: true
```

A lone surrogate is not valid UTF-8. Written to a terminal it renders as U+FFFD
or a blank, and a listing piped to a file produces a byte sequence that is not
well-formed text.

## Why it matters

`truncate` runs on every flexible column whenever the terminal is narrow enough
to shrink one (`renderTable` → `shrinkToFit`, lines 44-52), which is the normal
case for the `title`, `labels`, `assignee` and `reviewer` columns. The inputs
are titles and labels people wrote, so emoji in an issue title and CJK in any
title are both ordinary.

The alignment half is the more visible of the two: a table whose `title` column
holds one Japanese title has every column after it shifted by the number of wide
characters in that row, which is exactly the thing a column-aligned listing
exists to avoid.

## Suggested fix

Two changes, and they are independent.

**Slice by code point**, so a cut is never mid-character:

```ts
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width === 1) return "~";
  return `${[...text].slice(0, width - 1).join("")}~`;
}
```

That is a one-line fix and removes the invalid output outright. It is worth
doing on its own even if the second is declined.

**Measure terminal columns rather than code points**, if the alignment is worth
the code. The rule is East Asian Width plus zero-width combining marks:

```ts
/** Roughly what a terminal gives a character: 2 for wide, 0 for a mark, 1 otherwise. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (/\p{M}/u.test(char)) continue;                       // combining: zero
    width += /\p{Emoji_Presentation}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)
      || (code >= 0x1100 && code <= 0x115f) ? 2 : 1;
    // …or a proper East_Asian_Width table
  }
  return width;
}
```

This is where the trade-off sits. Doing it exactly means an EAW table, which is
a dependency or a generated file — and spec 05 §5.2 is firm that "every
dependency added to the core is a liability for the Rust rewrite". This code is
in `cli/` rather than `core/`, so that rule does not bind it, but the same
reasoning about weight applies. An approximation is defensible; what is not is
the current state, where a wide character is counted as narrow *and* can be cut
in half.

Note that any change here also changes `pad`, so both must move together or the
columns will be worse, not better.

## Test gap

Nothing exercises `truncate` at all — `grep -rn truncate packages/cli/test`
finds no hits — and no test in `packages/cli/test/cli` opens an entity whose
*title* is outside ASCII (the non-ASCII in those files is in test names and
comments). A unit test on `truncate` is the cheap half:

```ts
it("never cuts a character in half", () => {
  for (let width = 1; width <= 8; width++) {
    const cut = truncate("😀😀😀😀", width);
    assert.equal(Buffer.from(cut, "utf8").toString("utf8"), cut, `width ${width}`);
  }
});
```

A listing-level case that opens an issue titled with an emoji and a CJK phrase,
renders it into a narrow terminal, and asserts the same of the whole table would
cover the path people actually hit.
