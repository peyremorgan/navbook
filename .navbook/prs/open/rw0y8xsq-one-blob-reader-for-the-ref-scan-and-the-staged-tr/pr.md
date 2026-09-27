---
title: One blob reader for the ref scan and the staged tree
author: Claude <noreply@anthropic.com>
created: 2026-09-27T20:27:52Z
target: dev
source: refactor/one-blob-reader
reviewer: morgan.peyre@brickcode.tech
labels: [refactor]
revisions:
  - head: 7f0dddb2a44c64609ffa6ffb0fe291aba8c625a3
    base: ec8ba495941cf3a33b40c41434b926fa29af77f8
    date: 2026-09-27T20:27:52Z
---

Follow-up to #krc96gzg, as noted in its review: the `doctor --staged` fix (#d8oflfva) and the ref-scan fix each added their own SHA-keyed `cat-file --batch` reader.

## Change

There is now one reader, in `packages/core/src/git/blobs.ts`:

| | Before | After |
|---|---|---|
| `cat-file --batch` spawns | `index-ops.ts` `catObjects`, `refscan.ts` `catObjects` | `blobs.ts` `catObjects` |
| SHA-keyed batched read | `stagedTree`'s inline chunk loop, `refscan.ts` `readBlobsBySha` | `blobs.ts` `readBlobsBySha` |
| `--batch-check` sizing | `index-ops.ts` `blobSizes` (private) | `blobs.ts` `blobSizes` |

Where the two copies differed, the shared reader takes the stricter behaviour of each:
- **Buffer:** sized to each batch, as the staged tree did, not the scan's fixed 256 MB cap. A blob larger than one batch is read alone instead of being refused.
- **Header:** the type is checked, as the staged tree did. A spec naming a tree reads as absent, not as tree bytes.
- **Early exit:** a git that exits before reading its input is reported with git's own message, which only the scan did. The staged tree's copy threw the raw `EPIPE`.

Unchanged interfaces:
- `catBlobs` keeps its `<ref>:<path>` keys and fixed cap, for callers that don't know sizes.
- `stagedTree` keeps its prefetch policy and its lazy `cat-file blob` for a large blob.
- `lsTreeEntries` stays in `refscan.ts`.

Net: −273 / +23 lines in the modified files, plus the new `blobs.ts` (140).

## Tests

- `test/blobs.test.ts` takes the `readBlobsBySha`, EPIPE and `gitRun` tests from `refscan.test.ts`. New tests:
  - `blobSizes` sizes blobs, and throws on a tree or an unknown name;
  - `catObjects` reads by path and by SHA, and leaves out missing and non-blob specs.
- `staged-tree.test.ts` passes unchanged, including its trace of batch and lazy reads.
- Full run: typecheck (root, core, cli, server, plugin-kb) and biome clean; core 865, cli 397, server 370, plugin-kb 138, conformance 126, deploy 68, 0 failures.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
