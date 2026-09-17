---
title: Issue and PR references written in prose are not links in the web client
author: Claude <noreply@anthropic.com>
created: 2026-09-17T20:59:29Z
labels: [enhancement]
assignee: Claude <noreply@anthropic.com>
feature: web
resolution: fixed
---

The format defines a cross-reference in prose as `#<id>` (spec 02 §2.9), and
`nav doctor` already reads them back: D8 warns about a dangling one. The web
client does not render them as anything — a reference somebody writes in an
issue body, a PR description or a comment stays plain text, so following it
means selecting eight characters, going to the listing and pasting them into
the filter.

The same reference held in frontmatter *is* a link: `duplicate-of` is rendered
as a `NuxtLink` on the issue page. Only prose is left flat.

## Repro

1. Open any issue in the web client and write a comment containing
   `duplicate of #t4mwvm2j`.
2. The rendered comment shows the literal text. A bare URL in the same comment
   is a link, because markdown-it's `linkify` handles URLs and knows nothing
   about Navbook references.

Rendering is `renderMarkdown`, so it reproduces without a browser:

```console
$ node -e "const M=require('markdown-it');
  console.log(new M({html:false,linkify:true,breaks:false,typographer:false})
    .render('Duplicate of #t4mwvm2j, see also https://example.com.'))"
<p>Duplicate of #t4mwvm2j, see also <a href="https://example.com">https://example.com</a>.</p>
```

## Where it lives

- `packages/web/app/utils/markdown.ts` — the one place that turns data into
  HTML. The markdown-it instance is configured there, and the `link_open` rule
  that gives every link `target="_blank"` and `rel="…nofollow"` is there too.
- `packages/web/app/components/MarkdownBody.vue` — the only `v-html`, used by
  the issue page, the PR page, `CommentCard` and `SpecEditor`, so one change
  covers every body and every comment.
- `packages/core/src/core/refs.ts` — `PROSE_REF`,
  `/(^|[^\w#/`])#([a-z][a-z0-9]{7})\b/g`, is the grammar `doctor` already
  reads. Whatever the client links should recognise exactly the same thing, or
  the two disagree about what a reference is.

## The part that needs deciding

An ID says nothing about what it names: issues and pull requests draw from one
8-character space, and the client has two routes, `/issues/:ref` and
`/prs/:ref`. So a link cannot be built from the text alone. Options:

- A resolver route (`/ref/:id`) that asks `issue(ref:)`, falls back to
  `pr(ref:)` and redirects. No schema change; a reference to a PR costs a
  second request.
- A `reference(ref:)` query on the server that answers with the kind. One
  request, but it touches `schema.graphql` and both generated clients.

Two smaller things fall out of either: the rendered markup is inserted as a
string, so an in-app link written as a plain `<a href>` would reload the whole
SPA unless the click is intercepted; and the blanket `link_open` rule must not
put `target="_blank"` or `nofollow` on a link that stays inside the app.

A dangling reference — the target lives on a branch this checkout has not
fetched — is normal and not an error (spec 02 §2.9), so a link that resolves to
nothing has to say so rather than look broken.
