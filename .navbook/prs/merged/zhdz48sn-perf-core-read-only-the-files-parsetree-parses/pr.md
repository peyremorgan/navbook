---
title: "perf(core): read only the files parseTree parses"
author: Claude <noreply@anthropic.com>
created: 2026-09-27T03:34:18Z
target: dev
source: fix/egvv9205-lazy-nav-tree
reviewer: morgan.peyre@brickcode.tech
labels: [performance]
revisions:
  - head: e0b802695556eb96dbe180acffc755df81f68934
    base: 63a0de2d16959d3e90232b3efdb3de5a1024f064
    date: 2026-09-27T03:34:18Z
  - head: dca29cc9b3c705278d23d95804d4824e9ca6eeed
    base: 27e46ef43e1ebe2aaff472dd43e931e4d6caefef
    date: 2026-09-27T09:09:39Z
merged:
  date: 2026-09-27T09:44:24Z
  by: Claude <noreply@anthropic.com>
  commit: 72b7f18f012a145277369e522289877708aa8df9
---

Fixes #egvv9205.

`readNavTree` read every file under the Navbook directory, and `parseTree` threw away the content of everything it doesn't parse: the §2.12 extension namespaces (`reports/…`, an entity's `reports.json`) and a feature's images (§2.11, which were being decoded into U+FFFD). This follows the lazy-`NavTree` plan in the issue's implementation-plan comment.

## Change

- `NavTree` (`core/tree.ts`) is now `{ keys(); get() }`, the only two operations `parseTree` uses. A `Map` still satisfies it, so `stagedRepo`, the ref scan and every test that builds a tree from a `Map` are unchanged.
- `readNavTree` (`workspace/workspace.ts`) walks paths eagerly and reads a file only when `get` asks for it. It remembers what it read, because an entity file is asked for twice (to parse it and to hash it). The comment-scope pruning of `comments/` directories is unchanged.
- A file that is parsed and can't be read still fails the load, as before. `get` throws the original error, and `parseOrReport` reads outside its `try` so the error isn't recorded as a parse failure. The only change is that an unreadable file that nothing parses no longer fails the command.

`Repo.reserved` and `extraFiles` are unchanged: every path is still listed, only the bytes go.

## Evidence

The repro from the issue (one issue, a 24 MB `.navbook/reports/coverage.json`, a per-entity `reports.json`, a PNG in a feature), traced with `strace -e openat`:

| | before | after |
|---|---|---|
| `.navbook` files opened by `nav issue list` | every file, including the 3 above and each `.gitkeep` | `issue.md`, `feature.md`, `navbook.json` |
| tree load, maxRSS | 142 MB | 97 MB |
| `nav issue list` wall clock | 327–353 ms | 275–278 ms |

## Tests

`packages/core/test/tree.test.ts` gets two new tests. The first makes the three uninterpreted files unreadable (`chmod 000`) and checks they still appear in `reserved`/`extraFiles` with no problems. The second checks that an unreadable `issue.md` still throws `EACCES` rather than being dropped. The first fails on `dev` with `EACCES`, and both pass here. They skip when run as root, where permissions prove nothing.

Also run in the worktree: biome, `tsc --noEmit` (root, core, server, cli), after rebasing onto `dev` at `27e46ef`: core 814/814, server 377/377, cli 376/376, conformance 119/119, deploy 59/59. The other 4 deploy tests need a web build.

One flaky run: the first full server run failed `the TreeCache watchdog › looks at once when started…`, a 57 ms timer test that injects its own loader. It passed 4 of 4 runs on its own and in the full rerun.

## API

`@navbook/core` is published. `NavTree` changes from `ReadonlyMap<string, string>` to `{ keys(); get() }`, so a caller that passes a `Map` is unaffected. A caller that used the result of `readNavTree` as a `Map` (`.size`, `.has`, `.entries()`, iteration) is not. Nothing in this repository does. There is no changelog, so this note is the record.

## Not in this PR

`stagedRepo` (`ops/doctor.ts`, behind `nav doctor --staged` and so the pre-commit hook) still reads eagerly, spawning one `git show :path` per file in the index, extension data included. It could return the same lazy shape. I left it out because a path whose `git show` fails is currently dropped from the tree, and making it lazy would turn that into a "could not be read" problem, which is a behaviour change worth its own issue. The same goes for the ref scan behind `nav pr list --all-refs` (`scanRefsForOpenPrs`): it still `cat-file`s every blob under an open PR's directory on every branch, including a per-entity `reports.json`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
