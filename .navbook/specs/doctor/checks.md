---
title: Checks
---

## What exists

`nav doctor` reads the tree (or, with `--staged`, the index) and reports every fault it finds under a check code, an error or warning level and a path. Errors exit 2; warnings exit 0 (spec 04 §4.3). `--json` emits one diagnostic per line, and the conformance suite compares code, level and path only.

| Check | Decided from | Level |
|---|---|---|
| D1 names, D2 frontmatter, D3 unique IDs, D4 one status directory, D5 reply targets, D6 review revisions | the tree | error |
| D7 revisions append-only, D9 merged-but-not-archived, D10 timestamp skew (48 h) | git history; skipped under `--staged` or where history is missing | D7 error, D9 and D10 warning |
| D8 dangling references, in prose, frontmatter and the last 100 commits' trailers | the tree plus recent history | warning |
| D11 link disagreement, D12 parent loop | the tree | error |
| D13 the layout and schema of `specs/`, D14 dangling `feature:` | the tree | D13 error, D14 warning |

`--fix` applies what can be settled without discarding anything anybody asserted: reuniting a comment stranded by the first-comment race, archiving a merged pull request, and the D11 repairs the tree or git history can decide. Repairs are judged together, and one that would only close a loop between them is withdrawn. Two issues claiming one subtask is settled by history, letting the last claim stand; where history cannot say, or a claim names an issue this tree lacks, the fault is reported rather than guessed at.

`nav install --hooks` installs a thin `pre-commit` hook that runs `nav doctor --staged` and blocks on errors only.

## Where it lives

- Pure checks: `packages/core/src/core/validate.ts`, `links.ts`
- History-fed checks: `packages/core/src/workspace/{history-checks,link-conflicts}.ts`
- Driver: `packages/core/src/ops/doctor.ts`; hook: `packages/cli/src/install/hook.ts`
- API: `doctor` (read-only; `--fix` is not exposed)

## Drift from the specification

None found. Every check in the table of spec 04 §4.3 is implemented at the level it names, and the 48-hour D10 threshold the spec requires implementations to document is `TIMESTAMP_SKEW_HOURS`.
