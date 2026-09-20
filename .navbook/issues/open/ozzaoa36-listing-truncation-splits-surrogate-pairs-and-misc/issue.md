---
title: Listing truncation splits surrogate pairs and miscounts wide characters
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-20T12:38:00Z
labels: [bug, cli]
feature: cli
---

Two measures of "width" are mixed in one function:

```ts
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

`displayWidth` counts code points; `slice` counts UTF-16 code units. For anything outside the Basic Multilingual Plane the two disagree by a factor of two and the slice can land between a high and a low surrogate. Separately, neither is the terminal's measure — `displayWidth` also drives `pad`, so a CJK title is padded as if each character occupied one column when it occupies two.

## Repro

```ts
truncate("😀😀😀😀", 2);       // "\ud83d~"   ← a lone high surrogate
truncate("😀😀😀😀", 3);       // "😀~"
truncate("認証が失敗する", 6);  // "認証が失敗~" — 6 "units", ~12 terminal columns
```

A ZWJ sequence comes apart into its components:

```
title: 👨‍👩‍👧 — code points: 5, graphemes: 1, terminal columns: 2
truncate(title + " team", 4) = "👨‍~"      ← a man, a dangling ZWJ, and a tilde
truncate(title + " team", 3) = "👨~"
truncate(title + " team", 2) = "\ud83d~"  ← lone surrogate
```

A lone surrogate is not valid UTF-8: written to a terminal it renders as U+FFFD, and a listing piped to a file produces a byte sequence that is not well-formed text.

`truncate` runs on every flexible column whenever the terminal is narrow enough to shrink one, which is the normal case for `title`, `labels`, `assignee` and `reviewer`. The inputs are titles and labels people wrote.

## What it should do

Two changes, and they are independent.

**Slice by code point**, so a cut is never mid-character. One line, and it removes the invalid output outright:

```ts
return `${[...text].slice(0, width - 1).join("")}~`;
```

**Measure terminal columns rather than code points**, if the alignment is worth the code: East Asian Wide and Fullwidth count 2, combining marks count 0, everything else 1. Note that any change here also changes `pad`, so both must move together or the columns get worse rather than better.
