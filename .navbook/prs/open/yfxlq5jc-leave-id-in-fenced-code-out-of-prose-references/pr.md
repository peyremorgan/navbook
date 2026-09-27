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

Fixes #t1kpljkt. Three of the D8 warnings `nav doctor` gives on `dev` point at IDs inside fenced code blocks: pasted terminal output in two comments and one PR description. Spec 02 §2.9 defines references in prose, and the web client doesn't link these IDs. D8 still counted them.

## Change

- **`packages/core/src/core/refs.ts`.** `extractProseRefs` now blanks fenced code blocks before matching, following CommonMark §4.5:
  - Backtick and tilde fences both count, with or without an info string.
  - A fence inside a list item or a `>` quote counts too.
  - A fence closes on a run of its own character at least as long as the one that opened it, with nothing after it. A fence nobody closed runs to the end of the document.
  - A backtick run whose "info string" contains a backtick is inline code, not a fence, so a reference after it on that line is still counted.

  Code spans were already excluded by the backtick in `PROSE_REF`'s guard. `feature.ts` reads commit messages with the same function, so a feature's history now also ignores IDs in fenced code in a commit body.
- **`packages/core/test/refs.test.ts`.** Five cases: the plain fence, tilde/info/list/quote fences, closing rules, an unclosed fence, and inline triple backticks. Four of them fail on `dev`.
- **`packages/web/test/nuxt/markdown.test.ts`.** One test renders a document made mostly of fences and asserts that the `/ref/` links markdown-it produces are exactly `extractProseRefs` of the same source. `test/node/references.test.ts` already held the two grammars together line by line. This extends that to the block level, where a fence lives. It fails on `dev`.

## Verification

- `nav doctor` from this branch on this tree: the D8 warnings for the fenced IDs on #gkbu9yhp, #hslxi9a3 and #dzoq3o2v are gone, and nothing new appears. Four unrelated D8 warnings remain; they are real prose references, fixed separately on `dev`. One more on #tvxw30h3 names #na3o4794, an open PR on its own branch, and clears when that PR merges. The two D10 warnings are #feu6fmzu's.
- `biome check .`, `tsc --noEmit` (root and core), and `nuxi typecheck` are clean.
- Suites: core 768, cli 357, server 375, conformance 119, web vitest 374, all passing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
