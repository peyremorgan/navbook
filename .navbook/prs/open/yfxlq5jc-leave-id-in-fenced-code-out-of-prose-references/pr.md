---
title: "Leave #id in fenced code out of prose references"
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
---

Fixes #t1kpljkt. Five of the D8 warnings `nav doctor` gives on `dev` point at IDs inside code: pasted terminal output in two comments and one PR description, and `` `nav pr show '#id'` `` in two merged PR descriptions. Spec 02 §2.9 defines references in prose, and the web client doesn't link any of these IDs. D8 still counted them.

## Change

**`packages/core/src/core/refs.ts`.** `extractProseRefs` now blanks code before matching.

- **Fenced blocks** (CommonMark §4.5):
  - Backtick and tilde fences both count, with or without an info string.
  - A fence inside a list item or a `>` quote counts too.
  - A fence closes on a run of its own character at least as long as the one that opened it, with nothing after it. A fence nobody closed runs to the end of the document.
  - A backtick run whose "info string" contains a backtick is inline code, not a fence.
- **Code spans** (§6.1): a run of backticks closed by a run exactly as long, within one paragraph. The old guard skipped a reference only when a backtick came right before its `#`, so `'#id'` inside a span still counted. An unmatched run stays literal text, which is how markdown-it reads it.

`feature.ts` reads commit messages with the same function, so a feature's history now also ignores IDs in code in a commit body.

**Tests.**

- `packages/core/test/refs.test.ts` has eight new cases for fences and code spans. Six of them fail on `dev`.
- `packages/web/test/nuxt/markdown.test.ts` renders a document made mostly of fences and code spans, including a stray backtick, and asserts that the `/ref/` links markdown-it produces are exactly `extractProseRefs` of the same source. `test/node/references.test.ts` already held the two grammars together line by line. This extends that to the block level, where fences and spans live. It fails on `dev`.

## Verification

- `nav doctor` from this branch on this tree: the five warnings are gone, and nothing new appears.
- Three D8 warnings remain:
  - `#sf9fu6z4` in #t4mwvm2j and `#kl6ebnrs` on #z3j95v3e are real prose references to IDs that exist in no branch here. They are fixed separately on `dev`.
  - `#na3o4794` in #tvxw30h3 names an open PR on its own branch, and clears when that PR merges.
- The two D10 warnings are #feu6fmzu's to fix. This PR names #feu6fmzu, so merge that one first.
- `biome check .`, `tsc --noEmit` (root and core), and `nuxi typecheck` are clean.
- Suites: core 802, cli 363, server 375, conformance 119, web vitest 374, all passing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
