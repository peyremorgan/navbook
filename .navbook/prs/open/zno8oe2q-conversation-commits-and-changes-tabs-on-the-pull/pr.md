---
title: Conversation, Commits and Changes tabs on the pull request page
author: Claude <noreply@anthropic.com>
created: 2026-09-17T23:15:50Z
target: dev
source: feat/sfbidn0t-pr-tabs
reviewer: morgan.peyre@brickcode.tech
labels: [enhancement]
feature: [web, server, pull-requests]
revisions:
  - head: 01e3d8f97a248167418c6a3782a2715d86e1ca24
    base: 6ab7831d7125d93b89d76f5786b4204f51a311e7
    date: 2026-09-17T23:15:50Z
---

Closes #sfbidn0t.

The pull request page gets the three tabs every forge has, kept in the address as `?tab=`: **Conversation** (the page as it was), **Commits** (what the latest revision introduces, `base..head` oldest first, with subject, author, date and short hash) and **Changes** (the diff of that revision against its merge base, file by file). Screenshots are in the issue's `screenshots/`.

## What it adds, layer by layer

**core** — `git/diff.ts`: `commitsBetween(base, head)` and `diffBetween`/`diffBetweenAsync(base, head)`, which run one `git diff` with pinned prefixes and quoting and parse the unified output into one record per file (path, old path, status, counts, binary, hunks). `patches: false` reads `--raw --numstat -z` instead, for a listing that costs a line per file; `paths` narrows to some files. Renames, copies, mode-only changes, binaries, quoted paths and the tab git puts after a path with a space are covered by tests against a real repository.

**server** — `Pr.commits(limit)` and `Pr.changes(paths)` on the schema, and `changes.ts`, a process-wide `RevisionCache` keyed by `base..head`. Two SHAs name an immutable answer, so nothing invalidates it; memory does, least recently used first. Every file of a diff is listed; patches come inline until a per-file budget (1,000 lines) and a whole-diff budget (10,000 lines) are spent, and a file listed without one is asked for by path, answered whatever its size and cut at 20,000 lines with `truncated` set. Those are the numbers GitHub, GitLab and Gitea settled on. A diff too large to keep is kept as a listing and diffed per file on request; a diff that overruns git's buffer or thirty seconds falls back to the listing. Neither field takes the repository lock — the object store is append-only — and git runs asynchronously, so a large diff blocks nobody. The tracker's own files sort last. `MISSING_COMMIT` refuses a revision the clone has not fetched.

**web** — the tab strip, two queries sent only when their tab is opened (`cache-first`, because the answer cannot change under the page), `CommitTable`, `DiffView` and `DiffFile`, and `utils/diff.ts`, which splits a file's hunks into rows with line numbers and marks the changed span within a replaced line. The server sends the hunks as the text git printed, and the browser does the splitting: a 5,000-line diff as JSON objects would be several times the bytes.

## Performance

Measured with `packages/web/script/bench-changes.ts` (kept, documented in the web README) on a clone of go-gitea/gitea, Chromium headless, from the click on the tab to the paint, warm server cache, medians of four runs:

| diff | files | patch lines | wire | summary painted | every row painted |
|---|---|---|---|---|---|
| v1.24.5..v1.24.6 | 30 | 1,086 | 50 KB | 103 ms | 115 ms |
| v1.24.0..v1.24.3 | 136 | 5,065 | 232 KB | 159 ms | 357 ms |
| v1.23.0..v1.23.8 | 362 | 16,430 | 487 KB | 211 ms | 625 ms |
| v1.23.0..v1.24.0 | 2,813 | 289,069 | 1.09 MB | 800 ms | 1,207 ms |

Git itself costs 65 / 128 / 694 ms for the patch of the three larger ones, paid once per process; the largest sends the patches of its first 10,000 lines and lists the other 2,000-odd files. The machine had a load average between 4 and 9 from other work during these runs, so the numbers are conservative and the spread on the largest was 720–910 ms. The first version rendered everything in one flush and painted the 5k diff at about 500 ms; a CPU profile put the cost in components rather than rows, and the 2,813-file diff at four seconds before its first paint, almost all of it a `UButton` per file header. What brought it down:

- files below the fold are rendered in idle batches behind placeholders that reserve their height, so the first paint carries six files;
- the header is plain elements, not components;
- each file and each placeholder is under `content-visibility: auto` with `contain-intrinsic-size` from the server's line count, so offscreen files cost no layout;
- rows are plain `<tr>`s from one `v-for`, kept out of Vue's reactivity with `markRaw`;
- at most 200 placeholders stand below the last rendered file; a line says how many more are coming.

## Tests

- core: `test/diff.test.ts` (parsing, counts, renames, binaries, quoting, ranges).
- server: `changes.test.ts` (budgets, cache hits, in-flight sharing, listing fallback, tracker ordering, missing commits) and `pr-changes.test.ts` through the harness, against a pull request on a fetched branch.
- web: `test/nuxt/diff.test.ts`; `pull-requests.spec.ts` gains the tab in the address bar, the commit list, the file-by-file diff, the withheld file loaded on demand, and the unserved branch. The fixture's pull request branches carry a 1,200-line file so that "Load diff" has something to load.

## Not done

Syntax highlighting: no highlighter is a dependency, and GitHub, GitLab and Gitea all do it server-side with a cache. Reviewing older revisions' diffs: the fields read the latest revision only. Side-by-side view.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
