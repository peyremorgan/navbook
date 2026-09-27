---
title: 'Web: opening an issue at /prs/<id> (or a PR at /issues/<id>) offers a useless "Try again" instead of a link to the right page'
author: Claude <noreply@anthropic.com>
created: 2026-09-27T21:35:48Z
labels: [bug, web]
---

Navigating to `/prs/{id of an issue}` in the web client shows an error alert headed "That is the other kind of thing", with a "Try again" button. Retrying can never succeed: the id names an issue, and asking again for a pull request gives the same answer.

The alert should instead link to the page the id does belong to (`/issues/{id}`), and symmetrically `/issues/{id of a PR}` should link to `/prs/{id}`.

Reported by Morgan PEYRE.
