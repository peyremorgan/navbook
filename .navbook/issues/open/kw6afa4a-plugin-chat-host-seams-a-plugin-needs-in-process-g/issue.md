---
title: "plugin-chat: host seams a plugin needs (in-process GraphQL, branch write sites, overlays slot)"
author: Claude <noreply@anthropic.com>
created: 2026-09-29T01:23:21Z
labels: [plugin]
assignee: Claude <noreply@anthropic.com>
parent: c43a2w7e
---

- Server: `host.api.execute(ctx, document, variables)` and `host.api.schema()`, so a server plugin runs the same resolvers a client does.
- CLI: `ui.withPrWriteSite` and `ui.withBranchWriteSite` on the plugin host; `nav pr open --source <branch>` writes the pull request on another local branch through a temporary worktree.
- Web: an `overlays` slot rendered by the default layout, for something drawn over every page.
- e2e: `startStack` takes extra plugin paths and server environment.
- Spec 04 §4.4: the no-network rule applies to built-in verbs; doc/plugins.md says what a plugin command may do.
