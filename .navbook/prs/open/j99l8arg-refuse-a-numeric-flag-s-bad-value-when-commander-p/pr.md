---
title: Refuse a numeric flag's bad value when commander parses it
author: Claude <noreply@anthropic.com>
created: 2026-09-27T10:19:25Z
target: dev
source: fix/kw143sq9-numeric-flags
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: cli
revisions:
  - head: 1398bf05cbd72ef4f6fbb8ec089f959d1321c903
    base: 47b8901f9b5722b952b96dd4818e59be38182cc5
    date: 2026-09-27T10:19:25Z
  - head: 0262d34297280beb953e3527e9cd00a3ac23fa68
    base: 60525861c8559de43bb32d849ba13c77f6975e14
    date: 2026-09-27T10:53:34Z
---

Fixes #kw143sq9 by following the implementation plan in that issue: every numeric flag in the CLI now refuses a bad value at parse time.

## What was wrong

- `nav feature show --commits`: the value was parsed to a `Number` so the command could refuse it, but nothing refused it. `abc`, `-1` and `""` dropped the history section, which looks exactly like `--commits 0`. `2.5` reached git as `-n 2.5`, git refused it, and the command printed `recent commits (0): none`. Every one of these exited 0.
- `nav id -n/--count`: `Number.parseInt` truncated the value before `mintIds` could check it, so `-n 2.5` minted 2 IDs and `-n 3abc` minted 3, both with exit 0. The issue didn't list this flag; I found it while confirming.
- `Feature.commits(limit: -1)` in the API answered `[]`, where `Pr.commits` refuses the same limit with `INVALID_INPUT`.

## The change

- **New `packages/cli/src/args.ts`:** two parsers that throw commander's `InvalidArgumentError`, so a bad value never reaches a command.
  - `wholeNumber(unit, min = 0)` handles `--commits`, `--depth` and `--count` (with a minimum of 1). It refuses blank input explicitly. The plan's sketch would have accepted it, because `Number("")` is `0`, so `--commits ""` would silently have meant "omit the history".
  - `finiteNumber` handles `--rank`, which is a position rather than a count: negative numbers, decimals and `0` stay valid (spec 02 §2.5).
- **Removed checks:** `cmdShow` (`--depth`) and `cmdIssueOpen` (`--rank`) no longer check these values, because those checks can't be reached any more. `mintIds` in core keeps its own check, since core can't rely on a front end having validated its input.
- **Server:** `Feature.commits` refuses a negative limit with `INVALID_INPUT`, using the same check as `Pr.commits`.

## Behaviour change

A bad value is now a commander usage error instead of a one-line `nav:` error. The exit code is still 1. As the plan recommended, `showHelpAfterError` is unchanged.

```console
$ nav feature show auth --commits 2.5
error: option '--commits <n>' argument '2.5' is invalid. Expected a whole number of commits.
```

Anything that greps stderr for `nav: --depth …` or `nav: --rank must be a number` will need updating. That is worth a line in the release notes.

## Tests

- **New CLI cases:** `--commits` refuses `abc`, `2.5`, `-1`, `""` and `" "`, with nothing on stdout. `--count` refuses `2.5`, `3abc`, `0`, `-1` and `""`. `--rank -3.5` is still accepted.
- **New server case:** `Feature.commits(limit: -1)` returns `INVALID_INPUT`.
- **Checked against the old code:** with the `src/` changes reverted, all three new tests fail. With the fix, they pass.
- **Updated assertions:** the existing `--rank` and `--depth` tests now expect the new wording.
- **Full runs:** `biome check`, root and server `tsc` are clean. CLI 378/378, server 378/378 and conformance 119/119 pass.

No conformance fixture pins any of these messages.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
