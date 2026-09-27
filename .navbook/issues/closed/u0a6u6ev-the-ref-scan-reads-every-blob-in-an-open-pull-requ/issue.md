---
title: The ref scan reads every blob in an open pull request's directory, on every ref
author: Claude <noreply@anthropic.com>
created: 2026-09-27T10:10:42Z
assignee: Claude <noreply@anthropic.com>
labels: [performance, bug]
feature: [pull-requests, plugins]
resolution: fixed
---

Follow-up to #egvv9205 (merged in #zhdz48sn), which stopped `readNavTree` from reading files `parseTree` never parses. The same waste is still in the other tree reader: the ref scan behind `nav pr list --all-refs`, `nav pr merge` and `locatePr`.

## Where

`scanRefsForOpenPrs` in `packages/core/src/ops/pr.ts:374`. For every branch ref and every directory under `prs/open/`, it lists the directory recursively and `cat-file`s **every** blob in it:

```ts
const paths = lsTreeRecursive(cwd, ref.full, dirPath);
if (paths.length === 0) continue;

const blobs = catBlobs(
  cwd,
  paths.map((path) => ({ ref: ref.full, path: `${dirPath}/${path}` })),
);
```

`parseTree(files).prs[0]` then parses only `pr.md` and `comments/*.md`. Everything else in the directory, the §2.12 per-entity namespace (`reports.json`, `<short>/`), goes into `extraFiles` as a path, and its bytes are dropped.

## Why it matters

- **Multiplied by refs.** A PR's directory is on its source branch, and on every local and remote-tracking ref that contains it. So a test-report plugin's `prs/open/<id>/reports.json` is read and UTF-8-decoded once per ref, on every `--all-refs` listing and every merge.
- **A silent-loss edge.** `catBlobs` (`packages/core/src/git/refscan.ts:68`) runs one `git cat-file --batch` with `maxBuffer: 256 MB`, and returns an **empty map** on any spawn error. If one PR directory's blobs exceed that, the whole batch for that directory comes back empty: `pr.md` is missing and the PR disappears from the listing with no error. Uninterpreted plugin data can therefore hide a pull request.
- Binary data under the namespace is decoded to U+FFFD for nothing, as it was in #egvv9205.

## Suggested fix

Keep `lsTreeRecursive` (it is what fills `extraFiles`), and `cat-file` only what `parseTree` will ask for. Two options:

1. **Mirror #zhdz48sn.** Build a lazy `NavTree` whose `keys()` is the ls-tree listing and whose `get()` fetches on demand. `get` is called once per file, though, so a naive version is one `cat-file` per file. It would have to batch: collect the paths `classify` routes to parsing, then make one `catBlobs` call.
2. **Filter before batching.** Request only `pr.md` and `comments/*.md`. That is simpler, but it is a second reader of the entity-directory grammar that `classify` already owns, which is the drift #egvv9205's plan chose to avoid.

Option 1 fits the direction #zhdz48sn set. Whichever is chosen, a `catBlobs` failure should probably be reported rather than turned into "no PR here".

## Test that would catch it

A branch whose open PR directory holds `pr.md` plus a `reports.json` blob: assert `scanRefsForOpenPrs` still finds the PR with `reports.json` in `extraFiles`, and that the `cat-file` batch never requested it (inject or wrap `catBlobs`).
