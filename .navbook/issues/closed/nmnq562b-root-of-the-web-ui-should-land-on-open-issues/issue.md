---
title: Root of the web UI should land on open issues
author: Morgan PEYRE <morgan.peyre@brickcode.tech>
created: 2026-09-07T17:12:39Z
labels: [enhancement]
feature: web
resolution: fixed
parent: rmsuy3z6
---

`/` redirects to `/issues` with no query string, and a filter naming no status means any status — so the front page opens on closed issues mixed in with the open ones.

Send it to `/issues?status=open` instead. The listing's own default is unchanged: `/issues` still means everything, the Open chip reads as pressed on arrival, and Clear gets the full list back.

Three places mean "the front page" and should agree: the root redirect in `app/pages/index.vue`, `HOME` in `app/utils/navigation.ts` (where sign-in lands with no return path), and the Navbook wordmark in `app/layouts/default.vue`. The "Issues" nav button beside the wordmark keeps meaning "the issues list", unfiltered.

Note the redirect value has to stay a literal rather than import `HOME`: Nuxt only lifts `redirect` into the route record when it is statically serializable.
