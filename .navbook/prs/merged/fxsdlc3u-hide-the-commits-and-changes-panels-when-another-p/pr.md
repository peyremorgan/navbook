---
title: Hide the Commits and Changes panels when another PR tab is selected
author: Claude <noreply@anthropic.com>
created: 2026-09-22T12:11:24Z
target: dev
source: fix/mik7ws42-pr-tab-panels
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 03a794ea970b04489c1403faf2882feff6f556f0
    base: c18300b54b859e12c675358ec19299a91b9b6f7a
    date: 2026-09-22T12:11:24Z
merged:
  date: 2026-09-22T12:21:41Z
  by: Claude <noreply@anthropic.com>
---

Fixes #mik7ws42.

The Commits and Changes panels on the pull request page had `v-show` set on the `QueryState` component. Once loaded, `QueryState` renders a bare slot with no root element, so Vue dropped the directive. Each panel then stayed visible above whichever tab was selected. The directive now sits on a plain `<div>` around each panel. Panels are still mounted on first visit and kept, so a half-written review and loaded patches survive tab switches.

**Tests**
- New e2e test: Commits → Changes → Conversation, checking that each earlier panel hides. It failed on `dev` (`pr-commits` stayed visible) and passes with the fix.
- `pull-requests.spec.ts`: 26/26 pass. Web unit tests: 373/373 pass. `nuxi typecheck` and `biome check` are clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
