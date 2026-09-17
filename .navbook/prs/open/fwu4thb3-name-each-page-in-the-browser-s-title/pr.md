---
title: Name each page in the browser's title
author: Claude <noreply@anthropic.com>
created: 2026-09-17T18:09:41Z
target: dev
source: fix/umalw0cy-per-page-titles
reviewer: morgan.peyre@brickcode.tech
labels: [bug]
feature: web
revisions:
  - head: d23fe76b5266570fcdfeeb2b27a22ec8c64bfbd0
    base: bd171bbd8d04912327d45f5e0587961b7b6b84a6
    date: 2026-09-17T18:09:41Z
---

Closes #umalw0cy.

Every page of the client was called `Navbook`, because the only title there was is the static one `nuxt.config.ts` puts in the shell and no page replaced it. With `ssr: false` that shell is served for every address, so a browser history, a bookmark bar and a row of tabs were rows of identical entries.

## What it does

`app/utils/title.ts` composes one title, and every page calls `useHead` with what it returns:

| Page | Title |
|---|---|
| `/issues` | `Issues · Navbook` |
| `/issues/:ref` | `#aaaa0001 Login times out on slow connections · Navbook` |
| `/issues/new` | `New issue · Navbook` |
| `/prs` | `Pull requests · Navbook` |
| `/prs/:ref` | `#bbbb0001 Add a timeout to the login form · Navbook` |
| `/features` | `Features · Navbook` |
| `/features/:slug` | `Authentication · Navbook` |
| `/features/:slug/:file` | `Login flow — Authentication · Navbook` |
| `/inbox` | `Inbox · Navbook` |
| `/signed-out` | `Signed out · Navbook` |
| `/not-allowed` | `Account not allowed · Navbook` |
| `/auth/callback` | `Signing in · Navbook` |

The parts read narrowest first and the application comes last: a tab strip truncates from the right, so the left is what survives being narrow, and the application is the part you least need to read. `/` sets none, because it is a redirect that never renders.

A detail page is named from the reference in the address at once — `#aaaa0001 · Navbook` — and gains the subject's title when its query answers, so there is neither a flash of the bare application name nor an empty tab. `entityTitle` shortens whatever the route carried through `shortId`, so a whole directory name in the address still titles the page with the prefix the rest of the client displays.

The two separators and the suffix live in that one file rather than in twelve pages, and nothing about it is reactive: the pages that need it to follow a query wrap it in a `computed`. Keeping the composition pure is what lets it be unit-tested without mounting anything, which is this package's stated rule for its utilities.

## What proves it

- `test/nuxt/title.test.ts` — 11 cases, and the ones worth having are the negative ones: a missing part, a blank part and a hand-wrapped frontmatter title must not produce `undefined · Navbook` or a trailing separator.
- `test-e2e/titles.spec.ts` — the titles a real browser reports, including that navigating from the listing to an issue *changes* the title, which is the assertion the bug would have failed: every route after the first is the router's, not the server's.

`pnpm --filter @navbook/web test` (330 passing), `nuxi typecheck`, `tsc -p tsconfig.tools.json` and `biome check` all pass.

**One gap worth naming:** the e2e spec is written and type-checks, but it has not been run — Playwright's Chromium could not be downloaded in this environment. In place of a browser the built artefact was inspected instead: `nuxi generate` was run and all twelve `useHead` call sites are present in the emitted chunks, eight as literal `pageTitle("Issues")`-style calls and four as the reactive `computed` form, with both separators in the bundle. That proves the titles ship; it does not prove the browser renders them, which `test:e2e` is what would.
