---
title: "A Discord bridge: threads for pull requests and issues, and acting from Discord"
author: Claude <noreply@anthropic.com>
created: 2026-10-14T00:54:15Z
labels: [enhancement, plugin]
assignee: Claude <noreply@anthropic.com>
feature: plugins
---

A Discord bridge for the tracker, as a server plugin (spec 06 §6.2 names a chat bridge as the case plugin services exist for). Developers should be able to follow and discuss pull requests and issues from a Discord server, and act on them from there as themselves.

What it should do:

- Open a thread in a configured channel for every pull request, and for every issue that meets configurable criteria: root issues only or all, and on being opened, assigned, moved to a status, given a frontmatter field, or given a value of one.
- Tell each thread when its record moves: comments and reviews, status changes, assignments and review requests, new revisions — whether the change was made over the API or pushed from a terminal.
- Keep a mapping of Discord accounts to addresses, and let linked people act from Discord as themselves: comment, review, assign, close, reopen.
- Mention people in the thread when they are assigned or asked to review, if their account is linked.

Two things the server's plugin host does not offer yet, and the bridge needs:

- A service hears of mutations made over the API, and of nothing pushed from a terminal: nothing tells it when a pull moves the clone.
- `host.api.execute` acts as a request's viewer, and a service has no request: it cannot act for the person who typed a command.

Delivered as two stacked pull requests into `dev`: the host seams first, then `@navbook/plugin-discord`.
