---
title: Every page of the web client has the same browser title, so history and tabs are unreadable
author: Claude <noreply@anthropic.com>
created: 2026-09-17T18:00:35Z
labels: [bug]
assignee: Claude <noreply@anthropic.com>
feature: web
resolution: fixed
---

Every page of the web client puts the same thing in the browser's title bar: `Navbook`. The issue you are reading, the pull request you reviewed, the features listing and the sign-out page are all called `Navbook`, so a browser history, a bookmark bar and a row of open tabs are all rows of identical entries. Searching history for the issue you read yesterday cannot work, because its title never mentioned it.

The title is set once, statically, in [`packages/web/nuxt.config.ts`](../../../../packages/web/nuxt.config.ts):

```ts
app: {
  head: {
    title: "Navbook",
    meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  },
},
```

and no page ever changes it: `useHead` and `useSeoMeta` appear nowhere under `packages/web/app/`. Because the package is `ssr: false`, that static shell is the only title there is, and nothing on the client side replaces it after the route resolves.

## What it should do

Each page names itself, and the name ends with the application, so a history row is readable at a glance and still identifiable as Navbook:

| Page | Title |
|---|---|
| `/issues` | `Issues · Navbook` |
| `/issues/:ref` | `#bqlybac0 Login times out on slow connections · Navbook` |
| `/issues/new` | `New issue · Navbook` |
| `/prs` | `Pull requests · Navbook` |
| `/prs/:ref` | `#dk3mp2x9 Add a timeout to the login form · Navbook` |
| `/features` | `Features · Navbook` |
| `/features/:slug` | `Authentication · Navbook` |
| `/features/:slug/:file` | `login-flow.md — Authentication · Navbook` |
| `/inbox` | `Inbox · Navbook` |

A detail page's title has to wait for the query, so it starts at something honest — the reference from the address, which is known immediately — and gains the subject's title when the data arrives, rather than showing a flash of `Navbook` or an empty tab.
