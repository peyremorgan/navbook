---
title: Measure and cut listing cells by terminal column, not by code unit
author: Claude <noreply@anthropic.com>
created: 2026-09-27T03:01:15Z
target: dev
source: fix/ozzaoa36-table-width
reviewer: morgan.peyre@brickcode.tech
labels: [bug, cli]
revisions:
  - head: cf1fbf943a449d2fb6b02c42504cdca14e103e87
    base: 06627058b2477b40c8a50cfc7c2efa40f5e97e59
    date: 2026-09-27T03:01:15Z
  - head: 054af45112c2c6a6db0a1870c27d9508890f1bb8
    base: ee73ae873ddbdd61565b5e38cf9b44281288baf4
    date: 2026-09-27T03:25:29Z
merged:
  date: 2026-09-27T03:25:59Z
  by: Claude <noreply@anthropic.com>
---

Fixes #ozzaoa36 (audit finding 06).

Listing cells were measured in code points and cut in UTF-16 code units. A narrow `nav issue list` could split an emoji's surrogate pair, which the terminal shows as U+FFFD, and a CJK title was padded as if each character took one column, which pushed every later column out of line. The issue's comments hold the reproduction on `dev`.

## What changed

- **`displayWidth` → `string-width`** (`packages/cli/src/render/table.ts`). It measures terminal columns from the UAX #11 table. `pad` and the column widths read it too, so they are fixed with it.
- **`truncate` walks grapheme clusters** (`Intl.Segmenter`, built into Node 24). It keeps whole clusters while they fit beside the `~`. A ZWJ family or an accented letter written with a combining mark is kept whole or dropped whole. When a wide character doesn't fit, the result can be one column short of the width; `pad` fills the gap.
- **Dependency.** `string-width@^8.2.2` goes in `@navbook/cli` only. It and its two dependencies (`get-east-asian-width`, `strip-ansi`) were already locked as transitive dependencies, so the lockfile gains only the three-line importer entry. The lockfile was edited by hand and checked with `pnpm install --lockfile-only --frozen-lockfile --offline` on a copy of the manifests: it passes, and the old lockfile fails with `ERR_PNPM_OUTDATED_LOCKFILE … 1 dependencies were added: string-width@^8.2.2`. A checkout needs `pnpm install` after merging to link it.
- **Spec 05 §5.2** now lists the CLI's three dependencies and says why presentation dependencies may live in the CLI, which is the justification the rule asks for.

## Tests

`packages/cli/test/cli/render.test.ts` is new, with 10 cases on `truncate` and on `renderTable` with emoji, CJK, ZWJ and combining-mark text. They check that output is well-formed UTF-8, never wider than its width, and aligned at every width. They measure with `string-width` directly, not with the module's own `displayWidth`, so a wrong measure can't pass by agreeing with itself. Against the unfixed `table.ts`, 9 of the 10 fail.

The tests work on the renderer rather than spawning `nav issue list`, because the harness spawns its child on pipes: `stdout.columns` is undefined there and nothing is ever cut.

- `tsc --noEmit` (root and the CLI build config), `biome check .`: clean
- CLI suite: 373 pass, 0 fail
- Conformance: 119 pass, 0 fail

## Before and after

`nav issue list` in a 44-column terminal:

```
before
Plain ASCII title f~  bug
認証が失敗する場合のタイムアウト処理を~  バグ
😀😀😀😀😀😀😀😀😀�~

after
Plain ASCII title f~  bug
認証が失敗する場合~   バグ
😀😀😀😀😀😀😀😀😀~
```

## Not changed

- A piped listing (`nav issue list > file`) is never truncated, as before: without a TTY there is no width. Only its padding changes.
- The title column's `minWidth: 20` floor still lets a very narrow terminal's header overflow, as it does with ASCII titles.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
