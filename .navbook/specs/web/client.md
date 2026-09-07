---
title: Client
---

## What exists

A Nuxt single-page bundle with no server side of its own. It loads `config.json` at start, signs in with an OIDC provider by PKCE, renews tokens before they expire, and talks to `nav-server` over GraphQL through a normalised Apollo cache (spec 06 §6.3).

- **Issues**, in full: listing with a filter that lives in the URL, whose five menus share one line on a wide screen and fold behind an "Advanced search" toggle on a narrow one, detail with comments and the subtask tree, filing, editing each field in place with the smallest patch that says it, closing with a resolution, reopening, replying, linking and unlinking with the reparent question put to the person.
- **Pull requests**, read and reviewed: listing with that same filter and the all-branches toggle, revisions, comments and reviews bound to a revision, and the refusal to comment on a branch the server does not hold, shown with the branch it names.
- **Features**: the listing, a page per feature with its documents and a timeline of issues, pull requests and commits, and a document editor with a preview. A stale save keeps the draft and shows the other version.
- **Commits** are reported after every write, including the case where nothing was pushed.
- **Theme** follows the browser, with a switch that is remembered in that browser and nowhere else.
- **Markdown** is rendered by `markdown-it` with raw HTML off and passed through DOMPurify; that is the one path from text to HTML.

Nothing about the format ships to the browser: the client sends fields, and every write goes through the server.

## Where it lives

- `packages/web/app/` — pages, components, composables, `graphql/` operations, `utils/`
- Development stack and fixture repository: `packages/web/script/`
- End-to-end suite against a built bundle, a real server and a real repository: `packages/web/test-e2e/`

## Drift from the specification

None found. Spec 06 §6.3 and §1.7 describe the client as built; the scope stated there and in `packages/web/README.md` matches what exists.
