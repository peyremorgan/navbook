---
title: "Leave #id in fenced code and code spans out of prose references"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T02:48:09Z
target: dev
source: fix/t1kpljkt-fenced-refs
reviewer: morgan.peyre@brickcode.tech
labels: [bug, doctor]
assignee: Claude <noreply@anthropic.com>
feature: doctor
revisions:
  - head: 09d704899ac8948de1e873baa074e0cc8783d642
    base: 0a7201f71e619c06b58f447c6f0c1ef2f3245b65
    date: 2026-09-27T02:48:09Z
  - head: 50e28d87b19569176928c6bb56d0b74b65aa10f9
    base: 0a7201f71e619c06b58f447c6f0c1ef2f3245b65
    date: 2026-09-27T02:59:19Z
  - head: 04c2ca5d3d4e8d1b9bd1a538bc6251960b80415a
    base: 63a0de2d16959d3e90232b3efdb3de5a1024f064
    date: 2026-09-27T03:34:09Z
merged:
  date: 2026-09-27T08:50:23Z
  by: Claude <noreply@anthropic.com>
  commit: 0922ccf995bacfcb724cd57af39c53dd87ed7b4f
---

Fixes #t1kpljkt. Five of the D8 warnings `nav doctor` gave on `dev` point at IDs inside code: pasted terminal output in two comments and one PR description, and `` `nav pr show '#id'` `` in two merged PR descriptions. Spec 02 §2.9 defines references in prose, and the web client doesn't link any of these IDs. D8 still counted them.

## Change

**`packages/core/src/core/refs.ts`.** `extractProseRefs` now blanks code before matching. It follows the part of CommonMark that decides where code is, and no more.

- **Line endings.** CRLF is normalised first.
- **Fenced blocks** (§4.5):
  - Backtick and tilde fences both count, with or without an info string.
  - A fence may open after indentation, `>` markers or a list marker on its own line.
  - It closes on a run of its own character at least as long as the opener, with nothing after it. It also closes when the quote or list item it sits in ends. Otherwise it runs to the end of the document.
  - A backtick "info string" that contains a backtick is inline code, not a fence.
  - A run indented four or more columns past where a fence could open only continues the paragraph above it.
- **Code spans** (§6.1): a run of backticks closed by a run of exactly the same length, within one paragraph. A heading is a one-line paragraph, and a line that starts a block ends the paragraph. An unmatched run is literal text.
- **Backslash escapes** (§2.4): an escaped backtick opens no span. An escaped `#` is not a reference, which is how the web client already read `\#id`.

`feature.ts` reads commit messages with the same function, so a feature's history now also ignores IDs in code.

**Tests.**

- `packages/core/test/refs.test.ts` has eight new cases.
- `packages/web/test/nuxt/markdown.test.ts` has a table of 18 constructs, each run through markdown-it and `extractProseRefs`. Both must give the same set: the ID in code or behind an escape is never linked, and the one in the prose after it always is. `test/node/references.test.ts` already held the two grammars together line by line; this does the same at the block level, where code lives.

## Verification

- `nav doctor` from this branch on current `dev`: all five warnings are gone, and nothing new appears.
- What's left:
  - `#na3o4794` in #tvxw30h3 names an open PR on its own branch, and clears when that PR merges.
  - This PR names #feu6fmzu, so merge #feu6fmzu first.
- `biome check .`, `tsc --noEmit` (root and core), and `nuxi typecheck` are clean.
- Suites: core 804, cli 363, server 375, conformance 119, web vitest 375, all passing.

## Review

`/code-review high` on revision 2 found six inputs where D8 and markdown-it disagreed:
- a fence on a list-marker line
- a fence whose container ended
- an indented ``` continuing a paragraph
- spans crossing list items or headings
- escaped backticks
- CRLF

All six are fixed in revision 3 and are in the table.

Its seventh point was to share one parser by tokenising with markdown-it in core. I didn't take it. Spec 05 keeps the core to one dependency, with each addition justified for the Rust rewrite and against the import budget, and a whole Markdown parser to decide where code is would be hard to justify. The table is what keeps the two readers in agreement instead. Two rare differences remain, and the comment in `refs.ts` names them:
- A fence indented two or three spaces inside a list item's continuation is closed by the item's end.
- A code span does not continue onto the next `>` line of a quote.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
