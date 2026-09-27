---
title: Make D10's timestamp check return what it says, and give D10 its first fixtures
author: Claude <noreply@anthropic.com>
created: 2026-09-27T01:47:38Z
target: dev
source: fix/ze71ym9e-timestamp-predicate
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement, doctor]
feature: [doctor, conformance]
revisions:
  - head: 232dae5cfed4c35dc076be6f8f81d139a49d18ad
    base: 25f48ac623c5253b06e8209f9b684a024a4bd515
    date: 2026-09-27T01:47:38Z
  - head: 097b87388b1bec422efe4917fe1ba1d1be28848e
    base: b78bafa6cc846b3487ad7b25e568aae9b4345904
    date: 2026-09-27T02:20:20Z
---

Fixes #ze71ym9e, finding 11 of the September audit.

`checkTimestampSkew`'s doc comment asked whether a timestamp is *implausible*, but the function returned `true` when the timestamp was plausible. Both call sites negated it, so D10 itself was correct. The problem was the contract, in the layer spec 05 §5.2 says a reimplementation must copy function for function.

## Changes

- **`packages/core/src/core/validate.ts`.** `checkTimestampSkew` now returns `{ ok: true } | { ok: false; deltaHours }`, following the plan's step 2 and the same shape as `checkRevisionsAppendOnly` beside it. The name stays: with a result instead of a boolean, "check" no longer implies a polarity, and it matches its neighbour. The doc comment says where the reference threshold lives.
- **`packages/core/src/workspace/history-checks.ts`.** Both D10 call sites read `skew.ok`, and the warning now gives the actual gap:
  ```
  warning  D10  …/issue.md: 'created: 2025-09-01T10:00:00Z' is 8760h from the commit that added it (2026-09-01), more than 48h
  ```
  Before this change it said only "more than 48h". Spec 04 says diagnostic wording is implementation-defined, and no test or fixture compares it.
- **`packages/core/test/validate.test.ts`.** Asserts the new shape, including `deltaHours` in both directions, and adds a case where the gap is exactly the threshold (inclusive).
- **Conformance.** These are the first D10 fixtures:
  - `format/invalid/d10-timestamp-skew` has an issue `created:` and a comment filename, each a year before the commit that added them. It expects exactly two D10 warnings and `exit: 0`. A year is far outside any reasonable threshold, so no second implementation is held to our 48h. It uses `init: {from: tree, date: …}`, so no `history:` is needed.
  - `format/valid/timestamps-match-history` has the same tree an hour off, and expects `diagnostics: []`.

## Verification

- `biome check .`, and `tsc --noEmit` for the root and core: clean.
- Core: 762/762. CLI: 346/346. Conformance: 119/119, which includes the two new cases.
- **Mutation check.** With the comparison flipped to `deltaHours > thresholdHours`, the mistake a reimplementer would make from the old comment, both new fixtures fail. With the fix in place, both pass.

Out of scope, as the plan notes: D7 and D9 still have no fixtures.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
