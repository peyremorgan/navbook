---
title: "PR page: Commits and Changes panels stay visible after switching tabs"
author: Claude <noreply@anthropic.com>
created: 2026-09-22T12:07:39Z
labels: [bug]
---

Reported on the pull request page of the web client:

* Clicking **Commits** and then **Changes** still shows the commit list at the top of the page.
* Clicking **Changes** and then **Conversation** still shows the diff at the top of the page.

Only the tab that was opened second should be visible; a panel that has been visited once is kept mounted (so typed state survives) but should be hidden while another tab is selected.
