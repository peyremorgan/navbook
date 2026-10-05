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
  - head: 867ef39f75042e2beaed94a66795bc359639a1bf
    base: 71a0111d4a058212fe8e75b0c6fa2e1f41b103fc
    date: 2026-09-30T14:14:21Z
---

Closes #kw6afa4a, the second of three steps towards #c43a2w7e (plugin-chat).

Was stacked on `#lfr46mfi`, now merged; rebased onto `dev`.

A plugin that acts for somebody (an assistant, a chat bridge) needs four things the hosts did not offer. This adds them.

## Server

- **`host.api.execute(ctx, document, variables)`** runs a GraphQL operation against the served schema as the request's viewer. It goes through the same resolvers, transactions, error codes and mutation event as a client's request, because it *is* one, minus the HTTP. Parsed and validated documents are remembered (capped at 256). It is called from a resolver, with that resolver's context, and refused under the repository lock (inside `sync.read`, `sync.write`, `sync.locked` or a `writeEntity` body), where it would wait for itself.
- **`host.api.schema()`** is the composed schema, available once every plugin has activated. It refuses during `activate`, when it cannot exist yet.
- **`host.api.writeEntity(ctx, kind, ref, body)`** is the write site `addComment` uses: the clone for an issue, the pull request's own branch (temporary worktree, pushed) for a pull request. It sends no mutation event itself; the plugin calls `commitInfo`. It sits beside the `writeTarget` #z9yqtsbv exports for plugin-tests, which keeps refusing a pull request the served checkout does not hold.

## CLI

- **`nav pr open --source <branch> [-y]`** writes a pull request on another local branch: in the clean worktree that has it, or a temporary one, after asking or under `-y`, exactly like the other writes to a PR held elsewhere. The branch's tip is the pinned head; its last subject is the default title. `<branch>` must be a branch's name: `feat~1` or `feat@{1}` is refused before anything is checked out.
- The write sites run their callback synchronously; one that returns a promise fails the command as a throwing write does.
- `pr-elsewhere.ts` shares one `writeAt` between `withPrWriteSite` and the new `withBranchWriteSite`. Both are on `CliPluginUi`, loaded by a dynamic import at plugin activation, so a listing with a plugin on the path pays nothing for them (spec 05 §5.2; the perf budget passes).

## Web

- **`overlays`** slot: a component rendered after the page by the default layout, so never on the signed-out pages.
- `startStack({ pluginPaths, env })` lets a plugin's own e2e suite load itself beside the knowledge base and configure the server.

## Docs

- Spec 04 §4.4: the verbs that read or write the tree make no network call. A plugin's own command may reach a service it is configured for, must say so, and never touches the remotes. The `pr open` synopsis gains `--source`.
- The README command table.
- doc/plugins.md covers the network rule, the write sites, `api.execute` and `overlays`.

## Self-review (2026-10-05)

Rebased onto `dev` (plugin-tests had landed: `writeTarget` is kept beside `writeEntity`, and the e2e plugin path joins both). An adversarial review found, and this branch now fixes:

- **A server that stops answering.** `execute` called under the lock queued behind the operation calling it, and every request after it waited for ever, `drain()` included. The lock now knows who holds it, and `execute` refuses there with the rule in its message.
- **A revision taken for a branch.** `nav pr open --source 'feat/work~1' -y` staged a `pr.md` with that `source:` in a detached worktree.
- **An async write.** A callback returning a promise ran after its worktree was removed.
- **Docs.** `execute` is for resolvers, not services. The network rule matches spec 04 §4.4. `writeEntity` needs `commitInfo` for the mutation event.
- **Merging read a stale copy** (found merging #lfr46mfi, which counted 0 of 1 approvals while its branch held one). A pull request on several branches was read from whichever sorted first; the copy on its `source:` branch now answers.

## Tests

| Suite | Result |
|---|---|
| core | 954 passed |
| server | 497 passed |
| cli | 437 passed |
| plugin-kb | 145 passed |
| plugin-tests | 120 passed |
| conformance | 128 passed |
| Playwright | 196 passed (on the combined stack with #s86nic83) |

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
