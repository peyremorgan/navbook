---
title: "Host seams a plugin needs: in-process GraphQL, write sites, an overlays slot"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T02:41:16Z
target: dev
source: feat/kw6afa4a-plugin-host-seams
reviewer: morgan.peyre@brickcode.tech
revisions:
  - head: 11b2a0f05081a7df1be8708a5e908eae807121e5
    base: d576c77713d71b04f266bde7b9b50718df4af151
    date: 2026-09-29T02:41:16Z
  - head: 6139a3d6de3515995f60e76b2528866b830f9ac2
    base: 71a0111d4a058212fe8e75b0c6fa2e1f41b103fc
    date: 2026-09-30T14:11:50Z
---

Closes #kw6afa4a, the second of three steps towards #c43a2w7e (plugin-chat).

**Stacked on `#lfr46mfi`**: this branch starts from #yp56dc43's commits, so merge that one first and rebase this onto `dev`.

A plugin that acts for somebody (an assistant, a chat bridge) needs four things the hosts did not offer. This adds them.

## Server

- **`host.api.execute(ctx, document, variables)`** runs a GraphQL operation against the served schema as the request's viewer. It goes through the same resolvers, transactions, error codes and mutation event as a client's request, because it *is* one, minus the HTTP. Parsed and validated documents are remembered (capped at 256).
- **`host.api.schema()`** is the composed schema, available once every plugin has activated. It refuses during `activate`, when it cannot exist yet.
- **`host.api.writeEntity(ctx, kind, ref, body)`** is the write site `addComment` uses: the clone for an issue, the pull request's own branch (temporary worktree, pushed) for a pull request. It replaces the `writeTarget` #z9yqtsbv exports for plugin-tests.

## CLI

- **`nav pr open --source <branch> [-y]`** writes a pull request on another local branch: in the clean worktree that has it, or a temporary one, after asking or under `-y`, exactly like the other writes to a PR held elsewhere. The branch's tip is the pinned head; its last subject is the default title.
- `pr-elsewhere.ts` shares one `writeAt` between `withPrWriteSite` and the new `withBranchWriteSite`. Both are on `CliPluginUi`, loaded by a dynamic import at plugin activation, so a listing with a plugin on the path pays nothing for them (spec 05 §5.2; the perf budget passes).

## Web

- **`overlays`** slot: a component rendered after the page by the default layout, so never on the signed-out pages.
- `startStack({ pluginPaths, env })` lets a plugin's own e2e suite load itself beside the knowledge base and configure the server.

## Docs

- Spec 04 §4.4: the built-in verbs make no network call. A plugin's own command may reach a service it is configured for, must say so, and never touches the remotes. The `pr open` synopsis gains `--source`.
- The README command table.
- doc/plugins.md covers the network rule, the write sites, `api.execute` and `overlays`.

## Tests

| Suite | Result |
|---|---|
| core | 896 passed |
| server | 467 passed |
| cli | 409 passed |
| plugin-kb | 138 passed |
| conformance | 128 passed |
| deploy | 69 passed |
| web vitest | 411 passed |
| Playwright | 171 passed |

What the new tests cover:
- The server probe proves `schema()` is unavailable during `activate` and available at service start.
- `execute` runs the built-in resolvers as the viewer; an invalid document gets its errors back.
- `writeEntity` comments on a PR on its own branch (pushed there) and on an issue in the clone.
- Runtime unit tests cover `execute` and `schema`.
- Seven CLI cases for `pr open --source`: temporary worktree, existing worktree, current branch, refusal without `-y`, not a branch, dirty worktree, self-target with worktree cleanup.
- Two probe-plugin cases for `ui.withPrWriteSite`.
- A vitest case for `overlays`.

Under a load average of 10-25, the TreeCache watchdog, maintenance stop and CLI perf-budget tests failed once each. All pass on rerun alone, and `#lfr46mfi`'s branch shows the same perf flake.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
