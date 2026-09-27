---
title: Compute every baseSha from the text, as entities already did
author: Claude <noreply@anthropic.com>
created: 2026-09-27T01:55:00Z
target: dev
source: fix/qjzq3024-one-base-sha
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: c2bc6d9013f5c7e84bcb8ad06e0615b809217444
    base: 25f48ac623c5253b06e8209f9b684a024a4bd515
    date: 2026-09-27T01:55:00Z
  - head: 1ef6b7083b39a60abcc900a3e7c1bd1c8b80283f
    base: 25f48ac623c5253b06e8209f9b684a024a4bd515
    date: 2026-09-27T02:15:39Z
  - head: 62081bba8dc7b517c68cf0bac5bb46d7baf6c408
    base: b78bafa6cc846b3487ad7b25e568aae9b4345904
    date: 2026-09-27T02:23:23Z
  - head: 81e522c5914c1a8f5509a5513a5c69ca1778c040
    base: 1832db64029ac0607013f23b224330bc881e921d
    date: 2026-09-27T02:51:52Z
---

Fixes #qjzq3024, following the implementation plan on the issue: everything moves onto core's `blobSha`.

## What changes

- **`core/tree.ts`**: `FeatureRecord` and `SpecRecord` gain `blobSha`, set in `materializeFeature` from the text it parsed, exactly as `EntityRecord.blobSha` already was.
- **`ops/feature.ts`**: `assertUnchanged` compares the client's `baseSha` against the record's hash instead of running `git hash-object` on the file. The record comes from `findFeature` in the same load, so there is no second read and no window between the check and the write. The last import from `git/` in this file goes with it.
- **`resolvers/feature.ts`**: the `HASHES` `WeakMap`, `hashesOf` and `hashOf` are deleted (about 45 lines). `Feature.baseSha` and `Spec.baseSha` now read `record.blobSha`, matching `sharedFields`' `baseSha` for entities. The `Feature`/`Spec` projections run no subprocess apart from `commits`.
- **`schema.graphql`**: the four `baseSha` fields stop claiming to be "the blob hash". `Issue.baseSha` carries the full description: an opaque token, shaped like a git blob hash but not one. The other three refer back to it. Both codegen outputs are regenerated (descriptions only, no type changes).
- **Comments**: `hash.ts` states its own position (a function of the text, deliberately not asked of git). `index-ops.ts` says `hashObjects` is git's answer and not what a `baseSha` is. `assertFieldsUnmoved` says its `cat-file` lookup of an older version is best-effort, with the configurations it misses. The server README says the same in one clause.

`hashObjects`/`hashObject` stay exported and are now unused in production code (point 7 of the plan: keep them, with a comment).

## Tests

- **`server/test/server/features.test.ts`**, new `baseSha under a clean filter`: gives the server's clone a clean filter on its own test files, checks that git's stored blob really differs from the text's hash, then asserts that `Issue.baseSha` and `Feature.baseSha` are both `blobSha` of the text on disk and that both round-trip through `updateIssue`/`updateFeature`. **Against `dev` it fails**: `Feature.baseSha` came back as git's filtered hash (`31ae5d64…`) where the text hashes to `9e1ef212…`.
- **`core/test/feature-ops.test.ts`**: the three `hashObject` calls read the record's hash instead. Two new cases: under `core.autocrlf=true` with CRLF on disk, the feature's hash is of the CRLF text (git would say otherwise) and an edit carrying it lands; and a record's hash is of the text it was parsed from, so a write carrying it after the file changed behind the tool's back is refused and the other write survives.
- **`server/test/server/stale.test.ts`**: the assertion that `Issue.baseSha` equals `git hash-object` stays, since the server's clone has no filters. Its comment now says that is why it holds.

## Checks, run in the worktree

| | |
|---|---|
| `biome check .` | clean |
| `tsc --noEmit`: root, core, server, cli | pass |
| codegen, server and web | regenerated and committed |
| core | 763 pass, 0 fail |
| server | 376 pass, 0 fail |
| cli | 346 pass, 0 fail |
| web (vitest) | 373 pass |
| conformance | 117 pass, 0 fail |
| deploy | 59 pass, 0 fail (the other 4 of `dev`'s 63 read the built web bundle, which the worktree does not have) |

## Risk

A browser holding a page rendered before the deploy sends back the old hash. In the default configuration the old and new hashes are identical, so nothing happens. In a filtered repository the save is refused as stale, and a reload fixes it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
