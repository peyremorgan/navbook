---
title: nav doctor --staged spawns one git process per file in the tree, on every commit
author: Claude <noreply@anthropic.com>
created: 2026-09-27T10:10:43Z
assignee: Claude <noreply@anthropic.com>
labels: [performance, doctor]
feature: [doctor, plugins]
resolution: fixed
---

Follow-up to #egvv9205 (merged in #zhdz48sn). `nav doctor --staged`, which is what the pre-commit hook that `nav install` writes runs (`packages/cli/src/install/hook.ts:33`), still reads every file in the tree, and it pays for each file with its own `git` process.

## Where

`stagedRepo` in `packages/core/src/ops/doctor.ts:120`:

```ts
const paths = allIndexedNavPaths(ws).filter((path) => path.startsWith(prefix));
const files = new Map<string, string>();
for (const path of paths) {
  const content = stagedContent(ws.repoRoot, path);
  if (content !== null) files.set(path.slice(prefix.length), content);
}
return parseTree(files);
```

and `stagedContent` (`packages/core/src/git/index-ops.ts:17`) is `gitRun(["show", `:${path}`])`: one spawn per indexed file.

## Measured

On this repository at `1f34c63`, with 261 files indexed under `.navbook/` (144 entity/spec/marker files and `.gitkeep`s, 112 comments):

```
strace -f -e trace=execve nav doctor --staged
  261 × git show :<path>     (1827 execve calls = 261 spawns × 7 PATH entries tried)
nav doctor --staged: 3029–3649 ms
```

About 3 s added to every commit in a repository with `nav install`'s hook. It grows linearly with the tree, including every comment and every file of extension data under §2.12, whose bytes `parseTree` never looks at. This is the worst version of what #egvv9205 described: extension data costs a process spawn per file, on every commit.

## Suggested fix

Two independent parts:

1. **Batch.** Read the index in one `git cat-file --batch` process. `catBlobs` (`packages/core/src/git/refscan.ts:68`) already speaks the protocol, and `:<path>` is the index's object name, so it may be usable as is with an empty ref. That removes the per-file spawn, which is most of the 3 s.
2. **Read only what is parsed.** Return a lazy `NavTree` as `readNavTree` now does, so extension data under §2.12 and a feature's images are never fetched. The `get()`s would need batching, as for the ref scan in #u0a6u6ev.

**A behaviour detail to decide.** Today a path whose `git show :path` fails (`stagedContent` returns `null`) is left **out of the tree entirely**, so it is never classified. A lazy tree lists every path and fails only when it is read. That matches the working-tree reader after #zhdz48sn, but it turns a silently skipped path into a failure of the hook. Check when `git show :path` can fail for a path `ls-files --cached` just listed. The `stagedPaths` fallback in `allIndexedNavPaths` (`doctor.ts:136`), used when the index lists nothing, looks like the case that can produce such paths (a staged deletion).

## Test that would catch it

A repository with N staged Navbook files: assert `doctor --staged` spawns a bounded number of `git` processes (inject `gitRun`, or count through a `GIT_TRACE` log), and that a staged `.navbook/reports/*.json` is listed in `reserved` without being read.
