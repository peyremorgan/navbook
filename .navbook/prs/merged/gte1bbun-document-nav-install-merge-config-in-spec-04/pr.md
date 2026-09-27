---
title: Document nav install --merge-config in spec 04
author: Claude <noreply@anthropic.com>
created: 2026-09-27T01:40:37Z
target: dev
source: fix/e9v8jyz3-spec-merge-config
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: a4fbe39c9b77c5544484c2d916e123de4d32308e
    base: 22f6be64f5e7df3e3319e220b176537f52e07388
    date: 2026-09-27T01:40:37Z
  - head: e36ca4242240c7d476d6a3019ccec94bf9a4c494
    base: 25f48ac623c5253b06e8209f9b684a024a4bd515
    date: 2026-09-27T02:02:23Z
  - head: d22faf7106f2fe4d7e4efdb07ffbed5a087a9d07
    base: 7d8662c65e653837dc48322a648f8e767cd06abe
    date: 2026-09-27T02:10:46Z
merged:
  date: 2026-09-27T02:11:52Z
  by: Claude <noreply@anthropic.com>
---

Fixes #e9v8jyz3.

Spec 04 §4.3 listed three of the four things a bare `nav install` does. The CLI has always also run `git config --local merge.directoryRenames true` (`packages/cli/src/commands/install.ts:92-102`). Documentation only; no code changes.

- **`doc/spec/04-cli.md`**: `--merge-config` added to the `nav install` and `nav uninstall` synopses, with a bullet saying what it runs. The bullet notes that git's default is `conflict` (placed correctly, then stops to ask), why the scope is `--local` and not `--global`, and that directory rename detection needs git 2.18 or later. "Everything" now lists four items.
- **`doc/spec/03-merge-and-branches.md` §3.3.1**: states that the setting has no effect when `merge.renames=false`. I checked this on git 2.55.0 (table in the issue's confirmation comment). The merge exits 0 and leaves the racing comment in `open/`, which is worse than the default's stop to ask.

`nav doctor`: 0 errors, and the same 9 warnings as `dev`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
