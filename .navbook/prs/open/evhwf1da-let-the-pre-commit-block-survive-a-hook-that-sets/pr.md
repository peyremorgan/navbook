---
title: Let the pre-commit block survive a hook that sets -e
author: Claude <noreply@anthropic.com>
created: 2026-09-27T11:28:25Z
target: dev
source: fix/xb3jdz3q-hook-set-e
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
revisions:
  - head: 5fff5326a94d533ec07915d1f3c4f69ba1e700f4
    base: 6cf8d86e47de70cc38cc851ae01f74b97228155d
    date: 2026-09-27T11:28:25Z
  - head: d19709da64bc3b6328923322fc94fce7b84ebac6
    base: 6cf8d86e47de70cc38cc851ae01f74b97228155d
    date: 2026-09-27T12:02:38Z
---

Fixes #xb3jdz3q.

`nav install --hooks` appends its block to any `pre-commit` hook that already exists. The block ran `nav doctor --staged` as a bare command and tested `$?` on the next line. If the host hook uses `set -e`, as most hand-written ones do, the shell ends the hook on *any* non-zero status before that test runs. The result is that exit 1 blocks the commit as if it were exit 2. Exit 1 is an operational error: no Navbook directory, or a stray `NAV_ROOT`. Only exit 2, a format violation, should block. That is spec 04 §4.5, and the block's own comment says so too.

## Change

`packages/cli/src/install/hook.ts`: this follows the plan in the issue.

```sh
if command -v nav >/dev/null 2>&1; then
  navbook_status=0
  nav doctor --staged || navbook_status=$?
  if [ "$navbook_status" -eq 2 ]; then
    exit 1
  fi
fi
```

- The `||` form keeps `set -e` from acting on the status, which is a POSIX rule, and it still preserves the three-way status.
- The variable is prefixed so it cannot collide with a name the host hook uses.
- I kept the full `if` instead of `[ … ] && exit 1`. That form would make the hook exit 1 whenever the block is the last thing in it.
- I did not add `set +e`, because it would change the shell for anything appended after the block.

## Tests

In `packages/cli/test/cli/install.test.ts` there are two new tests. Both run a real commit through a host hook that uses `set -eu`:

- A commit goes through when `doctor --staged` exits 1 because `.navbook/` was removed. **This test fails on the old block** (checked before the fix was applied).
- A staged format violation still blocks the commit. This is the mirror case: it catches a fix that goes too far and swallows exit 2 as well.

The CLI suite passes (381 tests, 0 failures), and so do `tsc --noEmit` and `biome check .`.

The repro matrix from the issue comment, run on the fixed CLI:

```
                 doctor  set -e   set -euo pipefail  plain   none
.navbook removed   1     made     made               made    made     (was: refused under set -e)
malformed issue    2     refused  refused            refused refused
```

## Existing installs

The installer does not rewrite a block it has already installed. It sees the marker and returns. Repositories that ran `nav install --hooks` before this change keep the old block until they run `nav uninstall --hooks && nav install --hooks`. That needs a line in the release notes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
