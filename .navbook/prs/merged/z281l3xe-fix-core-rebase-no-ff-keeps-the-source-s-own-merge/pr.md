---
title: "fix(core): rebase-no-ff keeps the source's own merge commits"
author: Claude <noreply@anthropic.com>
created: 2026-10-06T10:37:32Z
target: dev
source: fix/rebase-no-ff-keeps-merges
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 1519b9feb3c7156031dfc9d148c30b7c120f2c85
    base: 11b41b1019658234ecfe1dd553da3d52c7fc14d3
    date: 2026-10-06T10:37:32Z
merged:
  date: 2026-10-06T11:30:51Z
  by: Claude <noreply@anthropic.com>
---

\`rebase-no-ff\` now keeps the merge commits inside the source branch instead of flattening them.

## Why

The replay behind \`rebase\` and \`rebase-no-ff\` was one plain \`git rebase --onto\`, and a plain rebase drops every merge commit it replays. That suits \`rebase\`, which asks for a linear history. It defeats \`rebase-no-ff\`: a branch that integrated its subtasks by merge commits landed with one merge on top and none of its own, so the method that ends in a merge commit threw away the merge commits it was chosen to keep.

This came up in the Brickcode factory: integration branches collect subtask PRs by merge commits, then land on \`dev\` as one PR, and the factory wants to declare \`rebase-no-ff\`.

## Change

- \`replayOnto\` (\`packages/core/src/git/merge.ts\`) takes \`keepMerges\` and passes \`--rebase-merges\` when it is set.
- \`landReplay\` (\`packages/core/src/ops/pr.ts\`) sets it for the \`replay-merge-commit\` strategy, which is \`rebase-no-ff\`. \`rebase\` still flattens.
- Spec 02 §2.10 and spec 04 (\`nav pr merge\`) say which replay flattens and which keeps merges.

## Known cost

A recreated merge is merged again, so a conflict fixed inside it, such as a "merge dev into X" commit, comes back during the replay and stops for \`--continue\`. A plain \`rebase\` hits the same conflict on the commit it replays, so this is the price of rebasing, not something new here.

## Tests

- Two new tests in \`packages/core/test/operations.test.ts\`: \`rebase-no-ff\` recreates the source's merge under the landing merge, and \`rebase\` still lands no merge commit. The first fails without the fix.
- \`@navbook/core\`: 956/956 pass. Typecheck and Biome are clean.
- \`@navbook/cli\`: 436/437 pass. The failure is \`nav pr open --source\` › "writes in the clean worktree that already has the branch", which expects \`/var/folders/…\` and gets the macOS \`/private/var/…\` realpath. This change does not touch that command; it has not been run on unpatched \`dev\`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
